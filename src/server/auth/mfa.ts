/**
 * Time-based one-time passwords (TOTP) as a second sign-in factor. Any
 * account may enrol; an owner can require it for all staff
 * (platform_settings.staff_mfa_required), in which case staff sessions that
 * have not passed the second factor are limited to /admin/security.
 *
 * * The secret is encrypted at rest with the seed key ring and shown once,
 *   at enrolment, as text and an otpauth:// link (no third-party QR service).
 * * A code is accepted at most once (last_step only moves forward, under a
 *   row lock), within ±1 time step for clock drift.
 * * Ten single-use recovery codes are shown once; only their SHA-256 is kept.
 * * Sign-in with MFA is two steps: the password step returns a short-lived
 *   signed challenge instead of a session; the code step exchanges it for a
 *   session marked mfa_verified_at. Code attempts are rate-limited per account.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret, sha256Hex } from '../crypto';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { platformSettings, sessions, userMfa, users } from '../db/schema';
import { env } from '../env';
import { AppError, errors } from '../errors';
import { audit, recordAdminAction } from '../audit/audit';
import { consume, RATE_LIMITS } from '../http/rate-limit';
import { hasPermission } from './rbac';
import { createSession, revokeAllSessions, type SessionUser } from './sessions';
import { matchTotp, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUri } from './totp';

const CHALLENGE_TTL_MS = 5 * 60_000;

interface Meta {
  ipHash: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function mfaEnabled(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db.select({ enabledAt: userMfa.enabledAt }).from(userMfa).where(eq(userMfa.userId, userId));
  return Boolean(row?.enabledAt);
}

export async function mfaStatus(userId: string) {
  const [row] = await getDb().select().from(userMfa).where(eq(userMfa.userId, userId));
  return { enabled: Boolean(row?.enabledAt), enabledAt: row?.enabledAt ?? null, recoveryCodesLeft: row?.enabledAt ? row.recoveryHashes.length : 0 };
}

/**
 * Whether the staff MFA policy blocks this session from the back office. A
 * verified session implies MFA is on (turning it off clears the mark on every
 * session), so only the policy flag needs reading.
 */
export async function staffMfaBlocks(session: SessionUser): Promise<boolean> {
  if (session.mfaVerifiedAt) return false;
  const [settings] = await getDb().select({ required: platformSettings.staffMfaRequired }).from(platformSettings).where(eq(platformSettings.id, 1));
  return settings?.required ?? false;
}

/** MFA position of a staff session: whether the back office may be used with it. */
export async function staffMfaState(session: SessionUser) {
  const db = getDb();
  const [settings] = await db.select({ required: platformSettings.staffMfaRequired }).from(platformSettings).where(eq(platformSettings.id, 1));
  const enabled = await mfaEnabled(db, session.userId);
  const required = settings?.required ?? false;
  const verified = session.mfaVerifiedAt !== null;
  return { enabled, verified, required, satisfied: !required || (enabled && verified) };
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------
/** Issues a new (pending) secret. Replaces an unconfirmed one; refuses while MFA is on. */
export async function beginEnrollment(userId: string, accountLabel: string) {
  return withTransaction(async (tx) => {
    const [row] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId)).for('update');
    if (row?.enabledAt) throw errors.conflict('Two-factor authentication is already on. Turn it off first to set up a new device.');
    const secret = newTotpSecret();
    const values = { secretEnc: encryptSecret(secret), enabledAt: null, lastStep: 0, recoveryHashes: [] as string[], updatedAt: new Date() };
    if (row) await tx.update(userMfa).set(values).where(eq(userMfa.userId, userId));
    else await tx.insert(userMfa).values({ userId, ...values });
    return { secret, uri: otpauthUri(secret, accountLabel) };
  });
}

