/**
 * E-mail verification with six-digit, single-use codes.
 *
 * Registration creates a pending account (no session, wallet, seeds or
 * bonus) and e-mails a code. Entering it activates the account exactly once,
 * in one transaction: e-mail marked verified, wallet, fairness seeds and play
 * limits created, the welcome chips granted through the ledger, and the first
 * session issued. The same challenge mechanism confirms a new address when a
 * verified player changes their e-mail.
 *
 * Codes come from the CSPRNG (crypto.randomInt) and are never stored: each
 * challenge keeps HMAC-SHA256(key, "<challenge id>:<code>") with a key derived
 * from IP_HASH_SECRET, so a database copy alone does not allow the million
 * possible codes to be tested offline. A challenge expires after
 * VERIFICATION_TTL_MINUTES, allows VERIFICATION_MAX_ATTEMPTS wrong entries,
 * is consumed by a conditional update under the account's row lock (so two
 * concurrent correct submissions cannot both succeed), and is superseded when
 * a new code is issued (at most one live challenge per account, enforced by a
 * partial unique index). New codes are limited to one per
 * RESEND_COOLDOWN_SECONDS and CODES_PER_HOUR per account, plus per-IP and
 * per-address buckets keyed with the same server secret.
 *
 * Between registration and verification the browser holds a signed "signup
 * flow" cookie naming the pending account; no request ever names an account
 * by id, so nobody can act on another pending registration. Codes, addresses
 * and names never appear in audit metadata, logs or API responses.
 */
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  CODES_PER_HOUR,
  maskAddress,
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_TTL_MINUTES,
} from '@/lib/account-policy';
import { audit } from '../audit/audit';
import { createSession, revokeAllSessions } from '../auth/sessions';
import { getDb, pgConstraint, pgErrorCode, withTransaction, type Executor, type Tx } from '../db/client';
import { emailVerificationChallenges, passwordResetTokens, users } from '../db/schema';
import { env } from '../env';
import { AppError, errors } from '../errors';
import { createSeedPair } from '../fairness/seeds';
import { consume, type RateLimitRule } from '../http/rate-limit';
import { createWalletAccount } from '../ledger/accounts';
import { getMailer, sendInBackground, sendNow } from '../mail/mailer';
import { grantSignupBonus } from '../promotions/bonuses';
import { ensureLimitsRow } from '../responsible/limits';
import { verifyPassword } from '../auth/password';

export interface VerificationMeta {
  ipHash: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

type Purpose = 'SIGNUP' | 'EMAIL_CHANGE';

/** Pending registrations older than this may be reclaimed by a new registration with the same e-mail or username. */
export const PENDING_RECLAIM_HOURS = 24;

// ---------------------------------------------------------------------------
// Keys, codes and the signup-flow cookie
// ---------------------------------------------------------------------------

function derivedKey(label: string): Buffer {
  const secret = env().IP_HASH_SECRET ?? 'development-ip-hash-secret';
  return createHmac('sha256', secret).update(label).digest();
}

export function codeMac(challengeId: string, code: string): string {
  return createHmac('sha256', derivedKey('aurovane:email-code:v1')).update(`${challengeId}:${code}`).digest('hex');
}

/** Keyed digest of an address for rate-limit buckets (the address itself is never a key). */
export function addressKey(email: string): string {
  return createHmac('sha256', derivedKey('aurovane:email-bucket:v1')).update(email.toLowerCase()).digest('hex').slice(0, 32);
}

export function newVerificationCode(): string {
  return String(randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(VERIFICATION_CODE_LENGTH, '0');
}

export const FLOW_TTL_MS = 24 * 3600_000;
export const FLOW_COOKIE_DEV = 'aurovane_signup';
export const FLOW_COOKIE_SECURE = '__Host-aurovane_signup';

export function flowCookieName(): string {
  return env().APP_URL.startsWith('https://') ? FLOW_COOKIE_SECURE : FLOW_COOKIE_DEV;
}

export function flowCookieOptions(expires: Date) {
  return { httpOnly: true, secure: env().APP_URL.startsWith('https://'), sameSite: 'lax' as const, path: '/', expires };
}

/** Signed proof that this browser registered (or signed in to) the pending account `userId`. */
export function issueFlowToken(userId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const expires = now + FLOW_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: userId, e: expires, n: randomBytes(9).toString('base64url') })).toString('base64url');
  const mac = createHmac('sha256', derivedKey('aurovane:signup-flow:v1')).update(payload).digest('base64url');
  return { token: `${payload}.${mac}`, expiresAt: new Date(expires) };
}

