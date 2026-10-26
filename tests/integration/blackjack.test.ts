import { describe, expect, it } from 'vitest';
import type { BlackjackView } from '@/engine/games/blackjack';
import { eq } from 'drizzle-orm';
import { adjustBalance } from '@/server/admin/admin-service';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { actOnRound, startRound } from '@/server/games/round-service';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;

describe('blackjack rounds', () => {
  it('extra stakes (insurance, double, split) are escrowed and settled exactly; ledger reconciles', async () => {
    const p = await newPlayer('bj');
    const before = await balance(p.userId);
    let staked = 0;
    let paid = 0;
    let sawExtra = false;
    for (let i = 0; i < 40; i += 1) {
      const start = await startRound({ userId: p.userId, gameId: 'blackjack', bet: { amount: 1000 }, idempotencyKey: key() });
      let round = start.body.round;
      const view = round.state as BlackjackView;
      expect('shoe' in view).toBe(false);
      if (round.status === 'OPEN') expect(view.dealer[1]).toBeNull();
      // Aggressive play to exercise every extra-stake path: insure, then split, then double, else stand.
      while (round.status === 'OPEN') {
        const s = round.state as BlackjackView;
        const action = s.allowed.includes('insurance')
          ? { type: 'insurance', take: true }
          : s.allowed.includes('split')
            ? { type: 'split' }
            : s.allowed.includes('double')
              ? { type: 'double' }
              : { type: 'stand' };
        const res = await actOnRound({ userId: p.userId, roundId: round.id, action, idempotencyKey: key() });
        if (res.body.round.stake > round.stake) sawExtra = true;
        round = res.body.round;
      }
      const s = round.state as BlackjackView;
      const handStakes = s.hands.reduce((a, h) => a + h.stake, 0) + (s.insurance.taken ? s.insurance.stake : 0);
      expect(round.stake).toBe(handStakes);
      expect(round.payout).toBe(s.payout);
      expect(s.dealer.every((c) => c !== null)).toBe(true);
      staked += round.stake;
      paid += round.payout!;
    }
    expect(sawExtra).toBe(true);
    expect(await balance(p.userId)).toBe(before - staked + paid);
    await expectLedgerConsistent();
  });

  it('rejects actions that are not allowed and leaves the round unchanged', async () => {
    const p = await newPlayer('bjrule');
    for (let i = 0; i < 20; i += 1) {
      const start = await startRound({ userId: p.userId, gameId: 'blackjack', bet: { amount: 500 }, idempotencyKey: key() });
      const round = start.body.round;
      if (round.status !== 'OPEN') continue;
      const s = round.state as BlackjackView;
      const bad = s.allowed.includes('insurance') ? { type: 'hit' } : { type: 'insurance', take: true };
      await expect(actOnRound({ userId: p.userId, roundId: round.id, action: bad, idempotencyKey: key() })).rejects.toThrow();
      const ok = s.allowed.includes('insurance') ? { type: 'insurance', take: false } : { type: 'stand' };
      let r = (await actOnRound({ userId: p.userId, roundId: round.id, action: ok, idempotencyKey: key() })).body.round;
      while (r.status === 'OPEN') r = (await actOnRound({ userId: p.userId, roundId: r.id, action: { type: 'stand' }, idempotencyKey: key() })).body.round;
      expect(r.stake).toBe(500);
      return;
    }
    throw new Error('no open hand in 20 deals');
  });

  it('cannot double without the chips for the additional stake', async () => {
    const p = await newPlayer('bjpoor');
    const admin = await newPlayer('bjadm');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, admin.userId));
    const ctx = { adminId: admin.userId, ipHash: null, requestId: key() };
    // Leave the player with 1.5× the stake: enough to deal, not enough to double after the deal.
    await adjustBalance(ctx, p.userId, 1_500 - (await balance(p.userId)), 'Test setup: reduce balance', key());
    for (let i = 0; i < 40; i += 1) {
      const start = await startRound({ userId: p.userId, gameId: 'blackjack', bet: { amount: 1_000 }, idempotencyKey: key() });
      let round = start.body.round;
      if (round.status === 'OPEN' && (round.state as BlackjackView).allowed.includes('double')) {
        const left = await balance(p.userId);
        await expect(actOnRound({ userId: p.userId, roundId: round.id, action: { type: 'double' }, idempotencyKey: key() })).rejects.toSatisfy(
          (e) => e instanceof AppError && e.code === 'INSUFFICIENT_FUNDS',
        );
        expect(await balance(p.userId)).toBe(left);
        while (round.status === 'OPEN') round = (await actOnRound({ userId: p.userId, roundId: round.id, action: { type: 'stand' }, idempotencyKey: key() })).body.round;
        await expectLedgerConsistent();
        return;
      }
      while (round.status === 'OPEN') {
        const s = round.state as BlackjackView;
        const action = s.allowed.includes('insurance') ? { type: 'insurance', take: false } : { type: 'stand' };
        round = (await actOnRound({ userId: p.userId, roundId: round.id, action, idempotencyKey: key() })).body.round;
      }
      const bal = await balance(p.userId);
      if (bal < 1_000 || bal >= 2_000) await adjustBalance(ctx, p.userId, 1_500 - bal, 'Test setup: reset balance', key());
    }
    throw new Error('no doublable hand in 40 deals');
  });
});
