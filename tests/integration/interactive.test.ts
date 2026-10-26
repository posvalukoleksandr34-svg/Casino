import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { gameRounds, seedPairs } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { decryptSecret } from '@/server/crypto';
import { getWalletAccount } from '@/server/ledger/accounts';
import { rotateSeed } from '@/server/fairness/seeds';
import { actOnRound, openRounds, startRound, voidRound } from '@/server/games/round-service';
import { TIME_SETTLEMENT_GRACE_MS } from '@/server/games/action-timing';
import { HmacRandomStream, shuffle } from '@/engine/rng/provably-fair';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

/** Test-only oracle: recompute the mine layout from the stored (encrypted) seed. */
async function mineLayout(userId: string, nonce: number, clientSeed: string, count: number) {
  const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, userId));
  const order = shuffle(Array.from({ length: 25 }, (_, i) => i), new HmacRandomStream({ serverSeed: decryptSecret(pair!.serverSeedEnc), clientSeed, nonce }));
  return new Set(order.slice(0, count));
}

describe('interactive rounds (mines)', () => {
  it('start → reveal → cash out moves money exactly once and reconciles', async () => {
    const p = await newPlayer('mines');
    const before = await balance(p.userId);
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 1000, mines: 3 }, idempotencyKey: key() });
    expect(start.body.round.status).toBe('OPEN');
    expect(start.body.balance).toBe(before - 1000);
    expect((start.body.round.state as { mines: unknown }).mines).toBeNull(); // hidden
    const layout = await mineLayout(p.userId, start.body.round.fairness.nonce, start.body.round.fairness.clientSeed, 3);
    const safe = Array.from({ length: 25 }, (_, i) => i).filter((t) => !layout.has(t));

    const r1 = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: safe[0] }, idempotencyKey: key() });
    expect(r1.body.round.status).toBe('OPEN');
    const k2 = key();
    const r2 = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: safe[1] }, idempotencyKey: k2 });
    // Replaying the same action key does not reveal another tile.
    const r2b = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: safe[1] }, idempotencyKey: k2 });
    expect(r2b.replayed).toBe(true);
    expect(r2b.body.round.actionCount).toBe(r2.body.round.actionCount);

    const out = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() });
    expect(out.body.round.status).toBe('SETTLED');
    const payout = out.body.round.payout!;
    expect(payout).toBe(Math.floor((1000 * 12_857) / 10_000)); // 0.99 × C(25,2)/C(22,2) = 0.99 × 300/231 = 1.2857×
    expect(await balance(p.userId)).toBe(before - 1000 + payout);
    expect((out.body.round.state as { mines: number[] }).mines.sort()).toEqual([...layout].sort());
    await expect(actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'CONFLICT',
    );
    await expectLedgerConsistent();
  });

  it('open rounds are recoverable, block a second round of the same game and block seed rotation', async () => {
    const p = await newPlayer('minesrec');
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 500, mines: 5 }, idempotencyKey: key() });
    const active = await openRounds(p.userId);
    expect(active.map((r) => r.id)).toEqual([start.body.round.id]);
    await expect(startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 500, mines: 5 }, idempotencyKey: key() })).rejects.toThrow();
    await expect(withTransaction((tx) => rotateSeed(tx, p.userId))).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    // Other games are still playable.
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
  });

  it('a mine ends the round with no payout', async () => {
    const p = await newPlayer('minesbust');
    const before = await balance(p.userId);
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 800, mines: 10 }, idempotencyKey: key() });
    const layout = await mineLayout(p.userId, start.body.round.fairness.nonce, start.body.round.fairness.clientSeed, 10);
    const res = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: [...layout][0] }, idempotencyKey: key() });
    expect(res.body.round.status).toBe('SETTLED');
    expect(res.body.round.payout).toBe(0);
    expect(await balance(p.userId)).toBe(before - 800);
    await expectLedgerConsistent();
  });

  it('exposure of open rounds is reserved and released; voiding refunds the stake', async () => {
    const p = await newPlayer('minesvoid');
    const before = await balance(p.userId);
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 1000, mines: 5 }, idempotencyKey: key() });
    const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, start.body.round.id));
    expect(row!.maxPayout).toBe(1000 * 1000); // capped at 1,000×
    const admin = await newPlayer('voider');
    await voidRound({ roundId: start.body.round.id, adminId: admin.userId, reason: 'Incident drill: void open round' });
    expect(await balance(p.userId)).toBe(before);
    const [after] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, start.body.round.id));
    expect(after!.status).toBe('VOIDED');
    await expectLedgerConsistent();
  });

  it('suspension blocks new rounds but open rounds can still be finished', async () => {
    const p = await newPlayer('minessusp');
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 300, mines: 2 }, idempotencyKey: key() });
    const { setGameStatus } = await import('./helpers');
    await setGameStatus('mines', 'SUSPENDED');
    try {
      await expect(startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 300, mines: 2 }, idempotencyKey: key() })).rejects.toThrow();
      const layout = await mineLayout(p.userId, start.body.round.fairness.nonce, start.body.round.fairness.clientSeed, 2);
      const safe = Array.from({ length: 25 }, (_, i) => i).find((t) => !layout.has(t))!;
      await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: safe }, idempotencyKey: key() });
      const out = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() });
      expect(out.body.round.status).toBe('SETTLED');
    } finally {
      await setGameStatus('mines', 'ACTIVE');
    }
  });
});