export function readFlowToken(token: string | null | undefined, now = Date.now()): string | null {
  if (!token || token.length > 400) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', derivedKey('aurovane:signup-flow:v1')).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
    if (typeof data.u !== 'string' || typeof data.e !== 'number' || data.e < now) return null;
    return /^[0-9a-f-]{36}$/.test(data.u) ? data.u : null;
  } catch {
    return null;
  }
}

/** How codes reach players on this deployment. Registration is refused when "unavailable". */
export type VerificationDelivery = 'email' | 'console' | 'unavailable';

export function verificationDelivery(): VerificationDelivery {
  const mailer = getMailer();
  if (mailer.deliversEmail) return 'email';
  return mailer.kind === 'console' ? 'console' : 'unavailable';
}

export function assertCanSendCodes(): void {
  if (verificationDelivery() === 'unavailable') {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'Registration is closed on this site for now: it cannot send verification e-mails yet. Please try again later.',
      { reason: 'email_unavailable' },
    );
  }
}

// ---------------------------------------------------------------------------
// Rate limits beyond the per-account cooldown (fixed windows in PostgreSQL)
// ---------------------------------------------------------------------------

export const VERIFY_LIMITS = {
  /** Code entries per IP (wrong codes are also capped per challenge). */
  verifyIp: { name: 'verify:ip', limit: 30, windowSeconds: 600, by: 'ip' },
  /** New codes (resends, address changes) per IP. */
  sendIp: { name: 'verify-send:ip', limit: 20, windowSeconds: 3600, by: 'ip' },
  /** New codes per destination address, keyed with a server secret. */
  sendAddress: { name: 'verify-send:address', limit: CODES_PER_HOUR, windowSeconds: 3600, by: 'user' },
  /** Registrations per destination address. */
  registerAddress: { name: 'register:address', limit: 5, windowSeconds: 3600, by: 'user' },
} as const satisfies Record<string, RateLimitRule>;