/** Confirms enrolment with a first code; returns the recovery codes (shown once). */
export async function confirmEnrollment(session: SessionUser, code: string, meta: Meta) {
  return withTransaction(async (tx) => {
    const [row] = await tx.select().from(userMfa).where(eq(userMfa.userId, session.userId)).for('update');
    if (!row) throw errors.conflict('Start the set-up first');
    if (row.enabledAt) throw errors.conflict('Two-factor authentication is already on');
    const step = matchTotp(decryptSecret(row.secretEnc), code.trim());
    if (step === null) throw errors.validation('That code did not match. Check the time on your device and try the current code.');
    const codes = newRecoveryCodes();
    const now = new Date();
    await tx
      .update(userMfa)
      .set({ enabledAt: now, lastStep: step, recoveryHashes: codes.map((c) => sha256Hex(normaliseRecoveryCode(c))), updatedAt: now })
      .where(eq(userMfa.userId, session.userId));
    // This session just proved the factor; every other session must sign in again with it.
    await tx.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, session.sessionId));
    const revoked = await revokeAllSessions(tx, session.userId, session.sessionId);
    await audit(tx, { actorId: session.userId, actorType: 'USER', action: 'auth.mfa_enabled', resourceType: 'user', resourceId: session.userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, after: { otherSessionsRevoked: revoked } });
    return { recoveryCodes: codes };
  });
}

/**
 * Checks a TOTP code (never the same step twice) or a recovery code (removed
 * when used) under the MFA row lock. Returns how the factor was proven.
 */
export async function verifySecondFactor(tx: Tx, userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const [row] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId)).for('update');
  if (!row?.enabledAt) return null;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const step = matchTotp(decryptSecret(row.secretEnc), trimmed, { notAfterStep: row.lastStep });
    if (step === null) return null;
    await tx.update(userMfa).set({ lastStep: step, updatedAt: new Date() }).where(eq(userMfa.userId, userId));
    return 'totp';
  }
  const hash = sha256Hex(normaliseRecoveryCode(trimmed));
  if (!row.recoveryHashes.includes(hash)) return null;
  await tx
    .update(userMfa)
    .set({ recoveryHashes: row.recoveryHashes.filter((h) => h !== hash), updatedAt: new Date() })
    .where(eq(userMfa.userId, userId));
  return 'recovery';
}

export async function disableMfa(session: SessionUser, code: string, meta: Meta) {
  await consume(RATE_LIMITS.mfaUser, session.userId);
  const ok = await withTransaction(async (tx) => {
    const method = await verifySecondFactor(tx, session.userId, code);
    if (!method) return false;
    await tx.update(userMfa).set({ enabledAt: null, recoveryHashes: [], updatedAt: new Date() }).where(eq(userMfa.userId, session.userId));
    await tx.update(sessions).set({ mfaVerifiedAt: null }).where(eq(sessions.userId, session.userId));
    await audit(tx, { actorId: session.userId, actorType: 'USER', action: 'auth.mfa_disabled', resourceType: 'user', resourceId: session.userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { method } });
    return true;
  });
  if (!ok) {
    await audit(getDb(), { actorId: session.userId, actorType: 'USER', action: 'auth.mfa_failed', resourceType: 'user', resourceId: session.userId, outcome: 'FAILED', ipHash: meta.ipHash, metadata: { during: 'disable' } });
    throw new AppError('UNAUTHENTICATED', 'That code did not match');
  }
}

/** Re-proves the factor on the current session (e.g. a session created before enrolment). */
export async function verifySession(session: SessionUser, code: string, meta: Meta) {
  await consume(RATE_LIMITS.mfaUser, session.userId);
  const ok = await withTransaction(async (tx) => {
    const method = await verifySecondFactor(tx, session.userId, code);
    if (!method) return null;
    await tx.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.sessionId));
    await audit(tx, { actorId: session.userId, actorType: 'USER', action: 'auth.mfa_verified', resourceType: 'user', resourceId: session.userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { method } });
    return method;
  });
  if (!ok) {
    await audit(getDb(), { actorId: session.userId, actorType: 'USER', action: 'auth.mfa_failed', resourceType: 'user', resourceId: session.userId, outcome: 'FAILED', ipHash: meta.ipHash, metadata: { during: 'session' } });
    throw new AppError('UNAUTHENTICATED', 'That code did not match');
  }
  return { method: ok };
}

