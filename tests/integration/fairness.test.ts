import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashServerSeed } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';
import { getDb, withTransaction } from '@/server/db/client';
import { seedPairs } from '@/server/db/schema';
import { fairnessOverview, rotateSeed } from '@/server/fairness/seeds';
import { getRoundForUser, startRound } from '@/server/games/round-service';
import { expectDbError, key, newPlayer } from './helpers';

describe('provably fair lifecycle', () => {
  it('commit → play → reveal → independent verification of every round', async () => {
    const p = await newPlayer('pf');
    const before = await fairnessOverview(getDb(), p.userId);
    const commitment = before.active!.serverSeedHash;
    const rounds = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await startRound({
        userId: p.userId,
        gameId: i % 2 ? 'dice' : 'roulette',
        bet: i % 2 ? { amount: 100, target: 5000, direction: 'under' } : { bets: [{ type: 'red', amount: 100 }] },
        idempotencyKey: key(),
      });
      expect(r.body.round.fairness.serverSeedHash).toBe(commitment);
      rounds.push(r.body.round);
    }
    const rotated = await withTransaction((tx) => rotateSeed(tx, p.userId, 'my-new-client-seed'));
    expect(hashServerSeed(rotated.revealed!.serverSeed)).toBe(commitment);
    expect(rotated.revealed!.finalNonce).toBe(6);
    expect(rotated.active.clientSeed).toBe('my-new-client-seed');
    expect(rotated.active.serverSeedHash).not.toBe(commitment);

    for (const r of rounds) {
      const detail = await getRoundForUser(p.userId, r.id);
      expect(detail.fairness.serverSeed).toBe(rotated.revealed!.serverSeed);
      const v = verifyOutcome(r.gameId, { serverSeed: detail.fairness.serverSeed!, clientSeed: detail.fairness.clientSeed, nonce: detail.fairness.nonce });
      if (r.gameId === 'dice') expect(v.outcome.roll).toBe((detail.state as { roll: number }).roll);
      else expect(v.outcome.pocket).toBe((detail.state as { result: number }).result);
    }

    // The next round uses the new seed and restarts the nonce at 0.
    const next = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    expect(next.body.round.fairness.nonce).toBe(0);
    expect(next.body.round.fairness.clientSeed).toBe('my-new-client-seed');
  });

  it('server seeds are encrypted at rest and commitments cannot be rewritten', async () => {
    const p = await newPlayer('pfenc');
    const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, p.userId));
    expect(pair!.serverSeedEnc).toMatch(/^v1:[0-9a-f]{8}:/);
    expect(pair!.serverSeedEnc).not.toMatch(/[0-9a-f]{64}/);
    await expectDbError(getDb().update(seedPairs).set({ serverSeedHash: 'f'.repeat(64) }).where(eq(seedPairs.id, pair!.id)), /immutable/);
    await expectDbError(getDb().update(seedPairs).set({ nextNonce: -1 }).where(eq(seedPairs.id, pair!.id)), /nonce|check/);
  });

  it('rejects invalid client seeds', async () => {
    const p = await newPlayer('pfbad');
    await expect(withTransaction((tx) => rotateSeed(tx, p.userId, 'has spaces in it'))).rejects.toThrow();
  });
});