describe('interactive rounds (crash)', () => {
  async function crashPoint(userId: string, nonce: number, clientSeed: string) {
    const { drawCrashPoint } = await import('@/engine/games/crash');
    const [pair] = await getDb().select().from(seedPairs).where(eq(seedPairs.userId, userId));
    return drawCrashPoint(new HmacRandomStream({ serverSeed: decryptSecret(pair!.serverSeedEnc), clientSeed, nonce }), 100);
  }

  it('manual cash-out is priced by the server clock; after the crash it is a bust', async () => {
    const { timeToReach } = await import('@/engine/games/crash');
    const p = await newPlayer('crash');
    const before = await balance(p.userId);
    // Play until a round with crash point ≥ 1.50× comes up (most do).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const start = await startRound({ userId: p.userId, gameId: 'crash', bet: { amount: 1000 }, idempotencyKey: key() });
      if (start.body.round.status !== 'OPEN') continue; // instant 1.00× bust
      const cp = await crashPoint(p.userId, start.body.round.fairness.nonce, start.body.round.fairness.clientSeed);
      const startedAt = new Date(start.body.round.startedAt).getTime();
      if (cp < 150) {
        // Received after the crash: rejected without any change until the settlement
        // deadline; from the deadline on, the same request settles the bust.
        const receivedAt = new Date(startedAt + timeToReach(cp, 0.00006) + 50);
        const cashout = (clockAt: Date) =>
          actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'cashout' }, idempotencyKey: key(), receivedAt, clock: async () => clockAt });
        await expect(cashout(receivedAt)).rejects.toMatchObject({ code: 'GAME_RULE', details: { rule: 'ROUND_ENDED' } });
        const late = await cashout(new Date(receivedAt.getTime() + TIME_SETTLEMENT_GRACE_MS));
        expect(late.body.round.payout).toBe(0);
        expect(late.body.resolution).toBe('received_after_end');
        continue;
      }
      const at = new Date(startedAt + timeToReach(150, 0.00006) + 10);
      const out = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'cashout' }, idempotencyKey: key(), receivedAt: at, clock: async () => at });
      expect(out.body.round.status).toBe('SETTLED');
      expect((out.body.round.state as { cashedOutE2: number }).cashedOutE2).toBe(150);
      expect(out.body.round.payout).toBe(1500);
      break;
    }
    const { sql } = await import('drizzle-orm');
    const res = await getDb().execute<{ staked: string; paid: string }>(
      sql`SELECT sum(stake_total)::text staked, coalesce(sum(payout_total),0)::text paid FROM game_rounds WHERE user_id = ${p.userId}`,
    );
    expect(await balance(p.userId)).toBe(before - Number(res.rows[0]!.staked) + Number(res.rows[0]!.paid));
    await expectLedgerConsistent();
  });

  it('automatic cash-out settles without any client request (expiry job / lazy read)', async () => {
    const { expireDueRounds } = await import('@/server/games/round-service');
    const p = await newPlayer('crashauto');
    const start = await startRound({ userId: p.userId, gameId: 'crash', bet: { amount: 1000, autoCashoutE2: 110 }, idempotencyKey: key() });
    if (start.body.round.status === 'OPEN') {
      const cp = await crashPoint(p.userId, start.body.round.fairness.nonce, start.body.round.fairness.clientSeed);
      // 10 minutes later the sweeper settles it.
      await expireDueRounds(new Date(Date.now() + 10 * 60_000));
      const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, start.body.round.id));
      expect(row!.status).toBe('SETTLED');
      expect(row!.payoutTotal).toBe(cp >= 110 ? 1100 : 0);
    }
    await expectLedgerConsistent();
  });
});