export async function limitAddress(rule: RateLimitRule, email: string): Promise<void> {
  await consume(rule, addressKey(email));
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

interface Allowance {
  ok: boolean;
  retryAfterSeconds: number;
}

/**
 * Whether a new code may be issued now: one per RESEND_COOLDOWN_SECONDS for
 * the same purpose, and CODES_PER_HOUR per account across purposes. A code whose delivery failed may be replaced at
 * once (the player never received it). Counted from the challenge rows, so
 * the limit is exact across instances; call with the account row locked.
 */
async function issueAllowance(tx: Tx, userId: string, now: Date, purpose: Purpose): Promise<Allowance> {
  const recent = await tx
    .select({ createdAt: emailVerificationChallenges.createdAt, delivery: emailVerificationChallenges.delivery, purpose: emailVerificationChallenges.purpose })
    .from(emailVerificationChallenges)
    .where(and(eq(emailVerificationChallenges.userId, userId), gt(emailVerificationChallenges.createdAt, new Date(now.getTime() - 3600_000))))
    .orderBy(desc(emailVerificationChallenges.createdAt));
  const latest = recent.find((r) => r.purpose === purpose);
  if (latest && latest.delivery !== 'FAILED') {
    const wait = Math.ceil((latest.createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000);
    if (wait > 0) return { ok: false, retryAfterSeconds: wait };
  }
  const counted = recent.filter((r) => r.delivery !== 'FAILED');
  if (counted.length >= CODES_PER_HOUR) {
    const oldest = counted[counted.length - 1]!;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest.createdAt.getTime() + 3600_000 - now.getTime()) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

function tooSoon(retryAfterSeconds: number): AppError {
  return new AppError('RATE_LIMITED', `Please wait ${retryAfterSeconds} seconds before requesting another code.`, { retryAfterSeconds });
}

interface Issued {
  challengeId: string;
  code: string;
  email: string;
  purpose: Purpose;
  userId: string;
  expiresAt: Date;
}

/** Supersedes the live challenge (if any) and creates a new one. Call with the account row locked. */
async function createChallenge(tx: Tx, userId: string, purpose: Purpose, email: string, now: Date): Promise<Issued> {
  await tx
    .update(emailVerificationChallenges)
    .set({ supersededAt: now })
    .where(and(eq(emailVerificationChallenges.userId, userId), isNull(emailVerificationChallenges.consumedAt), isNull(emailVerificationChallenges.supersededAt)));
  const id = randomUUID();
  const code = newVerificationCode();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MINUTES * 60_000);
  await tx.insert(emailVerificationChallenges).values({
    id,
    userId,
    purpose,
    email,
    codeMac: codeMac(id, code),
    maxAttempts: VERIFICATION_MAX_ATTEMPTS,
    createdAt: now,
    expiresAt,
  });
  return { challengeId: id, code, email, purpose, userId, expiresAt };
}

function message(issued: Issued) {
  const intro =
    issued.purpose === 'SIGNUP'
      ? 'Welcome to Aurovane. Enter this code to confirm your e-mail address and finish creating your account:'
      : 'Enter this code in your Aurovane account settings to confirm this as your new e-mail address:';
  return {
    to: issued.email,
    subject: issued.purpose === 'SIGNUP' ? `Your Aurovane verification code: ${issued.code}` : `Confirm your new Aurovane e-mail: ${issued.code}`,
    text:
      `${intro}\n\n    ${issued.code}\n\n` +
      `The code expires in ${VERIFICATION_TTL_MINUTES} minutes and works once. Never share it: Aurovane staff will never ask for it.\n\n` +
      `If you did not ask for this, ignore this e-mail; nothing changes without the code.\n\n` +
      `Aurovane uses free virtual chips only. Chips have no monetary value and cannot be bought, withdrawn or exchanged.`,
  };
}

/** Sends the code (after the issuing transaction committed) and records whether it left. */
async function deliver(issued: Issued): Promise<boolean> {
  const ok = await sendNow(message(issued), { purpose: issued.purpose === 'SIGNUP' ? 'email_verification' : 'email_change', userId: issued.userId });
  await getDb()
    .update(emailVerificationChallenges)
    .set({ delivery: ok ? 'SENT' : 'FAILED' })
    .where(eq(emailVerificationChallenges.id, issued.challengeId));
  return ok;
}

async function liveChallenge(tx: Tx, userId: string, purpose: Purpose, lock: boolean) {
  const q = tx
    .select()
    .from(emailVerificationChallenges)
    .where(
      and(
        eq(emailVerificationChallenges.userId, userId),
        eq(emailVerificationChallenges.purpose, purpose),
        isNull(emailVerificationChallenges.consumedAt),
        isNull(emailVerificationChallenges.supersededAt),
      ),
    );
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

type CheckResult =
  | { kind: 'ok'; challenge: typeof emailVerificationChallenges.$inferSelect }
  | { kind: 'none' | 'expired' | 'exhausted' }
  | { kind: 'wrong'; attemptsLeft: number };

/** Checks a code against the live challenge, counting the attempt. Call with the account row locked. */
async function checkCode(tx: Tx, userId: string, purpose: Purpose, code: string, now: Date): Promise<CheckResult> {
  const challenge = await liveChallenge(tx, userId, purpose, true);
  if (!challenge) return { kind: 'none' };
  if (challenge.expiresAt <= now) return { kind: 'expired' };
  if (challenge.attempts >= challenge.maxAttempts) return { kind: 'exhausted' };
  const expected = Buffer.from(challenge.codeMac, 'hex');
  const given = Buffer.from(codeMac(challenge.id, code), 'hex');
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  if (!match) {
    const [row] = await tx
      .update(emailVerificationChallenges)
      .set({ attempts: sql`${emailVerificationChallenges.attempts} + 1` })
      .where(eq(emailVerificationChallenges.id, challenge.id))
      .returning({ attempts: emailVerificationChallenges.attempts });
    return { kind: 'wrong', attemptsLeft: Math.max(0, challenge.maxAttempts - (row?.attempts ?? challenge.maxAttempts)) };
  }
  const claimed = await tx
    .update(emailVerificationChallenges)
    .set({ consumedAt: now, attempts: sql`${emailVerificationChallenges.attempts} + 1` })
    .where(and(eq(emailVerificationChallenges.id, challenge.id), isNull(emailVerificationChallenges.consumedAt), isNull(emailVerificationChallenges.supersededAt)))
    .returning({ id: emailVerificationChallenges.id });
  if (claimed.length !== 1) return { kind: 'none' };
  return { kind: 'ok', challenge };
}

function codeError(result: Exclude<CheckResult, { kind: 'ok' }>): AppError {
  switch (result.kind) {
    case 'wrong':
      return errors.validation(
        result.attemptsLeft > 0
          ? `That code is not correct. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`
          : 'That code is not correct, and this code can no longer be used. Request a new code.',
        { reason: result.attemptsLeft > 0 ? 'incorrect' : 'too_many_attempts', attemptsLeft: result.attemptsLeft },
      );
    case 'expired':
      return errors.validation('This code has expired. Request a new code.', { reason: 'expired' });
    case 'exhausted':
      return errors.validation('Too many incorrect attempts for this code. Request a new code.', { reason: 'too_many_attempts', attemptsLeft: 0 });
    case 'none':
      return errors.validation('There is no active code. Request a new code.', { reason: 'no_code' });
  }
}

export function validCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`).test(code);
}

// ---------------------------------------------------------------------------
// Pending registrations
// ---------------------------------------------------------------------------

/**
 * Frees an e-mail address or username held by a registration that was never
 * verified and is older than PENDING_RECLAIM_HOURS: the stale row is
 * anonymised exactly as a deleted account (it never had a wallet or any
 * activity). Call inside the registering transaction.
 */
export async function reclaimStalePending(tx: Tx, email: string, username: string | null): Promise<void> {
  const stale = await tx.execute<{ id: string }>(sql`
    SELECT id FROM users
     WHERE (email = ${email} OR (${username}::text IS NOT NULL AND username = ${username}))
       AND email_verified_at IS NULL AND status = 'ACTIVE'
       AND created_at < now() - make_interval(hours => ${PENDING_RECLAIM_HOURS})
     ORDER BY id FOR UPDATE`);
  for (const { id } of stale.rows) {
    const now = new Date();
    await tx
      .update(users)
      .set({ email: `deleted-${id}@deleted.invalid`, username: `deleted-${id.slice(0, 8)}`, passwordHash: null, status: 'DELETED', deletedAt: now, updatedAt: now })
      .where(eq(users.id, id));
    await tx
      .update(emailVerificationChallenges)
      .set({ email: 'erased@deleted.invalid', supersededAt: now })
      .where(and(eq(emailVerificationChallenges.userId, id), isNull(emailVerificationChallenges.consumedAt), isNull(emailVerificationChallenges.supersededAt)));
    await audit(tx, { actorType: 'SYSTEM', action: 'user.pending_expired', resourceType: 'user', resourceId: id, metadata: { reason: 'unverified registration reclaimed' } });
  }
}

/** Issues the first code inside the registering transaction (the account never exists without one). */
export function issueSignupChallenge(tx: Tx, userId: string, email: string, now = new Date()): Promise<Issued> {
  return createChallenge(tx, userId, 'SIGNUP', email, now);
}

export { deliver as deliverChallenge };
export type { Issued as IssuedChallenge };

export interface SignupStatus {
  email: string;
  delivery: VerificationDelivery;
  /** Whether the latest code left this server (false: sending failed; request a new one). */
  sent: boolean | null;
  expiresAt: string | null;
  attemptsLeft: number | null;
  resendAvailableAt: string;
}

async function pendingUser(tx: Executor, userId: string, lock: boolean) {
  const q = tx
    .select({ id: users.id, email: users.email, status: users.status, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  const [user] = lock ? await q.for('update') : await q;
  return user ?? null;
}

const FLOW_EXPIRED = 'This verification session has ended. Sign in with your e-mail and password to continue.';

/** State of a pending registration for the verification page; null when the flow is no longer valid. */
export async function signupStatus(userId: string, now = new Date()): Promise<SignupStatus | null> {
  return withTransaction(async (tx) => {
    const user = await pendingUser(tx, userId, false);
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return null;
    const challenge = await liveChallenge(tx, userId, 'SIGNUP', false);
    const allowance = await issueAllowance(tx, userId, now, 'SIGNUP');
    return {
      email: user.email,
      delivery: verificationDelivery(),
      sent: challenge ? (challenge.delivery === 'PENDING' ? null : challenge.delivery === 'SENT') : null,
      expiresAt: challenge?.expiresAt.toISOString() ?? null,
      attemptsLeft: challenge ? Math.max(0, challenge.maxAttempts - challenge.attempts) : null,
      resendAvailableAt: new Date(now.getTime() + allowance.retryAfterSeconds * 1000).toISOString(),
    };
  });
}

async function reissue(userId: string, purpose: Purpose, meta: VerificationMeta, changeTo?: string): Promise<{ sent: boolean; status: SignupStatus | null }> {
  assertCanSendCodes();
  const destination = changeTo ?? (await pendingUser(getDb(), userId, false))?.email;
  if (destination) await limitAddress(VERIFY_LIMITS.sendAddress, destination);
  const now = new Date();
  const issued = await withTransaction(async (tx) => {
    const user = await pendingUser(tx, userId, true);
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) throw new AppError('UNAUTHENTICATED', FLOW_EXPIRED);
    const allowance = await issueAllowance(tx, userId, now, purpose);
    if (!allowance.ok) throw tooSoon(allowance.retryAfterSeconds);
    let email = user.email;
    if (changeTo !== undefined) {
      if (changeTo === user.email) throw errors.validation('That is already the address we are verifying.', { field: 'email' });
      await reclaimStalePending(tx, changeTo, null);
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, changeTo));
      if (taken) throw errors.conflict('An account with this e-mail already exists', { field: 'email' });
      await tx.update(users).set({ email: changeTo, updatedAt: now }).where(eq(users.id, userId));
      email = changeTo;
      await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.signup_email_changed', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null });
    }
    const issued = await createChallenge(tx, userId, purpose, email, now);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.verification_code_sent', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { purpose } });
    return issued;
  }).catch((err) => {
    if (pgErrorCode(err) === '23505' && pgConstraint(err) === 'users_email_key') throw errors.conflict('An account with this e-mail already exists', { field: 'email' });
    throw err;
  });
  const sent = await deliver(issued);
  return { sent, status: await signupStatus(userId) };
}

/** Sends a fresh code for a pending registration (cooldown and hourly limits apply). */
export function resendSignupCode(userId: string, meta: VerificationMeta) {
  return reissue(userId, 'SIGNUP', meta);
}

/** Replaces the address of a pending registration (a typo at sign-up) and sends a code there. */
export function changeSignupEmail(userId: string, email: string, meta: VerificationMeta) {
  return reissue(userId, 'SIGNUP', meta, email);
}

/**
 * Sends a code when an unverified account signs in and has no usable one
 * (none live, expired, used up, or never delivered), within the usual limits.
 * Silent on limits: the verification page offers a resend with its cooldown.
 */
export async function ensureSignupCode(userId: string, meta: VerificationMeta): Promise<void> {
  if (verificationDelivery() === 'unavailable') return;
  const now = new Date();
  const issued = await withTransaction(async (tx) => {
    const user = await pendingUser(tx, userId, true);
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return null;
    const live = await liveChallenge(tx, userId, 'SIGNUP', false);
    if (live && live.expiresAt > now && live.attempts < live.maxAttempts && live.delivery === 'SENT') return null;
    if (!(await issueAllowance(tx, userId, now, 'SIGNUP')).ok) return null;
    const issued = await createChallenge(tx, userId, 'SIGNUP', user.email, now);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.verification_code_sent', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { purpose: 'SIGNUP', trigger: 'login' } });
    return issued;
  });
  if (issued) await deliver(issued);
}

export interface ActivationResult {
  user: { id: string; email: string; username: string; role: string };
  session: { token: string; sessionId: string; expiresAt: Date };
  signupBonus: number;
}

/**
 * Account activation steps shared by code verification and operator-created
 * accounts. Runs inside the caller's transaction, after the caller marked
 * the e-mail verified under the account's row lock, so it happens once.
 */
export async function activateAccount(tx: Tx, userId: string): Promise<number> {
  await createWalletAccount(tx, userId);
  await createSeedPair(tx, userId);
  await ensureLimitsRow(tx, userId);
  return grantSignupBonus(tx, userId);
}

/**
 * Verifies a registration code and activates the account exactly once. A
 * wrong code is counted (and committed) before the error is returned.
 */
export async function verifySignupCode(userId: string, code: string, meta: VerificationMeta): Promise<ActivationResult> {
  if (!validCodeFormat(code)) throw errors.validation(`Enter the ${VERIFICATION_CODE_LENGTH}-digit code from the e-mail`, { reason: 'format' });
  const now = new Date();
  const outcome = await withTransaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.status === 'DELETED') return { kind: 'gone' as const };
    if (user.emailVerifiedAt) return { kind: 'already' as const };
    if (user.status !== 'ACTIVE') return { kind: 'suspended' as const };
    const check = await checkCode(tx, userId, 'SIGNUP', code, now);
    if (check.kind !== 'ok') {
      await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.email_verification_failed', resourceType: 'user', resourceId: userId, outcome: 'FAILED', ipHash: meta.ipHash, metadata: { reason: check.kind } });
      return { kind: 'code' as const, check };
    }
    if (check.challenge.email !== user.email) return { kind: 'code' as const, check: { kind: 'none' as const } };
    await tx
      .update(users)
      .set({ emailVerifiedAt: now, emailVerificationMethod: 'CODE', lastLoginAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, userId));
    const signupBonus = await activateAccount(tx, userId);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'user.email_verified', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { purpose: 'SIGNUP' } });
    const session = await createSession(tx, userId, meta);
    return { kind: 'ok' as const, result: { user: { id: user.id, email: user.email, username: user.username, role: user.role }, session, signupBonus } };
  });
  switch (outcome.kind) {
    case 'ok':
      return outcome.result;
    case 'code':
      throw codeError(outcome.check);
    case 'already':
      throw errors.conflict('This e-mail address is already verified. Sign in to continue.', { reason: 'already_verified' });
    case 'suspended':
      throw errors.forbidden('This account is suspended. Please contact support.');
    case 'gone':
      throw new AppError('UNAUTHENTICATED', FLOW_EXPIRED);
  }
}

// ---------------------------------------------------------------------------
// Changing the e-mail of a verified account
// ---------------------------------------------------------------------------

export interface EmailChangeStatus {
  email: string;
  sent: boolean | null;
  expiresAt: string;
  attemptsLeft: number;
  resendAvailableAt: string;
}

export async function emailChangeStatus(userId: string, now = new Date()): Promise<EmailChangeStatus | null> {
  return withTransaction(async (tx) => {
    const challenge = await liveChallenge(tx, userId, 'EMAIL_CHANGE', false);
    if (!challenge) return null;
    const allowance = await issueAllowance(tx, userId, now, 'EMAIL_CHANGE');
    return {
      email: challenge.email,
      sent: challenge.delivery === 'PENDING' ? null : challenge.delivery === 'SENT',
      expiresAt: challenge.expiresAt.toISOString(),
      attemptsLeft: Math.max(0, challenge.maxAttempts - challenge.attempts),
      resendAvailableAt: new Date(now.getTime() + allowance.retryAfterSeconds * 1000).toISOString(),
    };
  });
}

/**
 * Starts an e-mail change (or, with `email` null, resends the code for the
 * pending one): the password is re-checked for a new address, then a code
 * goes to that address. The account keeps its current address until the code is
 * entered. `email` must already be normalised (emailSchema).
 */
export async function requestEmailChange(userId: string, email: string | null, password: string | null, meta: VerificationMeta): Promise<{ sent: boolean; status: EmailChangeStatus | null }> {
  assertCanSendCodes();
  // Naming a new address needs the password; a resend to the pending address (set with it) does not.
  if (email !== null) {
    const [account] = await getDb().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!password || !account?.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
      throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
    }
  }
  const destination = email ?? (await emailChangeStatus(userId))?.email;
  if (destination) await limitAddress(VERIFY_LIMITS.sendAddress, destination);
  const now = new Date();
  const issued = await withTransaction(async (tx) => {
    const [user] = await tx.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.status !== 'ACTIVE') throw errors.forbidden();
    const target = email ?? (await liveChallenge(tx, userId, 'EMAIL_CHANGE', false))?.email;
    if (!target) throw errors.validation('Enter the new e-mail address and your password', { field: 'email' });
    if (target === user.email) throw errors.validation('That is already your e-mail address.', { field: 'email' });
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, target));
    if (taken) throw errors.conflict('An account with this e-mail already exists', { field: 'email' });
    const allowance = await issueAllowance(tx, userId, now, 'EMAIL_CHANGE');
    if (!allowance.ok) throw tooSoon(allowance.retryAfterSeconds);
    const issued = await createChallenge(tx, userId, 'EMAIL_CHANGE', target, now);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.email_change_requested', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null });
    return issued;
  });
  const sent = await deliver(issued);
  return { sent, status: await emailChangeStatus(userId) };
}

/**
 * Confirms the new address with its code and switches the account to it:
 * every other session and any outstanding password-reset link is revoked, and
 * the previous address is told about the change.
 */
export async function confirmEmailChange(userId: string, currentSessionId: string, code: string, meta: VerificationMeta): Promise<{ email: string }> {
  if (!validCodeFormat(code)) throw errors.validation(`Enter the ${VERIFICATION_CODE_LENGTH}-digit code from the e-mail`, { reason: 'format' });
  const now = new Date();
  const outcome = await withTransaction(async (tx) => {
    const [user] = await tx.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.status !== 'ACTIVE') throw errors.forbidden();
    const check = await checkCode(tx, userId, 'EMAIL_CHANGE', code, now);
    if (check.kind !== 'ok') {
      await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.email_verification_failed', resourceType: 'user', resourceId: userId, outcome: 'FAILED', ipHash: meta.ipHash, metadata: { reason: check.kind, purpose: 'EMAIL_CHANGE' } });
      return { kind: 'code' as const, check };
    }
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, check.challenge.email));
    if (taken) return { kind: 'taken' as const };
    await tx
      .update(users)
      .set({ email: check.challenge.email, emailVerifiedAt: now, emailVerificationMethod: 'CODE', updatedAt: now })
      .where(eq(users.id, userId));
    await revokeAllSessions(tx, userId, currentSessionId);
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.email_changed', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null });
    return { kind: 'ok' as const, previous: user.email, next: check.challenge.email };
  }).catch((err) => {
    if (pgErrorCode(err) === '23505' && pgConstraint(err) === 'users_email_key') return { kind: 'taken' as const };
    throw err;
  });
  if (outcome.kind === 'code') throw codeError(outcome.check);
  if (outcome.kind === 'taken') throw errors.conflict('Another account now uses this e-mail address. Choose a different one.', { field: 'email' });
  sendInBackground(
    {
      to: outcome.previous,
      subject: 'Your Aurovane e-mail address was changed',
      text:
        `The e-mail address of your Aurovane account was changed to ${maskAddress(outcome.next)}.\n\n` +
        `Other devices were signed out. If you did not make this change, reset your password and contact support straight away.`,
    },
    { purpose: 'email_changed_notice', userId },
  );
  return { email: outcome.next };
}

/** Abandons a pending e-mail change; the current address stays. */
export async function cancelEmailChange(userId: string, meta: VerificationMeta): Promise<void> {
  await withTransaction(async (tx) => {
    const cancelled = await tx
      .update(emailVerificationChallenges)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(emailVerificationChallenges.userId, userId),
          eq(emailVerificationChallenges.purpose, 'EMAIL_CHANGE'),
          isNull(emailVerificationChallenges.consumedAt),
          isNull(emailVerificationChallenges.supersededAt),
        ),
      )
      .returning({ id: emailVerificationChallenges.id });
    if (cancelled.length) await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.email_change_cancelled', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash });
  });
}
