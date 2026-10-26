/**
 * Player account lifecycle: registration, login, password management, data
 * export and deletion (anonymisation that preserves financial and audit
 * records, which must be retained).
 */
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomToken, sha256Hex } from '../crypto';
import { getDb, pgConstraint, pgErrorCode, withTransaction } from '../db/client';
import {
  auditLogs,
  bonuses,
  gameRounds,
  ledgerAccounts,
  passwordResetTokens,
  responsibleLimits,
  seedPairs,
  sessions,
  users,
} from '../db/schema';
import { env } from '../env';
import { AppError, errors } from '../errors';
import { audit } from '../audit/audit';
import { createWalletAccount, getWalletAccount } from '../ledger/accounts';
import { createSeedPair } from '../fairness/seeds';
import { ensureLimitsRow } from '../responsible/limits';
import { grantSignupBonus } from '../promotions/bonuses';
import { dummyVerify, hashPassword, needsRehash, passwordProblems, verifyPassword } from '../auth/password';
import { createSession, revokeAllSessions } from '../auth/sessions';
import { logger } from '../observability/logger';
import { listTransactions } from '../wallet/wallet';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid e-mail address' }));
export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,32}$/, 'Username must be 3–32 characters: letters, digits, "_", "." or "-"');
export const passwordSchema = z.string().min(1).max(200);

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    ageConfirmed: z.literal(true, { message: 'You must confirm you are at least 18 years old' }),
    termsAccepted: z.literal(true, { message: 'You must accept the terms (virtual currency only)' }),
  })
  .strict();

export interface RequestMeta {
  ipHash: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export async function register(input: z.infer<typeof registerSchema>, meta: RequestMeta) {
  const problems = passwordProblems(input.password, { email: input.email, username: input.username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, username: input.username, passwordHash })
        .returning({ id: users.id, email: users.email, username: users.username, role: users.role });
      await createWalletAccount(tx, user!.id);
      await createSeedPair(tx, user!.id);
      await ensureLimitsRow(tx, user!.id);
      const bonus = await grantSignupBonus(tx, user!.id);
      await audit(tx, {
        actorId: user!.id,
        actorType: 'USER',
        action: 'user.registered',
        resourceType: 'user',
        resourceId: user!.id,
        ipHash: meta.ipHash,
        requestId: meta.requestId ?? null,
      });
      const session = await createSession(tx, user!.id, meta);
      return { user: user!, session, signupBonus: bonus };
    }, { retries: 0 });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      const c = pgConstraint(err);
      if (c === 'users_email_key') throw errors.conflict('An account with this e-mail already exists', { field: 'email' });
      if (c === 'users_username_key') throw errors.conflict('This username is taken', { field: 'username' });
    }
    throw err;
  }
}

export async function login(emailRaw: string, password: string, meta: RequestMeta) {
  const email = emailSchema.safeParse(emailRaw);
  const db = getDb();
  const [user] = email.success
    ? await db.select().from(users).where(eq(users.email, email.data))
    : [];
  const genericFailure = () => new AppError('UNAUTHENTICATED', 'Incorrect e-mail or password');

  if (!user || !user.passwordHash || user.status === 'DELETED') {
    await dummyVerify(password);
    await audit(db, { actorType: 'ANONYMOUS', action: 'auth.login_failed', ipHash: meta.ipHash, metadata: { reason: 'unknown_account' } });
    throw genericFailure();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyVerify(password);
    throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
      lockedUntil: user.lockedUntil.toISOString(),
    });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await audit(db, {
      actorId: user.id,
      actorType: 'USER',
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      resourceType: 'user',
      resourceId: user.id,
      ipHash: meta.ipHash,
    });
    throw genericFailure();
  }
  if (user.status === 'SUSPENDED') {
    throw errors.forbidden('This account is suspended. Please contact support.');
  }
  return withTransaction(async (tx) => {
    const upgrades = needsRehash(user.passwordHash!) ? { passwordHash: await hashPassword(password) } : {};
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date(), ...upgrades })
      .where(eq(users.id, user.id));
    await audit(tx, {
      actorId: user.id,
      actorType: 'USER',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      ipHash: meta.ipHash,
      requestId: meta.requestId ?? null,
    });
    const session = await createSession(tx, user.id, meta);
    return { user: { id: user.id, email: user.email, username: user.username, role: user.role }, session };
  });
}

export async function changePassword(userId: string, sessionId: string, current: string, next: string, meta: RequestMeta) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
  }
  const problems = passwordProblems(next, { email: user.email, username: user.username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  const hash = await hashPassword(next);
  await withTransaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId));
    await revokeAllSessions(tx, userId, sessionId);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.password_changed', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash });
  });
}

/**
 * Starts a password reset. Always succeeds from the caller's point of view so
 * the endpoint cannot be used to discover registered e-mail addresses.
 */
