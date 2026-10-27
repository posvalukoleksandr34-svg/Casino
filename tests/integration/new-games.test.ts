import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { gameConfigurations, gameRounds, riskLimits, seedPairs } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { decryptSecret } from '@/server/crypto';
import { getWalletAccount } from '@/server/ledger/accounts';
import { actOnRound, getRoundForUser, startRound } from '@/server/games/round-service';
import { getGameSummary } from '@/server/games/lobby';
import { drawCrashPoint } from '@/engine/games/crash';
import { drawKeno } from '@/engine/games/keno';
import { dropPath, PLINKO_DEFAULT_TABLES } from '@/engine/games/plinko';
import { HILO_CARDS, likelierSide, rankOf, sequenceLength, hilo } from '@/engine/games/hilo';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

/** Test-only oracle: the round's random stream, from the stored (encrypted) server seed. */
async function streamFor(userId: string, nonce: number, clientSeed: string) {
  const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, userId));
  return new HmacRandomStream({ serverSeed: decryptSecret(pair!.serverSeedEnc), clientSeed, nonce });
}

describe('new games are seeded and playable', () => {
  it('bootstrap created an active game, an immutable configuration and risk limits for each', async () => {
    for (const id of ['limbo', 'keno', 'plinko', 'hilo']) {
      const g = await getGameSummary(id);
      expect(g?.status).toBe('ACTIVE');
      expect(g!.theoretical.rtp).toBeLessThanOrEqual(0.99);
      const configs = await getDb().select().from(gameConfigurations).where(eq(gameConfigurations.gameId, id));
      expect(configs.filter((c) => c.isActive)).toHaveLength(1);
      const [limits] = await getDb().select().from(riskLimits).where(eq(riskLimits.gameId, id));
      expect(limits!.maxPayoutPerRound).toBeGreaterThan(0);
    }
  });

  it('limbo: the server result matches the seed, the payout is exact and the ledger reconciles', async () => {
    const p = await newPlayer('limbo');
    let expected = await balance(p.userId);
    for (const targetE2 of [101, 200, 1_000]) {
      const res = await startRound({ userId: p.userId, gameId: 'limbo', bet: { amount: 1_000, targetE2 }, idempotencyKey: key() });
      const r = res.body.round;
      expect(r.status).toBe('SETTLED');
      const resultE2 = drawCrashPoint(await streamFor(p.userId, r.fairness.nonce, r.fairness.clientSeed), 100);
      const s = r.state as { resultE2: number; won: boolean };
      expect(s.resultE2).toBe(resultE2);
      expect(r.payout).toBe(resultE2 >= targetE2 ? Math.floor((1_000 * targetE2) / 100) : 0);
      expected += r.payout! - 1_000;
      expect(res.body.balance).toBe(expected);
    }
    expect(await balance(p.userId)).toBe(expected);
    await expectLedgerConsistent();
  });

  it('limbo: a target whose payout exceeds the per-round cap is refused before any money moves', async () => {
    const p = await newPlayer('limbocap');
    const before = await balance(p.userId);
    // 1,000,000 chips cap; 200 chips × 10,000× = 2,000,000 chips.
    await expect(startRound({ userId: p.userId, gameId: 'limbo', bet: { amount: 20_000, targetE2: 1_000_000 }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'RISK_LIMIT',
    );
    await expect(startRound({ userId: p.userId, gameId: 'limbo', bet: { amount: 1_000, targetE2: 100 }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'VALIDATION_ERROR',
    );
    expect(await balance(p.userId)).toBe(before);
  });

  it('keno: the draw matches the seed regardless of picks; payout from the table', async () => {
    const p = await newPlayer('keno');
    const before = await balance(p.userId);
    const picks = [40, 3, 17, 22, 9];
    const res = await startRound({ userId: p.userId, gameId: 'keno', bet: { amount: 2_000, picks }, idempotencyKey: key() });
    const r = res.body.round;
    const drawn = drawKeno(await streamFor(p.userId, r.fairness.nonce, r.fairness.clientSeed));
    const s = r.state as { drawn: number[]; hits: number[]; picks: number[]; multiplierE2: number };
    expect(s.drawn).toEqual(drawn);
    expect(s.picks).toEqual([3, 9, 17, 22, 40]);
    const hits = picks.filter((x) => drawn.includes(x)).length;
    expect(s.hits).toHaveLength(hits);
    expect(r.payout).toBe(Math.floor((2_000 * [0, 0, 0, 723, 3625, 18113][hits]!) / 100));
    expect(await balance(p.userId)).toBe(before - 2_000 + r.payout!);
    await expect(startRound({ userId: p.userId, gameId: 'keno', bet: { amount: 100, picks: [1, 1] }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'VALIDATION_ERROR',
    );
    await expectLedgerConsistent();
  });

  it('plinko: the stored path matches the seed and the slot pays its multiplier', async () => {
    const p = await newPlayer('plinko');
    const before = await balance(p.userId);
    const res = await startRound({ userId: p.userId, gameId: 'plinko', bet: { amount: 5_000, rows: 16, risk: 'high' }, idempotencyKey: key() });
    const r = res.body.round;
    const path = dropPath(16, await streamFor(p.userId, r.fairness.nonce, r.fairness.clientSeed));
    const s = r.state as { path: number[]; slot: number; multiplierE2: number };
    expect(s.path).toEqual(path);
    expect(s.slot).toBe(path.reduce((a, b) => a + b, 0));
    expect(s.multiplierE2).toBe(PLINKO_DEFAULT_TABLES['16:high']![s.slot]);
    expect(r.payout).toBe(Math.floor((5_000 * s.multiplierE2) / 100));
    expect(await balance(p.userId)).toBe(before - 5_000 + r.payout!);
    await expectLedgerConsistent();
  });

  it('hi-lo: the hidden sequence never reaches the client; guesses follow it; cash-out settles exactly once', async () => {
    const p = await newPlayer('hilo');
    const before = await balance(p.userId);
    // Play rounds until one survives a guess, so cash-out is exercised (bounded attempts).
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const start = await startRound({ userId: p.userId, gameId: 'hilo', bet: { amount: 1_000 }, idempotencyKey: key() });
      const r = start.body.round;
      expect(r.status).toBe('OPEN');
      expect(JSON.stringify(r.state)).not.toContain('"sequence"');
      const rng = await streamFor(p.userId, r.fairness.nonce, r.fairness.clientSeed);
      const sequence = Array.from({ length: sequenceLength(hilo.defaultConfig) }, () => rng.nextInt(HILO_CARDS));
      const view = r.state as { currentCard: number };
      expect(view.currentCard).toBe(sequence[0]);
      // The stored row holds the full sequence server-side.
      const [row] = await getDb().select({ state: gameRounds.state }).from(gameRounds).where(eq(gameRounds.id, r.id));
      expect((row!.state as { sequence: number[] }).sequence).toEqual(sequence);

      const dir = likelierSide(rankOf(sequence[0]!));
      const g = await actOnRound({ userId: p.userId, roundId: r.id, action: { type: 'guess', direction: dir }, idempotencyKey: key() });
      const correct = dir === 'higher' ? rankOf(sequence[1]!) > rankOf(sequence[0]!) : rankOf(sequence[1]!) < rankOf(sequence[0]!);
      expect(g.body.round.status).toBe(correct ? 'OPEN' : 'SETTLED');
      if (!correct) {
        expect(g.body.round.payout).toBe(0);
        continue;
      }
      const ck = key();
      const out = await actOnRound({ userId: p.userId, roundId: r.id, action: { type: 'cashout' }, idempotencyKey: ck });
      const replay = await actOnRound({ userId: p.userId, roundId: r.id, action: { type: 'cashout' }, idempotencyKey: ck });
      expect(replay.replayed).toBe(true);
      expect(out.body.round.status).toBe('SETTLED');
      const m = (out.body.round.state as { multiplierE4: number }).multiplierE4;
      expect(out.body.round.payout).toBe(Math.floor((1_000 * m) / 10_000));
      await expect(actOnRound({ userId: p.userId, roundId: r.id, action: { type: 'skip' }, idempotencyKey: key() })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
      const detail = await getRoundForUser(p.userId, r.id);
      expect(JSON.stringify(detail.state)).not.toContain('"sequence"');
      break;
    }
    const rounds = await getDb().select().from(gameRounds).where(eq(gameRounds.userId, p.userId));
    const net = rounds.reduce((a, x) => a + (x.payoutTotal ?? 0) - x.stakeTotal, 0);
    expect(await balance(p.userId)).toBe(before + net);
    await expectLedgerConsistent();
  });

  it('hi-lo: rule violations are refused without changing the round', async () => {
    const p = await newPlayer('hilorule');
    const start = await startRound({ userId: p.userId, gameId: 'hilo', bet: { amount: 500 }, idempotencyKey: key() });
    const id = start.body.round.id;
    await expect(actOnRound({ userId: p.userId, roundId: id, action: { type: 'cashout' }, idempotencyKey: key() })).rejects.toSatisfy((e) => code(e) === 'GAME_RULE');
    await expect(actOnRound({ userId: p.userId, roundId: id, action: { type: 'guess', direction: 'sideways' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'VALIDATION_ERROR',
    );
    const after = await getRoundForUser(p.userId, id);
    expect(after.actionCount).toBe(0);
    expect(after.status).toBe('OPEN');
  });
});
