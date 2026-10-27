/**
 * Player account lifecycle: registration (pending until the e-mail code is
 * entered, see verification.ts), login, password management, data export and
 * deletion (anonymisation that preserves financial and audit records, which
 * must be retained).
 */
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomToken, sha256Hex } from '../crypto';
import { getDb, pgConstraint, pgErrorCode, withTransaction } from '../db/client';
import {
  auditLogs,
  bonuses,
  emailVerificationChallenges,
  gameRounds,
  ledgerAccounts,
  passwordResetTokens,
  responsibleLimits,
  seedPairs,
  sessions,
  sportsTickets,
  userAchievements,
  userFavorites,
  users,
  userSportsFavorites,
} from '../db/schema';
import { env } from '../env';
import { AppError, errors } from '../errors';
import { audit } from '../audit/audit';
import { getWalletAccount, lockWalletAccount } from '../ledger/accounts';
import { dummyVerify, hashPassword, needsRehash, passwordProblems, verifyPassword } from '../auth/password';
import { createSession, revokeAllSessions } from '../auth/sessions';
import { issueMfaChallenge, mfaEnabled } from '../auth/mfa';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { consume, type RateLimitRule } from '../http/rate-limit';
import { getMailer, runInBackground, sendInBackground } from '../mail/mailer';
import { listTransactions } from '../wallet/wallet';
import { MINIMUM_AGE, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/account-policy';
import {
  activateAccount,
  assertCanSendCodes,
  deliverChallenge,
  ensureSignupCode,
  issueFlowToken,
  issueSignupChallenge,
  limitAddress,
  reclaimStalePending,
  VERIFY_LIMITS,
  type IssuedChallenge,
} from './verification';

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
    confirmPassword: z.string().max(200),
    ageConfirmed: z.literal(true, { message: `You must confirm you are at least ${MINIMUM_AGE} years old` }),
    chipsAcknowledged: z.literal(true, { message: 'You must acknowledge that chips are virtual and have no monetary value' }),
    termsAccepted: z.literal(true, { message: 'You must accept the Terms of Service and acknowledge the Privacy Notice' }),
  })
  .strict()
  .refine((r) => r.password === r.confirmPassword, { message: 'The passwords do not match', path: ['confirmPassword'] });

export interface RequestMeta {
  ipHash: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

function validationIssues(error: z.ZodError) {
  return { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

function duplicateAccount(err: unknown): AppError | null {
  if (pgErrorCode(err) !== '23505') return null;
  const c = pgConstraint(err);
  if (c === 'users_email_key') return errors.conflict('An account with this e-mail already exists', { field: 'email' });
  if (c === 'users_username_key') return errors.conflict('This username is taken. Try another one.', { field: 'username' });
  return null;
}

/**
 * Step 1 of the journey: creates a pending account and e-mails a
 * verification code. No session, wallet, seeds or chips exist until the code
 * is entered (verifySignupCode). Refused outright when this deployment cannot
 * send e-mail, so no account is created that could never be verified. A
 * failed delivery leaves the account pending; the verification page offers a
 * resend straight away.
 */
export async function register(raw: z.input<typeof registerSchema>, meta: RequestMeta) {
  assertCanSendCodes();
  // Validate here too (not only at the HTTP edge) so every caller gets normalised input.
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) throw errors.validation('Check the highlighted fields', validationIssues(parsed.error));
  const input = parsed.data;
  const problems = passwordProblems(input.password, { email: input.email, username: input.username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  await limitAddress(VERIFY_LIMITS.registerAddress, input.email);
  const passwordHash = await hashPassword(input.password);
  let issued: IssuedChallenge;
  let user: { id: string; email: string; username: string };
  try {
    ({ user, issued } = await withTransaction(async (tx) => {
      await reclaimStalePending(tx, input.email, input.username);
      const now = new Date();
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          username: input.username,
          passwordHash,
          onboardingRequired: true,
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: now,
          privacyVersion: PRIVACY_VERSION,
          privacyAcceptedAt: now,
        })
        .returning({ id: users.id, email: users.email, username: users.username });
      await audit(tx, {
        actorId: user!.id,
        actorType: 'USER',
        action: 'user.registered',
        resourceType: 'user',
        resourceId: user!.id,
        ipHash: meta.ipHash,
        requestId: meta.requestId ?? null,
        metadata: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
      });
      const issued = await issueSignupChallenge(tx, user!.id, user!.email, now);
      return { user: user!, issued };
    }, { retries: 0 }));
  } catch (err) {
    throw duplicateAccount(err) ?? err;
  }
  const sent = await deliverChallenge(issued);
  return { user, sent, flow: issueFlowToken(user.id), expiresAt: issued.expiresAt };
}

/**
 * Accounts created by operator scripts (seed data, load tests, end-to-end
 * fixtures), never by an HTTP request: no e-mail round trip, the address is
 * recorded as verified by OPERATOR, and the usual activation runs (wallet,
 * seeds, limits, welcome chips). `onboarding: 'exempt'` skips the player
 * details step (nothing is invented for it); 'required' leaves it pending.
 */
export async function createOperatorAccount(
  input: { email: string; username: string; password: string },
  meta: RequestMeta,
  opts: { onboarding: 'exempt' | 'required'; session?: boolean },
) {
  const email = emailSchema.parse(input.email);
  const username = usernameSchema.parse(input.username);
  const problems = passwordProblems(input.password, { email, username });
  if (problems.length) throw errors.validation('Password does not meet the policy', { password: problems });
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      const now = new Date();
      const [user] = await tx
        .insert(users)
        .values({ email, username, passwordHash, emailVerifiedAt: now, emailVerificationMethod: 'OPERATOR', onboardingRequired: opts.onboarding === 'required' })
        .returning({ id: users.id, email: users.email, username: users.username, role: users.role });
      const signupBonus = await activateAccount(tx, user!.id);
      await audit(tx, { actorType: 'SYSTEM', action: 'user.created_by_operator', resourceType: 'user', resourceId: user!.id, metadata: { onboarding: opts.onboarding } });
      const session = opts.session ? await createSession(tx, user!.id, meta) : null;
      return { user: user!, signupBonus, session };
    }, { retries: 0 });
  } catch (err) {
    throw duplicateAccount(err) ?? err;
  }
}

