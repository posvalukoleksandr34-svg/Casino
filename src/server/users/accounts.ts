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
import { consume, type RateLimitRule } from '../http/rate-limit';
import { getMailer, sendInBackground } from '../mail/mailer';
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

export async function register(raw: z.input<typeof registerSchema>, meta: RequestMeta) {
  // Validate here too (not only at the HTTP edge) so every caller gets normalised input.
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    throw errors.validation('Invalid registration', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const input = parsed.data;
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
  // Reserve this attempt atomically before checking the password: concurrent
  // guesses are counted exactly (row lock), so no more than MAX_FAILED_LOGINS
  // passwords can be tried per lockout window, however many run in parallel.
  const reserved = await db.execute<{ attempt: number }>(sql`
    UPDATE users SET failed_login_count = failed_login_count + 1, updated_at = now()
     WHERE id = ${user.id} AND (locked_until IS NULL OR locked_until <= now())
    RETURNING failed_login_count AS attempt`);
  const attempt = reserved.rows[0]?.attempt;
  const lockedError = (until: Date | null) =>
    new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { lockedUntil: (until ?? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)).toISOString() });
  const lockNow = async () => {
    const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: until, updatedAt: new Date() }).where(eq(users.id, user.id));
    return until;
  };
  if (attempt === undefined) {
    await dummyVerify(password);
    const [current] = await db.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, user.id));
    throw lockedError(current?.lockedUntil ?? null);
  }
  if (attempt > MAX_FAILED_LOGINS) {
    // Lost a race with the attempt that reached the limit: never verified.
    await dummyVerify(password);
    throw lockedError(await lockNow());
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const lock = attempt >= MAX_FAILED_LOGINS;
    if (lock) await lockNow();
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

/** How a password-reset request is fulfilled on this deployment (same for every address). */
export type PasswordRecovery = 'email' | 'console' | 'unavailable';

export function passwordRecoveryMode(): PasswordRecovery {
  const mailer = getMailer();
  if (mailer.deliversEmail) return 'email';
  return mailer.kind === 'console' ? 'console' : 'unavailable';
}

export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Reset e-mails per address per hour; extra requests are dropped silently (no enumeration signal). */
const RESET_EMAILS_PER_ADDRESS: RateLimitRule = { name: 'pwreset:address', limit: 3, windowSeconds: 3600, by: 'user' };

/**
 * Starts a password reset. The response — and its timing — is the same
 * whether or not the address belongs to an account: delivery happens in the
 * background and the result only says how this deployment delivers resets.
 * No token is created when nothing can deliver it.
 */
export async function requestPasswordReset(emailRaw: string, meta: RequestMeta): Promise<{ recovery: PasswordRecovery }> {
  const recovery = passwordRecoveryMode();
  if (recovery === 'unavailable') return { recovery };
  const email = emailSchema.safeParse(emailRaw);
  if (!email.success) return { recovery };
  try {
    await consume(RESET_EMAILS_PER_ADDRESS, sha256Hex(`pwreset:${email.data}`));
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') {
      logger.warn('password reset e-mail throttled for an address', {});
      return { recovery };
    }
    throw err;
  }
  const db = getDb();
  const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, email.data));
  if (!user || user.status !== 'ACTIVE') return { recovery };
  const token = randomToken(32);
  await withTransaction(async (tx) => {
    // Only the newest link works.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) });
    await audit(tx, { actorId: user.id, actorType: 'USER', action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id, ipHash: meta.ipHash });
  });
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  sendInBackground(
    {
      to: email.data,
      subject: 'Reset your Aurovane password',
      text:
        `Someone (hopefully you) asked to reset the password for this Aurovane account.\n\n` +
        `Open this link within 30 minutes to choose a new password. It works once:\n${link}\n\n` +
        `If you did not ask for this, ignore this e-mail; your password stays the same.\n\n` +
        `Aurovane uses non-redeemable virtual chips only.`,
    },
    { purpose: 'password_reset', userId: user.id },
  );
  return { recovery };
}

const INVALID_RESET = 'This reset link is invalid or has expired';

/**
 * Redeems a reset token exactly once. The token is claimed with a single
 * conditional UPDATE (unused AND unexpired, re-checked at claim time), so
 * concurrent redemptions cannot both succeed. All of the user's other reset
 * links and every session are revoked.
 */
export async function resetPassword(token: string, next: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())));
  if (!row) throw errors.validation(INVALID_RESET);
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || user.status === 'DELETED') throw errors.validation(INVALID_RESET);
  const problems = passwordProblems(next, { email: user.email, username: user.username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  const hash = await hashPassword(next);
  await withTransaction(async (tx) => {
    const now = new Date();
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) throw errors.validation(INVALID_RESET);
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
    await tx
      .update(users)
      .set({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
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
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
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
