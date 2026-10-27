import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, getPool } from '@/server/db/client';
import { games, platformSettings, riskLimits } from '@/server/db/schema';
import { register } from '@/server/users/accounts';
import { completeOnboarding } from '@/server/users/onboarding';
import { verifySignupCode } from '@/server/users/verification';
import { latestCode, withMailbox } from '../support/mailbox';
import { runChecks } from '@/server/jobs/reconciliation';

let counter = 0;

/**
 * A player created through the real journey: register (pending, code e-mailed
 * to the capture mailer) → verify the code (activation: wallet, seeds, limits,
 * welcome chips, session) → complete onboarding. Pass `stopAt` to get an
 * account part-way through.
 */
export async function newPlayer(prefix = 'p', opts: { stopAt?: 'registered' | 'verified' } = {}) {
  counter += 1;
  const tag = `${prefix}${Date.now().toString(36)}${counter}${randomUUID().slice(0, 4)}`.replace(/-/g, '');
  const email = `${tag}@example.test`;
  const meta = { ipHash: null, userAgent: 'vitest' };
  return withMailbox(async () => {
    const reg = await register({ email, username: tag.slice(0, 32), password: PLAYER_PASSWORD, confirmPassword: PLAYER_PASSWORD, ageConfirmed: true, chipsAcknowledged: true, termsAccepted: true }, meta);
    if (opts.stopAt === 'registered') return { userId: reg.user.id, sessionId: '', token: '', email, flowToken: reg.flow.token };
    const verified = await verifySignupCode(reg.user.id, latestCode(email), meta);
    if (opts.stopAt !== 'verified') await completeOnboarding(reg.user.id, ONBOARDING_SAMPLE, meta);
    return { userId: reg.user.id, sessionId: verified.session.sessionId, token: verified.session.token, email, flowToken: reg.flow.token };
  });
}

export const PLAYER_PASSWORD = 'correct horse battery staple';

/** Test fixture details (example.test persona; the number is in Ofcom's range reserved for drama). */
export const ONBOARDING_SAMPLE = {
  firstName: 'Ana María',
  lastName: "O'Connor-Nguyễn",
  dateOfBirth: '1990-04-15',
  countryCode: 'GB',
  phoneRegion: 'GB',
  phoneNumber: '020 7946 0018',
};

export function key(): string {
  return randomUUID();
}

export async function expectLedgerConsistent(): Promise<void> {
  const results = await runChecks();
  const failing = results.filter((r) => r.mismatches > 0);
  if (failing.length) throw new Error(`reconciliation failed: ${JSON.stringify(failing, null, 2)}`);
}

export async function setGameStatus(gameId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED') {
  await getDb().update(games).set({ status }).where(eq(games.id, gameId));
}

export async function setRiskLimits(gameId: string, patch: Partial<typeof riskLimits.$inferInsert>) {
  await getDb().update(riskLimits).set(patch).where(eq(riskLimits.gameId, gameId));
}

export async function setPlatform(patch: Partial<typeof platformSettings.$inferInsert>) {
  await getDb().update(platformSettings).set(patch).where(eq(platformSettings.id, 1));
}

/** Concatenated messages along an error's cause chain (Drizzle wraps pg errors). */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i += 1) {
    if (current instanceof Error) parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!err) throw new Error(`expected database error matching ${pattern}, but the statement succeeded`);
  const text = errorText(err);
  if (!pattern.test(text)) throw new Error(`expected error matching ${pattern}, got: ${text}`);
}

/** Holds the player's wallet lock in another connection until the returned function is called. */
export async function holdWalletLock(userId: string): Promise<() => Promise<void>> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM ledger_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
  return async () => {
    await client.query('COMMIT');
    client.release();
  };
}

/** Barrier: resolves once `n` sessions of this database are blocked on a lock (observed, not slept on). */
export async function lockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 1_000; i += 1) {
    const res = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0`,
    );
    if (res.rows[0]!.n >= n) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${n} blocked session(s)`);
}