// ---------------------------------------------------------------------------
// Two-step sign-in
// ---------------------------------------------------------------------------
function challengeKey(): Buffer {
  const secret = env().IP_HASH_SECRET ?? 'development-ip-hash-secret';
  return createHmac('sha256', secret).update('aurovane:mfa-challenge:v1').digest();
}

/** Signed, short-lived proof that the password step succeeded for `userId`. */
export function issueMfaChallenge(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + CHALLENGE_TTL_MS, n: randomBytes(9).toString('base64url') })).toString('base64url');
  const mac = createHmac('sha256', challengeKey()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function readMfaChallenge(token: string, now = Date.now()): string | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || token.length > 400) return null;
  const expected = createHmac('sha256', challengeKey()).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
    if (typeof data.u !== 'string' || typeof data.e !== 'number' || data.e < now) return null;
    return data.u;
  } catch {
    return null;
  }
}

export async function completeMfaLogin(challenge: string, code: string, meta: Meta) {
  const userId = readMfaChallenge(challenge);
  if (!userId) throw new AppError('UNAUTHENTICATED', 'The sign-in step expired. Enter your password again.');
  await consume(RATE_LIMITS.mfaUser, userId);
  const result = await withTransaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, email: users.email, username: users.username, role: users.role, status: users.status }).from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED', 'The sign-in step expired. Enter your password again.');
    const method = await verifySecondFactor(tx, userId, code);
    if (!method) return null;
    const now = new Date();
    await tx.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, userId));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.login', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { mfa: method } });
    const session = await createSession(tx, userId, { userAgent: meta.userAgent, ipHash: meta.ipHash, mfaVerifiedAt: now });
    return { user: { id: user.id, email: user.email, username: user.username, role: user.role }, session };
  });
  if (!result) {
    await audit(getDb(), { actorId: userId, actorType: 'USER', action: 'auth.mfa_failed', resourceType: 'user', resourceId: userId, outcome: 'FAILED', ipHash: meta.ipHash, metadata: { during: 'login' } });
    throw new AppError('UNAUTHENTICATED', 'That code did not match');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Staff policy
// ---------------------------------------------------------------------------
export async function setStaffMfaRequired(actor: SessionUser, required: boolean, reason: string, meta: Meta) {
  if (!hasPermission(actor.role, 'security:manage')) throw errors.forbidden();
  if (required && (!(await mfaEnabled(getDb(), actor.userId)) || !actor.mfaVerifiedAt)) {
    throw errors.conflict('Turn on two-factor authentication for your own account (and sign in with it) before requiring it for staff');
  }
  return withTransaction(async (tx) => {
    const [before] = await tx.select({ required: platformSettings.staffMfaRequired }).from(platformSettings).where(eq(platformSettings.id, 1)).for('update');
    await tx.update(platformSettings).set({ staffMfaRequired: required, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(platformSettings.id, 1));
    await recordAdminAction(tx, {
      adminId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId ?? null,
      action: 'security.staff_mfa_required',
      targetType: 'platform',
      targetId: '1',
      reason,
      before: { staffMfaRequired: before?.required ?? false },
      after: { staffMfaRequired: required },
    });
    return { staffMfaRequired: required };
  });
}

/** Staff accounts and whether each has MFA on (for the security page). */
export async function staffMfaOverview() {
  const res = await getDb().execute<{ id: string; username: string; role: string; enabled: boolean }>(sql`
    SELECT u.id, u.username, u.role::text AS role, (m.enabled_at IS NOT NULL) AS enabled
      FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id
     WHERE u.role <> 'PLAYER' AND u.status = 'ACTIVE'
     ORDER BY u.role, u.username`);
  return res.rows;
}