/** Thrown by login() for an unverified account after a correct password: the route sets the signup-flow cookie. */
export class VerificationRequiredError extends AppError {
  constructor(
    readonly flow: { token: string; expiresAt: Date },
    readonly email: string,
  ) {
    super('EMAIL_NOT_VERIFIED', 'Confirm your e-mail address to finish creating your account. We have sent you a code.', { next: '/verify-email' });
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
    metrics.inc('casino_login_failures_total', { reason: 'unknown_account' });
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
    metrics.inc('casino_login_failures_total', { reason: lock ? 'locked_now' : 'wrong_password' });
    throw genericFailure();
  }
  if (user.status === 'SUSPENDED') {
    throw errors.forbidden('This account is suspended. Please contact support.');
  }
  if (!user.emailVerifiedAt) {
    // The password was right, so this reveals nothing about which addresses exist.
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, user.id));
    await ensureSignupCode(user.id, meta);
    throw new VerificationRequiredError(issueFlowToken(user.id), user.email);
  }
  if (await mfaEnabled(db, user.id)) {
    // The password was right: clear the failure counter, but issue no session until
    // the second factor is proven (completeMfaLogin exchanges the challenge).
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, user.id));
    throw new AppError('MFA_REQUIRED', 'Enter the code from your authenticator app', { challenge: issueMfaChallenge(user.id) });
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
    return {
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
      session,
      onboardingPending: user.onboardingRequired && user.onboardingCompletedAt === null,
    };
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
    // A reset link requested before the change must not be able to undo it.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
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
 * whether or not the address belongs to an account: everything that depends
 * on the account (lookup, token, audit, e-mail) runs in the background, and
 * the result only says how this deployment delivers resets. No token is
 * created when nothing can deliver it.
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
  runInBackground('password_reset', () => issueResetLink(email.data, meta));
  return { recovery };
}

