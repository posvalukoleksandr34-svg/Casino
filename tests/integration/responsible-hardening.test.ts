import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { actOnRound, startRound, voidRound } from '@/server/games/round-service';
import { claimDailyBonus, dailyBonusStatus } from '@/server/promotions/bonuses';
import { getLimits, INCREASE_DELAY_MS, selfExclude, startCoolOff, updateLimits } from '@/server/responsible/limits';
import { DEFAULT_PLATFORM } from '@/server/bootstrap';
import { expectLedgerConsistent, key, newPlayer, setPlatform } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

describe('responsible play: enforcement details', () => {
  afterEach(async () => {
    await setPlatform({ newRoundsEnabled: true, incidentMessage: null, minHouseReserve: DEFAULT_PLATFORM.minHouseReserve });
  });

  it('parallel wagers cannot jointly exceed a wagering limit', async () => {
    const p = await newPlayer('rgpar');
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyWagerLimit: 1_000 }));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 300, target: 5000, direction: 'under' }, idempotencyKey: key() }),
      ),
    );
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    expect(accepted).toBe(3); // 3 × 300 = 900 ≤ 1,000 < 4 × 300
    for (const r of results) if (r.status === 'rejected') expect(code(r.reason)).toBe('RESPONSIBLE_GAMING');
  });

  it('a later loosening waits its own full 24 hours (it no longer inherits an earlier request’s time)', async () => {
    const p = await newPlayer('rgdelay2');
    const t0 = new Date();
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 5_000, dailyWagerLimit: 5_000 }, t0));
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 50_000 }, t0)); // loosen A at t0
    const t1 = new Date(t0.getTime() + 23 * 3600_000);
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyWagerLimit: null }, t1)); // loosen B at t0 + 23 h
    const justAfterFirstDelay = new Date(t0.getTime() + INCREASE_DELAY_MS + 60_000);
    expect((await getLimits(getDb(), p.userId, justAfterFirstDelay)).limits).toMatchObject({ dailyLossLimit: 5_000, dailyWagerLimit: 5_000 });
    const afterSecondDelay = new Date(t1.getTime() + INCREASE_DELAY_MS + 60_000);
    expect((await getLimits(getDb(), p.userId, afterSecondDelay)).limits).toMatchObject({ dailyLossLimit: 50_000, dailyWagerLimit: null });
  });

  it('a voided (fully refunded) round does not count towards loss or wager limits', async () => {
    const p = await newPlayer('rgvoid');
    const adm = await newPlayer('rgvoidadm');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, adm.userId));
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 2_000, dailyWagerLimit: 2_000 }));
    const open = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 1_500, mines: 3 }, idempotencyKey: key() });
    // While open, the stake counts (conservatively) as lost.
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 1_500, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'RESPONSIBLE_GAMING',
    );
    await voidRound({ roundId: open.body.round.id, adminId: adm.userId, reason: 'Responsible-play limit test' });
    await expect(
      startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 1_500, target: 5000, direction: 'under' }, idempotencyKey: key() }),
    ).resolves.toBeDefined();
    await expectLedgerConsistent();
  });

  it('no daily chips during a cool-off or self-exclusion', async () => {
    await setPlatform({ minHouseReserve: DEFAULT_PLATFORM.minHouseReserve });
    const a = await newPlayer('rgbonus1');
    const b = await newPlayer('rgbonus2');
    // Keep balances under the daily-bonus threshold so only the break blocks it.
    for (const p of [a, b]) {
      const { adjustBalance } = await import('@/server/admin/admin-service');
      const adm = await newPlayer('rgbonusadm');
      await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, adm.userId));
      await adjustBalance({ adminId: adm.userId, ipHash: null, requestId: key() }, p.userId, -900_000, 'Lower balance for bonus test', key());
    }
    await withTransaction((tx) => startCoolOff(tx, a.userId, 24));
    await withTransaction((tx) => selfExclude(tx, b.userId, 6));
    for (const p of [a, b]) {
      expect((await dailyBonusStatus(getDb(), p.userId)).blockedReason).toBeTruthy();
      await expect(claimDailyBonus(p.userId)).rejects.toSatisfy((e) => code(e) === 'RESPONSIBLE_GAMING');
    }
    const c = await newPlayer('rgbonus3');
    expect((await dailyBonusStatus(getDb(), c.userId)).blockedReason).toBeNull();
  });

  it('the kill switch stops new rounds but lets players finish open ones', async () => {
    const p = await newPlayer('rgkill');
    const open = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 500, mines: 1 }, idempotencyKey: key() });
    await setPlatform({ newRoundsEnabled: false, incidentMessage: 'Maintenance window' });
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (e) => code(e) === 'GAME_UNAVAILABLE',
    );
    let round = (await actOnRound({ userId: p.userId, roundId: open.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() })).body.round;
    if (round.status === 'OPEN') round = (await actOnRound({ userId: p.userId, roundId: round.id, action: { type: 'cashout' }, idempotencyKey: key() })).body.round;
    expect(round.status).toBe('SETTLED');
  });
});
