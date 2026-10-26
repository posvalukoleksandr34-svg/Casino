import { and, eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { DICE_OUTCOMES } from '@/engine/games/dice';
import { payoutTable } from '@/engine/games/roulette';
import { getDb } from '@/server/db/client';
import { bets, gameRounds, idempotencyKeys, ledgerTransactions, payouts, seedPairs } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { startRound, voidRound } from '@/server/games/round-service';
import { armFault, clearFaults } from '@/server/testing/faults';
import { decryptSecret } from '@/server/crypto';
import { DEFAULT_PLATFORM } from '@/server/bootstrap';
import { CATALOG } from '@/server/games/catalog';
import { expectDbError, expectLedgerConsistent, key, newPlayer, setGameStatus, setPlatform, setRiskLimits } from './helpers';

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

afterEach(async () => {
  clearFaults();
  await setGameStatus('dice', 'ACTIVE');
  await setGameStatus('roulette', 'ACTIVE');
  await setPlatform({ newRoundsEnabled: true, minHouseReserve: DEFAULT_PLATFORM.minHouseReserve, maxPlayerBalance: DEFAULT_PLATFORM.maxPlayerBalance });
  await setRiskLimits('dice', CATALOG.dice!.limits);
});

describe('instant rounds: wager → outcome → settlement', () => {
  it('dice: stake is debited, payout credited, all records written exactly once', async () => {
    const p = await newPlayer();
    const before = await balance(p.userId);
    const res = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 1000, target: 5000, direction: 'under' }, idempotencyKey: key() });
    expect(res.status).toBe(201);
    const round = res.body.round;
    expect(round.status).toBe('SETTLED');
    const state = round.state as { roll: number; won: boolean; payout: number };
    expect(round.payout).toBe(state.payout);
    expect(res.body.balance).toBe(before - 1000 + state.payout);
    expect(await balance(p.userId)).toBe(before - 1000 + state.payout);

    const db = getDb();
    expect(await db.select().from(bets).where(eq(bets.roundId, round.id))).toHaveLength(1);
    expect(await db.select().from(payouts).where(eq(payouts.roundId, round.id))).toHaveLength(1);
    const txs = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.roundId, round.id));
    expect(txs.map((t) => t.type).sort()).toEqual(['BET_PLACED', 'BET_SETTLED']);
    await expectLedgerConsistent();
  });

  it('dice outcome is exactly what the committed seeds produce (verifiable after reveal)', async () => {
    const p = await newPlayer();
    const res = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 9000, direction: 'under' }, idempotencyKey: key() });
    const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, p.userId));
    const serverSeed = decryptSecret(pair!.serverSeedEnc);
    const expectedRoll = new HmacRandomStream({ serverSeed, clientSeed: res.body.round.fairness.clientSeed, nonce: res.body.round.fairness.nonce }).nextInt(
      DICE_OUTCOMES,
    );
    expect((res.body.round.state as { roll: number }).roll).toBe(expectedRoll);
    expect(res.body.round.fairness.serverSeed).toBeNull(); // not revealed while active
  });

  it('roulette: multiple simultaneous bets settle to the exact payout table value', async () => {
    const p = await newPlayer();
    const slip = [
      { type: 'straight', number: 7, amount: 100 },
      { type: 'red', amount: 500 },
      { type: 'dozen', index: 2, amount: 300 },
      { type: 'column', index: 1, amount: 200 },
      { type: 'odd', amount: 100 },
    ];
    const before = await balance(p.userId);
    const res = await startRound({ userId: p.userId, gameId: 'roulette', bet: { bets: slip }, idempotencyKey: key() });
    const state = res.body.round.state as { result: number; payout: number };
    expect(state.payout).toBe(payoutTable(slip as never)[state.result]);
    expect(res.body.balance).toBe(before - 1200 + state.payout);
    const rows = await getDb().select().from(bets).where(eq(bets.roundId, res.body.round.id));
    expect(rows).toHaveLength(5);
    expect(rows.reduce((a, b) => a + b.stake, 0)).toBe(1200);
    await expectLedgerConsistent();
  });

  it('nonces increase by one per round and are never reused', async () => {
    const p = await newPlayer();
    const nonces: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 10, target: 5000, direction: 'over' }, idempotencyKey: key() });
      nonces.push(res.body.round.fairness.nonce);
    }
    expect(nonces).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('idempotency and duplicate requests', () => {
  it('replaying the same Idempotency-Key returns the original result without charging again', async () => {
    const p = await newPlayer();
    const k = key();
    const bet = { amount: 2000, target: 5000, direction: 'under' };
    const first = await startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: k });
    const afterFirst = await balance(p.userId);
    const second = await startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: k });
    expect(second.replayed).toBe(true);
    expect(second.body.round.id).toBe(first.body.round.id);
    expect(await balance(p.userId)).toBe(afterFirst);
    const rounds = await getDb().select().from(gameRounds).where(eq(gameRounds.userId, p.userId));
    expect(rounds).toHaveLength(1);
  });

  it('reusing a key for a different payload is rejected', async () => {
    const p = await newPlayer();
    const k = key();
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: k });
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 999, target: 5000, direction: 'under' }, idempotencyKey: k })).rejects.toSatisfy(
      (e) => code(e) === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('concurrent duplicates with the same key produce exactly one round and one charge', async () => {
    const p = await newPlayer();
    const before = await balance(p.userId);
    const k = key();
    const bet = { amount: 500, target: 5000, direction: 'under' };
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: k })));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof startRound>>>).value);
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.body.round.id)).size).toBe(1);
    const rounds = await getDb().select().from(gameRounds).where(eq(gameRounds.userId, p.userId));
    expect(rounds).toHaveLength(1);
    expect(await balance(p.userId)).toBe(before - 500 + (rounds[0]!.payoutTotal ?? 0));
    await expectLedgerConsistent();
  });
});