/** Creates a reset token for an active account and e-mails it; nothing for any other address. */
async function issueResetLink(email: string, meta: RequestMeta): Promise<void> {
  const token = randomToken(32);
  const userId = await withTransaction(async (tx) => {
    // Locking the account serialises concurrent requests, so only the newest link works.
    const [user] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, email)).for('update');
    if (!user || user.status !== 'ACTIVE') return null;
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) });
    await audit(tx, { actorId: user.id, actorType: 'USER', action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id, ipHash: meta.ipHash });
    return user.id;
  });
  if (!userId) return;
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  sendInBackground(
    {
      to: email,
      subject: 'Reset your Aurovane password',
      text:
        `Someone (hopefully you) asked to reset the password for this Aurovane account.\n\n` +
        `Open this link within 30 minutes to choose a new password. It works once:\n${link}\n\n` +
        `If you did not ask for this, ignore this e-mail; your password stays the same.\n\n` +
        `Aurovane uses non-redeemable virtual chips only.`,
    },
    { purpose: 'password_reset', userId },
  );
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
      displayName: users.displayName,
      avatar: users.avatar,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      emailVerifiedAt: users.emailVerifiedAt,
      emailVerificationMethod: users.emailVerificationMethod,
      firstName: users.firstName,
      lastName: users.lastName,
      dateOfBirth: users.dateOfBirth,
      countryCode: users.countryCode,
      phoneE164: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
      onboardingRequired: users.onboardingRequired,
      onboardingCompletedAt: users.onboardingCompletedAt,
      termsVersion: users.termsVersion,
      termsAcceptedAt: users.termsAcceptedAt,
      privacyVersion: users.privacyVersion,
      privacyAcceptedAt: users.privacyAcceptedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  // Codes are never stored; only when and where each one was sent.
  const emailVerifications = await db
    .select({
      purpose: emailVerificationChallenges.purpose,
      email: emailVerificationChallenges.email,
      delivery: emailVerificationChallenges.delivery,
      createdAt: emailVerificationChallenges.createdAt,
      expiresAt: emailVerificationChallenges.expiresAt,
      consumedAt: emailVerificationChallenges.consumedAt,
    })
    .from(emailVerificationChallenges)
    .where(eq(emailVerificationChallenges.userId, userId))
    .orderBy(desc(emailVerificationChallenges.createdAt));
  const wallet = await getWalletAccount(db, userId);
  const favorites = await db.select({ gameId: userFavorites.gameId, createdAt: userFavorites.createdAt }).from(userFavorites).where(eq(userFavorites.userId, userId));
  const achievements = await db
    .select({ achievementId: userAchievements.achievementId, awardedAt: userAchievements.awardedAt })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  const sportsPredictions = await db
    .select({
      id: sportsTickets.id,
      eventId: sportsTickets.eventId,
      selection: sportsTickets.selectionCode,
      stake: sportsTickets.stake,
      oddsE2: sportsTickets.oddsE2,
      potentialReturn: sportsTickets.potentialReturn,
      status: sportsTickets.status,
      rejectReason: sportsTickets.rejectReason,
      payout: sportsTickets.payout,
      placedAt: sportsTickets.placedAt,
      settledAt: sportsTickets.settledAt,
    })
    .from(sportsTickets)
    .where(eq(sportsTickets.userId, userId))
    .orderBy(desc(sportsTickets.placedAt));
  const sportsFavorites = await db.select({ kind: userSportsFavorites.kind, refId: userSportsFavorites.refId }).from(userSportsFavorites).where(eq(userSportsFavorites.userId, userId));
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
    emailVerifications,
    activity,
    favorites,
    achievements,
    sportsPredictions,
    sportsFavorites,
  };
}

/**
 * Account deletion. Personal data is erased (e-mail, username, password,
 * preferences, names, date of birth, country, phone number, the addresses
 * verification codes were sent to, session metadata); financial records (ledger, rounds, bets, payouts)
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
    if (user.role === 'OWNER') {
      // Every owner row, in id order (as role and status changes lock them), before counting.
      const owners = await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM users WHERE role = 'OWNER' ORDER BY id FOR UPDATE`);
      if (!owners.rows.some((o) => o.id !== userId && o.status === 'ACTIVE')) {
        throw errors.conflict('You are the last active owner. Make another account owner before deleting this one.');
      }
    }
    // Same lock order as a wager (user row via its idempotency key, then wallet): a wager
    // already in flight commits first and is counted below; a later one sees DELETED.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await lockWalletAccount(tx, userId);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gameRounds)
      .where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'OPEN')));
    if ((open?.n ?? 0) > 0) throw errors.conflict('Finish your open game rounds before deleting your account');
    const [openTickets] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sportsTickets)
      .where(and(eq(sportsTickets.userId, userId), inArray(sportsTickets.status, ['ACCEPTED', 'SUSPENDED'])));
    if ((openTickets?.n ?? 0) > 0) throw errors.conflict('Wait until your open sports predictions are settled before deleting your account');
    const short = userId.slice(0, 8);
    await tx
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        username: `deleted-${short}`,
        passwordHash: null,
        status: 'DELETED',
        preferences: {},
        displayName: null,
        avatar: null,
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        countryCode: null,
        phoneE164: null,
        phoneVerifiedAt: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    // Codes were never stored; erase the addresses they were sent to.
    await tx
      .update(emailVerificationChallenges)
      .set({ email: 'erased@deleted.invalid', supersededAt: sql`coalesce(${emailVerificationChallenges.supersededAt}, now())` })
      .where(eq(emailVerificationChallenges.userId, userId));
    await tx.update(sessions).set({ userAgent: null, ipHash: null }).where(eq(sessions.userId, userId));
    await tx.delete(userFavorites).where(eq(userFavorites.userId, userId));
    await tx.delete(userSportsFavorites).where(eq(userSportsFavorites.userId, userId));
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