export async function requestPasswordReset(emailRaw: string, meta: RequestMeta): Promise<void> {
  const email = emailSchema.safeParse(emailRaw);
  if (!email.success) return;
  const db = getDb();
  const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, email.data));
  if (!user || user.status !== 'ACTIVE') return;
  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  await audit(db, { actorId: user.id, actorType: 'USER', action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id, ipHash: meta.ipHash });
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  if (env().MAIL_TRANSPORT === 'console' && env().NODE_ENV !== 'production') {
    // Development-only delivery channel. Never enabled in production.
    process.stdout.write(`\n[dev mailer] Password reset link for ${email.data}: ${link}\n\n`);
  } else {
    logger.warn('password reset requested but no mail transport is configured', { userId: user.id });
  }
}

export async function resetPassword(token: string, next: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, sha256Hex(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    );
  if (!row) throw errors.validation('This reset link is invalid or has expired');
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || user.status === 'DELETED') throw errors.validation('This reset link is invalid or has expired');
  const problems = passwordProblems(next, { email: user.email, username: user.username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  const hash = await hashPassword(next);
  await withTransaction(async (tx) => {
    const used = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (used.length === 0) throw errors.validation('This reset link has already been used');
    await tx
      .update(users)
      .set({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await revokeAllSessions(tx, row.userId);
    await audit(tx, { actorId: row.userId, actorType: 'USER', action: 'auth.password_reset', resourceType: 'user', resourceId: row.userId, ipHash: meta.ipHash });
  });
}

export const preferencesSchema = z
  .object({
    reducedMotion: z.boolean().optional(),
    hideBalance: z.boolean().optional(),
  })
  .strict();

export async function updatePreferences(userId: string, prefs: z.infer<typeof preferencesSchema>) {
  const db = getDb();
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  const merged = { ...(user?.preferences ?? {}), ...prefs };
  await db.update(users).set({ preferences: merged, updatedAt: new Date() }).where(eq(users.id, userId));
  return merged;
}

/** Everything we hold about the player, as JSON (data-portability request). */
export async function exportUserData(userId: string) {
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      status: users.status,
      preferences: users.preferences,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const wallet = await getWalletAccount(db, userId);
  const [limits] = await db.select().from(responsibleLimits).where(eq(responsibleLimits.userId, userId));
  const rounds = await db
    .select({
      id: gameRounds.id,
      gameId: gameRounds.gameId,
      status: gameRounds.status,
      stake: gameRounds.stakeTotal,
      payout: gameRounds.payoutTotal,
      startedAt: gameRounds.startedAt,
      settledAt: gameRounds.settledAt,
      nonce: gameRounds.nonce,
      clientSeed: gameRounds.clientSeed,
      serverSeedHash: gameRounds.serverSeedHash,
    })
    .from(gameRounds)
    .where(eq(gameRounds.userId, userId))
    .orderBy(desc(gameRounds.startedAt));
  const activity = await db
    .select({ action: auditLogs.action, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, userId))
    .orderBy(desc(auditLogs.createdAt));
  const sessionRows = await db
    .select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, revokedAt: sessions.revokedAt, userAgent: sessions.userAgent })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  const bonusRows = await db.select({ type: bonuses.type, amount: bonuses.amount, createdAt: bonuses.createdAt }).from(bonuses).where(eq(bonuses.userId, userId));
  const seeds = await db
    .select({ serverSeedHash: seedPairs.serverSeedHash, clientSeed: seedPairs.clientSeed, status: seedPairs.status, revealedServerSeed: seedPairs.revealedServerSeed })
    .from(seedPairs)
    .where(eq(seedPairs.userId, userId));
  const transactions = await listTransactions(userId, { limit: 10_000 });
  return {
    exportedAt: new Date().toISOString(),
    currency: 'CHIP (virtual, no monetary value; amounts in minor units, 100 = 1 chip)',
    user,
    wallet: wallet ? { balance: wallet.balance } : null,
    responsibleLimits: limits ?? null,
    rounds,
    transactions,
    bonuses: bonusRows,
    seeds,
    sessions: sessionRows,
    activity,
  };
}

/**
 * Account deletion. Personal data is erased (e-mail, username, password,
 * preferences, sessions); financial records (ledger, rounds, bets, payouts)
 * and audit logs are retained in pseudonymised form because they must stay
 * reconcilable and auditable. Open rounds must be finished first so no stake
 * is left in limbo.
 */
export async function deleteAccount(userId: string, password: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
  }
  await withTransaction(async (tx) => {
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gameRounds)
      .where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'OPEN')));
    if ((open?.n ?? 0) > 0) throw errors.conflict('Finish your open game rounds before deleting your account');
    const short = userId.slice(0, 8);
    await tx
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        username: `deleted-${short}`,
        passwordHash: null,
        status: 'DELETED',
        preferences: {},
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.update(sessions).set({ userAgent: null, ipHash: null }).where(eq(sessions.userId, userId));
    await revokeAllSessions(tx, userId);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'user.deleted', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash });
  });
}

export async function userActivity(userId: string, limit = 50) {
  return getDb()
    .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, resourceType: auditLogs.resourceType })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function walletAccountId(userId: string): Promise<number | undefined> {
  const [row] = await getDb().select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.userId, userId));
  return row?.id;
}
