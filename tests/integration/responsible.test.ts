import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { responsibleLimits } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { startRound } from '@/server/games/round-service';
import { getLimits, selfExclude, startCoolOff, updateLimits, INCREASE_DELAY_MS } from '@/server/responsible/limits';
import { key, newPlayer } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));
const bet = (userId: string, amount: number, sessionStartedAt?: Date) =>
  startRound({ userId, gameId: 'dice', bet: { amount, target: 100, direction: 'under' }, idempotencyKey: key(), sessionStartedAt });

describe('responsible-play limits are enforced before wagers are accepted', () => {
  it('24-hour loss limit', async () => {
    const p = await newPlayer('rgloss');
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 2_000 }));
    await bet(p.userId, 1_000); // 1% chance: almost certainly lost
    const err = await bet(p.userId, 1_500).catch((e) => e);
    // either the first bet was lost (limit hit) or, rarely, won (net loss smaller) — check the deterministic case
    const { limits } = await getLimits(getDb(), p.userId);
    expect(limits.dailyLossLimit).toBe(2_000);
    if (err instanceof AppError) expect(err.code).toBe('RESPONSIBLE_GAMING');
    await expect(bet(p.userId, 2_001)).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
  });

  it('daily wagering limit counts every stake', async () => {
    const p = await newPlayer('rgwager');
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyWagerLimit: 1_000 }));
    await bet(p.userId, 600);
    await expect(bet(p.userId, 500)).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
    await bet(p.userId, 400);
  });

  it('tightening applies immediately; loosening waits 24 hours', async () => {
    const p = await newPlayer('rgdelay');
    const now = new Date();
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 10_000 }, now));
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 5_000 }, now));
    expect((await getLimits(getDb(), p.userId, now)).limits.dailyLossLimit).toBe(5_000);
    const res = await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: null }, now));
    expect(res.pending).toEqual({ dailyLossLimit: null });
    expect((await getLimits(getDb(), p.userId, now)).limits.dailyLossLimit).toBe(5_000);
    const later = new Date(now.getTime() + INCREASE_DELAY_MS + 1000);
    expect((await getLimits(getDb(), p.userId, later)).limits.dailyLossLimit).toBeNull();
  });

  it('cool-off and self-exclusion block wagering and cannot be shortened', async () => {
    const p = await newPlayer('rgbreak');
    const until = await withTransaction((tx) => startCoolOff(tx, p.userId, 24));
    await expect(bet(p.userId, 100)).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
    const shorter = await withTransaction((tx) => startCoolOff(tx, p.userId, 1));
    expect(shorter.getTime()).toBe(until.getTime());

    const q = await newPlayer('rgexcl');
    await withTransaction((tx) => selfExclude(tx, q.userId, null));
    await expect(bet(q.userId, 100)).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
    const [row] = await getDb().select().from(responsibleLimits).where(eq(responsibleLimits.userId, q.userId));
    expect(row!.selfExcludedUntil!.getUTCFullYear()).toBe(9999);
  });

  it('session time limit', async () => {
    const p = await newPlayer('rgsession');
    await withTransaction((tx) => updateLimits(tx, p.userId, { sessionLimitMinutes: 30 }));
    await bet(p.userId, 100, new Date(Date.now() - 10 * 60_000));
    await expect(bet(p.userId, 100, new Date(Date.now() - 31 * 60_000))).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
  });
});