describe('concurrency', () => {
  it('parallel wagers can never overdraw the wallet', async () => {
    const p = await newPlayer();
    const start = await balance(p.userId); // 1,000,000 minor
    // Each wager is 1/5 of the balance; 20 run concurrently on a 10%-chance bet (usually lost).
    const stake = start / 5;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        startRound({ userId: p.userId, gameId: 'dice', bet: { amount: stake, target: 1000, direction: 'under' }, idempotencyKey: key() }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => code(r.reason) === 'INSUFFICIENT_FUNDS' || code(r.reason) === 'RISK_LIMIT')).toBe(true);
    const end = await balance(p.userId);
    expect(end).toBeGreaterThanOrEqual(0);
    const [{ staked, paid }] = (
      await getDb().execute<{ staked: string; paid: string }>(
        sql`SELECT coalesce(sum(stake_total),0)::text staked, coalesce(sum(payout_total),0)::text paid FROM game_rounds WHERE user_id = ${p.userId}`,
      )
    ).rows as [{ staked: string; paid: string }];
    expect(end).toBe(start - Number(staked) + Number(paid));
    expect(fulfilled).toBeGreaterThanOrEqual(5);
    await expectLedgerConsistent();
  });

  it('many players betting concurrently keep the ledger consistent', async () => {
    const players = await Promise.all(Array.from({ length: 6 }, () => newPlayer('c')));
    await Promise.all(
      players.flatMap((p) =>
        Array.from({ length: 10 }, (_, i) =>
          startRound({
            userId: p.userId,
            gameId: i % 2 ? 'dice' : 'roulette',
            bet: i % 2 ? { amount: 100 + i, target: 4950, direction: 'under' } : { bets: [{ type: 'black', amount: 100 + i }] },
            idempotencyKey: key(),
          }),
        ),
      ),
    );
    await expectLedgerConsistent();
  });
});

