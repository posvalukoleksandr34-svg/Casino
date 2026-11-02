import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { gameConfigurations, riskLimits, seedPairs } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { decryptSecret } from '@/server/crypto';
import { getWalletAccount } from '@/server/ledger/accounts';
import { startRound } from '@/server/games/round-service';
import { getGameSummary } from '@/server/games/lobby';
import { rotateSeed } from '@/server/fairness/seeds';
import { verifyRoundOnServer } from '@/server/achievements/achievements';
import { analyseMachine, playSlotRound, type SlotState } from '@/engine/games/slots/engine';
import { SLOT_GAME_IDS, SLOT_MODULES } from '@/engine/games/slots';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

async function streamFor(userId: string, nonce: number, clientSeed: string) {
  const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, userId));
  return new HmacRandomStream({ serverSeed: decryptSecret(pair!.serverSeedEnc), clientSeed, nonce });
}

describe('video slots on the server', () => {
  it('bootstrap seeded the three machines: active, exact RTP below 97%, immutable configuration, limits that cover the largest win', async () => {
    for (const id of SLOT_GAME_IDS) {
      const g = await getGameSummary(id);
      expect(g?.status).toBe('ACTIVE');
      expect(g!.theoretical.method).toBe('exact');
      expect(g!.theoretical.rtp).toBeGreaterThan(0.96);
      expect(g!.theoretical.rtp).toBeLessThan(0.97);
      const configs = await getDb().select().from(gameConfigurations).where(eq(gameConfigurations.gameId, id));
      expect(configs.filter((c) => c.isActive)).toHaveLength(1);
      const [limits] = await getDb().select().from(riskLimits).where(eq(riskLimits.gameId, id));
      const a = analyseMachine(SLOT_MODULES[id].defaultConfig);
      // The largest stake times the exact largest win stays within the per-round cap.
      expect(Math.floor((limits!.maxStake * a.maxTotalE2) / 100)).toBeLessThanOrEqual(limits!.maxPayoutPerRound);
    }
  });

  it.each(SLOT_GAME_IDS)('%s: every reel stop comes from the seed, the payout is exact and the ledger reconciles', async (id) => {
    const p = await newPlayer(`slot-${id.slice(0, 6)}`);
    let expected = await balance(p.userId);
    const config = SLOT_MODULES[id].defaultConfig;
    for (let i = 0; i < 25; i += 1) {
      const res = await startRound({ userId: p.userId, gameId: id, bet: { amount: 250 }, idempotencyKey: key() });
      const r = res.body.round;
      expect(r.status).toBe('SETTLED');
      const s = r.state as SlotState;
      const replay = playSlotRound(config, await streamFor(p.userId, r.fairness.nonce, r.fairness.clientSeed));
      expect(s.base.stops).toEqual(replay.base.stops);
      expect(s.freeSpins.map((f) => f.stops)).toEqual(replay.freeSpins.map((f) => f.stops));
      expect(s.totalE2).toBe(replay.totalE2);
      expect(r.payout).toBe(Math.floor((250 * replay.totalE2) / 100));
      expected += r.payout! - 250;
      expect(res.body.balance).toBe(expected);
    }
    expect(await balance(p.userId)).toBe(expected);
    await expectLedgerConsistent();
  });

  it('refuses a stake above the table limit, and a malformed bet, before any money moves', async () => {
    const p = await newPlayer('slotcap');
    const before = await balance(p.userId);
    await expect(startRound({ userId: p.userId, gameId: 'ember-fruits', bet: { amount: 100_01 }, idempotencyKey: key() })).rejects.toSatisfy((e) => ['RISK_LIMIT', 'VALIDATION_ERROR', 'STAKE_LIMIT'].includes(code(e)));
    await expect(startRound({ userId: p.userId, gameId: 'ember-fruits', bet: { amount: 100, freeSpins: true }, idempotencyKey: key() })).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    expect(await balance(p.userId)).toBe(before);
  });

  it('a settled spin can be checked on the server and with the public verifier once the seed is revealed', async () => {
    const p = await newPlayer('slotverify');
    const res = await startRound({ userId: p.userId, gameId: 'sands-of-aurum', bet: { amount: 100 }, idempotencyKey: key() });
    const r = res.body.round;
    await withTransaction((tx) => rotateSeed(tx, p.userId));
    const check = await verifyRoundOnServer(p.userId, r.id);
    expect(check.matches).toBe(true);
    const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.serverSeedHash, check.serverSeedHash));
    const v = verifyOutcome('sands-of-aurum', { serverSeed: pair!.revealedServerSeed!, clientSeed: r.fairness.clientSeed, nonce: r.fairness.nonce });
    expect(v.outcome.stops).toEqual((r.state as SlotState).base.stops);
  });
});
