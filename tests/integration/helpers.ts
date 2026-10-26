import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { games, platformSettings, riskLimits } from '@/server/db/schema';
import { register } from '@/server/users/accounts';
import { runChecks } from '@/server/jobs/reconciliation';

let counter = 0;

export async function newPlayer(prefix = 'p') {
  counter += 1;
  const tag = `${prefix}${Date.now().toString(36)}${counter}${randomUUID().slice(0, 4)}`.replace(/-/g, '');
  const res = await register(
    {
      email: `${tag}@example.test`,
      username: tag.slice(0, 32),
      password: 'correct horse battery staple',
      ageConfirmed: true,
      termsAccepted: true,
    },
    { ipHash: null, userAgent: 'vitest' },
  );
  return { userId: res.user.id, sessionId: res.session.sessionId, token: res.session.token, email: `${tag}@example.test` };
}

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