describe('rejections happen before the round begins', () => {
  it('insufficient funds', async () => {
    const p = await newPlayer();
    const b = await balance(p.userId);
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: b + 1, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'INSUFFICIENT_FUNDS' || code(e) === 'RISK_LIMIT',
    );
    expect(await balance(p.userId)).toBe(b);
  });

  it('stake above the table maximum and potential payout above the per-round limit', async () => {
    const p = await newPlayer();
    await setRiskLimits('dice', { maxStake: 5000, maxPayoutPerRound: 50_000 });
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 5001, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'RISK_LIMIT',
    );
    // 1000 at 1% → 99× = 99,000 > 50,000
    const err = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 1000, target: 100, direction: 'under' }, idempotencyKey: key() }).catch((e) => e);
    expect(code(err)).toBe('RISK_LIMIT');
    expect((err as AppError).details?.reason).toBe('MAX_PAYOUT_EXCEEDED');
    const rounds = await getDb().select().from(gameRounds).where(eq(gameRounds.userId, p.userId));
    expect(rounds).toHaveLength(0);
  });

  it('suspended game and platform kill switch block new rounds', async () => {
    const p = await newPlayer();
    await setGameStatus('dice', 'SUSPENDED');
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'GAME_UNAVAILABLE',
    );
    await setGameStatus('dice', 'ACTIVE');
    await setPlatform({ newRoundsEnabled: false, incidentMessage: 'Maintenance' });
    await expect(startRound({ userId: p.userId, gameId: 'roulette', bet: { bets: [{ type: 'red', amount: 100 }] }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'GAME_UNAVAILABLE',
    );
  });

  it('house reserve protection rejects wagers the reserve cannot cover', async () => {
    const p = await newPlayer();
    await setPlatform({ minHouseReserve: 1_000_000_000_000 }); // larger than the bankroll
    const err = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() }).catch((e) => e);
    expect((err as AppError).details?.reason).toBe('HOUSE_RESERVE_INSUFFICIENT');
  });

  it('invalid bets are rejected with validation errors and leave no trace', async () => {
    const p = await newPlayer();
    for (const bet of [{ amount: 1.5, target: 5000, direction: 'under' }, { amount: 100, target: 50, direction: 'under' }, { amount: 100 }, 'nonsense']) {
      await expect(startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: key() })).rejects.toBeInstanceOf(AppError);
    }
    await expect(startRound({ userId: p.userId, gameId: 'poker', bet: {}, idempotencyKey: key() })).rejects.toSatisfy((e) => code(e) === 'NOT_FOUND');
    const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, p.userId));
    expect(pair!.nextNonce).toBe(0); // no randomness consumed
    expect(await getDb().select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, p.userId))).toHaveLength(0);
  });
});

describe('failure atomicity', () => {
  for (const point of ['round.afterBetPosted', 'round.beforeSettle', 'round.afterSettle'] as const) {
    it(`a crash at ${point} leaves no partial state and the retry succeeds once`, async () => {
      const p = await newPlayer();
      const before = await balance(p.userId);
      const k = key();
      const bet = { amount: 700, target: 5000, direction: 'under' };
      armFault(point);
      await expect(startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: k })).rejects.toThrow(/injected fault/);
      expect(await balance(p.userId)).toBe(before);
      const db = getDb();
      expect(await db.select().from(gameRounds).where(eq(gameRounds.userId, p.userId))).toHaveLength(0);
      expect(await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, p.userId), eq(idempotencyKeys.key, k)))).toHaveLength(0);
      const [pair] = await db.select().from(seedPairs).where(eq(seedPairs.userId, p.userId));
      expect(pair!.nextNonce).toBe(0);
      // Client retries with the same key after the failure.
      const retry = await startRound({ userId: p.userId, gameId: 'dice', bet, idempotencyKey: k });
      expect(retry.replayed).toBe(false);
      expect(await balance(p.userId)).toBe(before - 700 + (retry.body.round.payout ?? 0));
      await expectLedgerConsistent();
    });
  }
});

describe('settled rounds are immutable', () => {
  it('a settled round cannot be updated, deleted or voided', async () => {
    const p = await newPlayer();
    const res = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    await expectDbError(getDb().execute(sql`UPDATE game_rounds SET payout_total = 999999 WHERE id = ${res.body.round.id}`), /can no longer change/);
    await expectDbError(getDb().execute(sql`DELETE FROM game_rounds WHERE id = ${res.body.round.id}`), /cannot be deleted/);
    await expect(voidRound({ roundId: res.body.round.id, adminId: p.userId, reason: 'testing void' })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
  });
});
