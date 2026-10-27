/**
 * Financial lifecycle invariants under concurrency, beyond the ledger's own
 * database constraints (ledger-invariants.test.ts) and the round lifecycle
 * (rounds.test.ts, crash-ordering.test.ts):
 *   * account state changes (deletion, suspension) cannot race a wager into
 *     an orphaned or unauthorised round;
 *   * a round is never both refunded and paid;
 *   * concurrent bonus claims credit at most once;
 *   * one player can never read or act on another player's rounds or statement.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as actionRoute } from '@/app/api/rounds/[roundId]/actions/route';
import { GET as roundRoute } from '@/app/api/rounds/[roundId]/route';
import { GET as roundsRoute } from '@/app/api/rounds/route';
import { GET as transactionsRoute } from '@/app/api/wallet/transactions/route';
import { setUserStatus } from '@/server/admin/users';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { gameRounds, ledgerTransactions, payouts, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { actOnRound, startRound, voidRound } from '@/server/games/round-service';
import { getWalletAccount } from '@/server/ledger/accounts';
import { claimDailyBonus } from '@/server/promotions/bonuses';
import { DEFAULT_PLATFORM } from '@/server/bootstrap';
import { deleteAccount } from '@/server/users/accounts';
import { expectLedgerConsistent, holdWalletLock, key, lockWaiters, newPlayer, setPlatform } from './helpers';

const PASSWORD = 'correct horse battery staple';
const meta = { ipHash: null, userAgent: 'vitest' };
const codeOf = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const minesBet = { amount: 100, mines: 3 };

async function openRounds(userId: string) {
  return getDb().select().from(gameRounds).where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'OPEN')));
}
async function status(userId: string) {
  const [u] = await getDb().select({ status: users.status }).from(users).where(eq(users.id, userId));
  return u!.status;
}

afterEach(async () => {
  await setPlatform({ dailyBonusMaxBalance: DEFAULT_PLATFORM.dailyBonusMaxBalance });
});

describe('account state changes cannot race a wager', () => {
  it('deletion queued after a wager: the wager wins, deletion is refused (no orphaned round)', async () => {
    const p = await newPlayer('delw');
    const release = await holdWalletLock(p.userId);
    const wager = startRound({ userId: p.userId, gameId: 'mines', bet: minesBet, idempotencyKey: key() }).catch((e) => e);
    await lockWaiters(1);
    const deletion = deleteAccount(p.userId, PASSWORD, meta).then(() => 'deleted', (e) => e);
    await lockWaiters(2); // deletion must wait for the wallet too
    await release();
    const [w, d] = await Promise.all([wager, deletion]);
    expect((w as { status: number }).status).toBe(201);
    expect(codeOf(d)).toBe('CONFLICT');
    expect(await status(p.userId)).toBe('ACTIVE');
    expect(await openRounds(p.userId)).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('deletion queued before a wager: the account is deleted and the wager is refused', async () => {
    const p = await newPlayer('delf');
    const before = await balance(p.userId);
    const release = await holdWalletLock(p.userId);
    const deletion = deleteAccount(p.userId, PASSWORD, meta).then(() => 'deleted', (e) => e);
    await lockWaiters(1);
    const wager = startRound({ userId: p.userId, gameId: 'mines', bet: minesBet, idempotencyKey: key() }).catch((e) => e);
    await lockWaiters(2);
    await release();
    const [d, w] = await Promise.all([deletion, wager]);
    expect(d).toBe('deleted');
    expect(codeOf(w)).toBe('UNAUTHENTICATED');
    expect(await status(p.userId)).toBe('DELETED');
    expect(await openRounds(p.userId)).toHaveLength(0);
    expect(await balance(p.userId)).toBe(before);
    await expectLedgerConsistent();
  });

  it('a suspension waits for an in-flight wager; a wager whose session predates the suspension is refused', async () => {
    const p = await newPlayer('susp');
    const a = await newPlayer('suspadm');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.userId));
    const dice = { amount: 100, target: 5000, direction: 'under' };
    const release = await holdWalletLock(p.userId);
    const inFlight = startRound({ userId: p.userId, gameId: 'dice', bet: dice, idempotencyKey: key() });
    await lockWaiters(1);
    const suspension = setUserStatus({ adminId: a.userId, ipHash: null, requestId: key() }, p.userId, 'SUSPENDED', 'fraud investigation');
    await lockWaiters(2); // the suspension waits for the wager that is already in flight
    await release();
    expect((await inFlight).status).toBe(201);
    await suspension;
    // A request whose session was resolved just before the suspension committed:
    const before = await balance(p.userId);
    expect(codeOf(await startRound({ userId: p.userId, gameId: 'dice', bet: dice, idempotencyKey: key() }).catch((e) => e))).toBe('UNAUTHENTICATED');
    expect(await balance(p.userId)).toBe(before);
    await expectLedgerConsistent();
  });

  it('an action on an open round is refused once the account is suspended', async () => {
    const p = await newPlayer('suspact');
    const a = await newPlayer('suspadm2');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.userId));
    const start = await startRound({ userId: p.userId, gameId: 'mines', bet: minesBet, idempotencyKey: key() });
    await setUserStatus({ adminId: a.userId, ipHash: null, requestId: key() }, p.userId, 'SUSPENDED', 'fraud investigation');
    const err = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() }).catch((e) => e);
    expect(codeOf(err)).toBe('UNAUTHENTICATED');
    // The stake stays held; an administrator can void the round with a full refund.
    await voidRound({ roundId: start.body.round.id, adminId: a.userId, reason: 'account suspended' });
    await expectLedgerConsistent();
  });
});

describe('a round is never both refunded and paid', () => {
  it.each(['void-first', 'cashout-first'] as const)('void and cash-out racing for the same round (%s)', async (order) => {
    const p = await newPlayer('vc');
    const a = await newPlayer('vcadm');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.userId));
    // A round with one safe reveal, so that a cash-out is allowed (a mine on tile 0 → next round).
    let roundId = '';
    let before = 0;
    for (let i = 0; i < 30 && !roundId; i += 1) {
      before = await balance(p.userId);
      const start = await startRound({ userId: p.userId, gameId: 'mines', bet: minesBet, idempotencyKey: key() });
      const step = await actOnRound({ userId: p.userId, roundId: start.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() });
      if (step.body.round.status === 'OPEN') roundId = start.body.round.id;
    }
    expect(roundId).not.toBe('');
    const release = await holdWalletLock(p.userId);
    const voiding = () => voidRound({ roundId, adminId: a.userId, reason: 'race test' }).then(() => 'voided', (e) => e);
    const cashing = () => actOnRound({ userId: p.userId, roundId, action: { type: 'cashout' }, idempotencyKey: key() }).then((r) => r.body.round.payout, (e) => e);
    let v: Promise<unknown>;
    let c: Promise<unknown>;
    if (order === 'void-first') {
      v = voiding();
      await lockWaiters(1);
      c = cashing();
    } else {
      c = cashing();
      await lockWaiters(1);
      v = voiding();
    }
    await lockWaiters(2);
    await release();
    const [vr, cr] = await Promise.all([v, c]);
    const txs = await getDb().select().from(ledgerTransactions).where(eq(ledgerTransactions.roundId, roundId));
    const settled = txs.filter((t) => t.type === 'BET_SETTLED');
    const voided = txs.filter((t) => t.type === 'ROUND_VOIDED');
    expect(settled.length + voided.length).toBe(1);
    const paid = await getDb().select().from(payouts).where(eq(payouts.roundId, roundId));
    if (order === 'void-first') {
      expect(vr).toBe('voided');
      expect(codeOf(cr)).toBe('CONFLICT');
      expect(paid).toHaveLength(0);
      expect(await balance(p.userId)).toBe(before);
    } else {
      expect(typeof cr).toBe('number');
      expect(codeOf(vr)).toBe('CONFLICT');
      expect(paid).toHaveLength(1);
      expect(await balance(p.userId)).toBe(before - minesBet.amount + (cr as number));
    }
    await expectLedgerConsistent();
  });
});

describe('promotions', () => {
  it('concurrent daily-bonus claims credit at most once', async () => {
    await setPlatform({ dailyBonusMaxBalance: 1_000_000_000 });
    const p = await newPlayer('bonus');
    const before = await balance(p.userId);
    const results = await Promise.all(Array.from({ length: 6 }, () => claimDailyBonus(p.userId).then(() => 'ok', (e) => codeOf(e))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r !== 'ok').every((r) => r === 'CONFLICT')).toBe(true);
    const grants = await getDb()
      .select()
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.userId, p.userId), eq(ledgerTransactions.type, 'BONUS_GRANTED')));
    expect(grants).toHaveLength(2); // signup + one daily
    expect(await balance(p.userId)).toBe(before + DEFAULT_PLATFORM.dailyBonus);
    await expectLedgerConsistent();
  });
});

describe('authorisation boundaries on financial records', () => {
  const BASE = 'http://localhost:3000';
  const get = (path: string, token: string) => new NextRequest(`${BASE}${path}`, { headers: { cookie: `${SESSION_COOKIE_DEV}=${token}` } });
  const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

  it("one player cannot read or act on another player's round or see their statement", async () => {
    const owner = await newPlayer('own');
    const other = await newPlayer('oth');
    const start = await startRound({ userId: owner.userId, gameId: 'mines', bet: minesBet, idempotencyKey: key() });
    const roundId = start.body.round.id;

    expect((await roundRoute(get(`/api/rounds/${roundId}`, other.token), params({ roundId }))).status).toBe(404);
    const act = await actionRoute(
      new NextRequest(`${BASE}/api/rounds/${roundId}/actions`, {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE_DEV}=${other.token}`, origin: BASE, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ action: { type: 'reveal', tile: 0 } }),
      }),
      params({ roundId }),
    );
    expect(act.status).toBe(404);
    const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, roundId));
    expect(row!.actionCount).toBe(0);

    const history = (await (await roundsRoute(get('/api/rounds?limit=100', other.token), params({}))).json()) as { items: { id: string }[] };
    expect(history.items.some((r) => r.id === roundId)).toBe(false);
    const statement = (await (await transactionsRoute(get('/api/wallet/transactions?limit=200', other.token), params({}))).json()) as {
      items: { transactionId: number }[];
    };
    const ids = statement.items.map((i) => i.transactionId);
    const foreign = ids.length
      ? await getDb()
          .select({ id: ledgerTransactions.id, userId: ledgerTransactions.userId })
          .from(ledgerTransactions)
          .where(inArray(ledgerTransactions.id, ids))
      : [];
    expect(foreign.every((t) => t.userId === other.userId)).toBe(true);
    // The owner still sees their round.
    expect((await roundRoute(get(`/api/rounds/${roundId}`, owner.token), params({ roundId }))).status).toBe(200);
  });
});
