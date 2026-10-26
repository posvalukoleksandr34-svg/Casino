/** Regression tests for defects found in the game/money audit. */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { multiplierAt, type CrashState } from '@/engine/games/crash';
import { MAX_STAKE } from '@/engine/money';
import { getDb, getPool } from '@/server/db/client';
import { gameRounds } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { actOnRound, startRound } from '@/server/games/round-service';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

describe('oversized stakes are rejected as input errors, never as internal errors', () => {
  it.each([
    ['dice', (a: number) => ({ amount: a, target: 100, direction: 'under' })],
    ['roulette', (a: number) => ({ bets: [{ type: 'straight', number: 1, amount: a }] })],
    ['mines', (a: number) => ({ amount: a, mines: 24 })],
    ['crash', (a: number) => ({ amount: a })],
    ['blackjack', (a: number) => ({ amount: a })],
  ])('%s', async (game, bet) => {
    const p = await newPlayer('big');
    const before = (await getWalletAccount(getDb(), p.userId))!.balance;
    // Previously 1e14 passed the schema and overflowed the payout arithmetic (HTTP 500).
    for (const amount of [100_000_000_000_000, MAX_STAKE + 1]) {
      const err = await startRound({ userId: p.userId, gameId: game, bet: bet(amount), idempotencyKey: key() }).catch((e) => e);
      expect(code(err)).toBe('VALIDATION_ERROR');
    }
    // The largest schema-valid stake reaches the table limits / balance checks normally.
    const err = await startRound({ userId: p.userId, gameId: game, bet: bet(MAX_STAKE), idempotencyKey: key() }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(['RISK_LIMIT', 'INSUFFICIENT_FUNDS', 'GAME_RULE', 'VALIDATION_ERROR']).toContain((err as AppError).code);
    expect((await getWalletAccount(getDb(), p.userId))!.balance).toBe(before);
  });
});

describe('crash manual cash-out is priced at request receipt', () => {
  it('waiting for a contended wallet lock does not change the cash-out multiplier', async () => {
    const p = await newPlayer('rx');
    // A round that will still be flying ~2 s after it starts.
    let round: typeof gameRounds.$inferSelect | undefined;
    for (let i = 0; i < 100 && !round; i += 1) {
      const res = await startRound({ userId: p.userId, gameId: 'crash', bet: { amount: 1_000 }, idempotencyKey: key() });
      if (res.body.round.status !== 'OPEN') continue;
      const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, res.body.round.id));
      if ((row!.state as CrashState).crashE2 >= 150) round = row;
      else await actOnRound({ userId: p.userId, roundId: row!.id, action: { type: 'cashout' }, idempotencyKey: key() }).catch(() => undefined);
    }
    expect(round).toBeDefined();

    // Another transaction holds the player's wallet lock for 1.5 s.
    const holder = await getPool().connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM ledger_accounts WHERE user_id = $1 FOR UPDATE', [p.userId]);
    const sentAt = Date.now();
    const pending = actOnRound({ userId: p.userId, roundId: round!.id, action: { type: 'cashout' }, idempotencyKey: key() });
    await new Promise((r) => setTimeout(r, 1_500));
    await holder.query('COMMIT');
    holder.release();
    const res = await pending;

    const s = res.body.round.state as CrashState;
    expect(s.status).toBe('cashed');
    const atSend = multiplierAt(sentAt - round!.startedAt.getTime(), s.growthPerMs);
    const atRelease = multiplierAt(sentAt + 1_500 - round!.startedAt.getTime(), s.growthPerMs);
    expect(atRelease).toBeGreaterThan(atSend + 3); // the lock wait is material (≈9%)
    expect(s.cashedOutE2).toBeLessThanOrEqual(atSend + 1);
    expect(s.endedAtMs!).toBeLessThan(sentAt + 200 - round!.startedAt.getTime());
    await expectLedgerConsistent();
  });
});
