/**
 * Crash cash-out versus settlement by time, under real PostgreSQL concurrency
 * (rule: src/server/games/action-timing.ts; docs/math/crash.md, "Ordering").
 *
 * Time is controlled, never waited for: receipt times are injected and the
 * ordering clock is a controlled clock that only moves forward. Concurrency
 * is real: a separate connection holds the player's wallet lock, requests
 * queue behind it (observed in pg_stat_activity, not slept on), and the order
 * in which they are released is the order in which they queued.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as actionRoute } from '@/app/api/rounds/[roundId]/actions/route';
import { flightEndMs, multiplierAt, type CrashState } from '@/engine/games/crash';
import { getDb, getPool } from '@/server/db/client';
import { bets, gameRounds, ledgerTransactions, payouts } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getWalletAccount } from '@/server/ledger/accounts';
import { TIME_SETTLEMENT_GRACE_MS } from '@/server/games/action-timing';
import { actOnRound, expireDueRounds, expireRoundIfDue, startRound, type RoundClock } from '@/server/games/round-service';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { armFault, clearFaults } from '@/server/testing/faults';
import { expectLedgerConsistent, holdWalletLock, key, lockWaiters, newPlayer } from './helpers';

type RoundRow = typeof gameRounds.$inferSelect;
const STAKE = 1_000;
const CASHOUT = { type: 'cashout' } as const;

const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
async function roundRow(id: string): Promise<RoundRow> {
  const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, id));
  return row!;
}

interface Flying {
  userId: string;
  row: RoundRow;
  s: CrashState;
  before: number;
  /** Flight end (the crash): requests received from here on are late. */
  end: Date;
  /** end + grace: settlement by time is allowed from here on. */
  deadline: Date;
}

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

/** A flying round without an automatic target that busts at ≥ minCrashE2 (below the cap). */
async function flyingCrash(userId: string, minCrashE2 = 120): Promise<Flying> {
  for (let i = 0; i < 100; i += 1) {
    const before = await balance(userId);
    const res = await startRound({ userId, gameId: 'crash', bet: { amount: STAKE }, idempotencyKey: key() });
    if (res.body.round.status !== 'OPEN') continue;
    const row = await roundRow(res.body.round.id);
    const s = row.state as CrashState;
    if (s.crashE2 >= minCrashE2 && s.crashE2 < s.capE2) {
      const end = at(row.startedAt, flightEndMs(s));
      return { userId, row, s, before, end, deadline: at(end, TIME_SETTLEMENT_GRACE_MS) };
    }
    // Unsuitable: settle it out of the way.
    await expireRoundIfDue(row.id, new Date(Date.now() + 3_600_000));
  }
  throw new Error('no suitable crash round in 100 attempts');
}

/** What a cash-out received at `receivedAt` pays under the published rules. */
function cashoutPayout(r: Flying, receivedAt: Date) {
  const elapsed = receivedAt.getTime() - r.row.startedAt.getTime();
  const e2 = Math.max(100, Math.min(multiplierAt(elapsed, r.s.growthPerMs), r.s.crashE2 - 1));
  return { e2, payout: Math.floor((STAKE * e2) / 100) };
}

/** Controlled ordering clock: it only moves forward and records every reading. */
function controlledClock(start: Date) {
  let now = start.getTime();
  const readings: number[] = [];
  const read: RoundClock = async () => {
    readings.push(now);
    return new Date(now);
  };
  return {
    read,
    readings,
    advanceTo(t: Date) {
      if (t.getTime() < now) throw new Error('the clock never goes back');
      now = t.getTime();
    },
  };
}

const cashout = (r: Flying, receivedAt: Date, clock: RoundClock, idempotencyKey = key()) =>
  actOnRound({ userId: r.userId, roundId: r.row.id, action: CASHOUT, idempotencyKey, receivedAt, clock });

const codeOf = (e: unknown) => (e instanceof AppError ? { code: e.code, details: e.details } : { code: String(e), details: undefined });

/**
 * Terminal-state agreement: round, payout row, ledger postings, wager rows and
 * wallet all tell the same story, exactly once; then full reconciliation.
 */
async function expectSettledOnce(r: Flying, payout: number) {
  const round = await roundRow(r.row.id);
  expect(round.status).toBe('SETTLED');
  expect(round.payoutTotal).toBe(payout);
  expect(round.expiresAt).toBeNull();
  const paid = await getDb().select().from(payouts).where(eq(payouts.roundId, r.row.id));
  expect(paid).toHaveLength(1);
  expect(paid[0]!.amount).toBe(payout);
  const txs = await getDb().select().from(ledgerTransactions).where(eq(ledgerTransactions.roundId, r.row.id));
  expect(txs.filter((t) => t.type === 'BET_PLACED')).toHaveLength(1);
  const settles = txs.filter((t) => t.type === 'BET_SETTLED');
  expect(settles).toHaveLength(1);
  expect(settles[0]!.id).toBe(paid[0]!.ledgerTransactionId);
  expect(settles[0]!.metadata).toMatchObject({ stake: STAKE, payout });
  expect(await getDb().select().from(bets).where(eq(bets.roundId, r.row.id))).toHaveLength(1);
  expect(await balance(r.userId)).toBe(r.before - STAKE + payout);
  await expectLedgerConsistent();
}

/** Still open and untouched: no settlement posting, no payout, stake still held. */
async function expectStillOpen(r: Flying) {
  const round = await roundRow(r.row.id);
  expect(round.status).toBe('OPEN');
  expect(round.payoutTotal).toBeNull();
  expect(await getDb().select().from(payouts).where(eq(payouts.roundId, r.row.id))).toHaveLength(0);
  const settles = await getDb()
    .select()
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.roundId, r.row.id), eq(ledgerTransactions.type, 'BET_SETTLED')));
  expect(settles).toHaveLength(0);
  expect(await balance(r.userId)).toBe(r.before - STAKE);
}

afterEach(() => clearFaults());

describe('crash ordering: sequential outcomes', () => {
  it('1. a cash-out that commits first is paid once; a later settlement is a no-op', async () => {
    const p = await newPlayer('ord1');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.end, -50));
    const res = await cashout(r, at(r.end, -50), clock.read);
    const expected = cashoutPayout(r, at(r.end, -50));
    expect(res.body.resolution).toBe('applied');
    expect((res.body.round.state as CrashState).cashedOutE2).toBe(expected.e2);
    clock.advanceTo(at(r.deadline, 10));
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(false);
    await expectSettledOnce(r, expected.payout);
  });

  it('2. a settlement that commits first wins; a cash-out processed after it is refused', async () => {
    const p = await newPlayer('ord2');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(r.deadline);
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(true);
    // Received before the crash, but only processed after the deadline: by the rule it is late.
    const err = await cashout(r, at(r.end, -5), clock.read).catch((e) => e);
    expect(codeOf(err)).toEqual({ code: 'CONFLICT', details: { status: 'SETTLED', resolution: 'already_settled' } });
    await expectSettledOnce(r, 0);
  });

  it('6. a request received exactly at the flight end is late: refused, nothing changes until the deadline', async () => {
    const p = await newPlayer('ord6');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(r.end);
    const err = await cashout(r, r.end, clock.read).catch((e) => e);
    expect(codeOf(err)).toEqual({ code: 'GAME_RULE', details: { rule: 'ROUND_ENDED', resolution: 'received_after_end' } });
    await expectStillOpen(r);
    // One millisecond before the deadline nothing may settle it either.
    clock.advanceTo(at(r.deadline, -1));
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(false);
    await expectStillOpen(r);
    clock.advanceTo(r.deadline);
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(true);
    await expectSettledOnce(r, 0);
  });

  it('7. one millisecond before the end qualifies; one millisecond after does not', async () => {
    const p = await newPlayer('ord7');
    const early = await flyingCrash(p.userId);
    const clockA = controlledClock(at(early.end, -1));
    const res = await cashout(early, at(early.end, -1), clockA.read);
    const expected = cashoutPayout(early, at(early.end, -1));
    expect(res.body.resolution).toBe('applied');
    expect((res.body.round.state as CrashState).cashedOutE2).toBe(expected.e2);
    expect(expected.e2).toBeLessThan(early.s.crashE2);
    await expectSettledOnce(early, expected.payout);

    const late = await flyingCrash(p.userId);
    const clockB = controlledClock(at(late.end, 1));
    const err = await cashout(late, at(late.end, 1), clockB.read).catch((e) => e);
    expect(codeOf(err).code).toBe('GAME_RULE');
    await expectStillOpen(late);
    // From the deadline on, the same late request settles the bust itself.
    clockB.advanceTo(late.deadline);
    const settled = await cashout(late, at(late.end, 1), clockB.read);
    expect(settled.body.resolution).toBe('received_after_end');
    expect(settled.body.round.payout).toBe(0);
    await expectSettledOnce(late, 0);
  });

  it('12. a winning wager cannot be paid twice (replay, second request, settlement)', async () => {
    const p = await newPlayer('ord12');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.end, -200));
    const k = key();
    const first = await cashout(r, at(r.end, -200), clock.read, k);
    const replay = await cashout(r, at(r.end, -100), clock.read, k);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    expect(codeOf(await cashout(r, at(r.end, -100), clock.read).catch((e) => e)).code).toBe('CONFLICT');
    clock.advanceTo(at(r.deadline, 1));
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(false);
    expect(await expireDueRounds(at(r.deadline, 1), 10_000)).toBe(0);
    await expectSettledOnce(r, cashoutPayout(r, at(r.end, -200)).payout);
  });

  it('11. a losing wager cannot be paid twice (or at all) after it busted', async () => {
    const p = await newPlayer('ord11');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.deadline, 5));
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(true);
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(false);
    for (const receivedAt of [at(r.end, -1_000), at(r.end, 1)]) {
      expect(codeOf(await cashout(r, receivedAt, clock.read).catch((e) => e)).code).toBe('CONFLICT');
    }
    await expectSettledOnce(r, 0);
  });
});

describe('crash ordering: concurrent transactions (real row locks)', () => {
  it.each([
    ['cash-out queued first', 'cashout-first'],
    ['settlement queued first', 'settle-first'],
  ] as const)('3a. before the deadline, a concurrent settlement can never pre-empt an in-time cash-out (%s)', async (_label, order) => {
    const p = await newPlayer('ord3a');
    const r = await flyingCrash(p.userId);
    // The crash has already happened (end + 200 ms) while both wait for the wallet lock.
    const clock = controlledClock(at(r.end, 200));
    const release = await holdWalletLock(p.userId);
    let pendingCashout: ReturnType<typeof cashout>;
    let pendingSettle: Promise<boolean>;
    if (order === 'cashout-first') {
      pendingCashout = cashout(r, at(r.end, -20), clock.read);
      await lockWaiters(1);
      pendingSettle = expireRoundIfDue(r.row.id, clock.read);
      await lockWaiters(2);
    } else {
      pendingSettle = expireRoundIfDue(r.row.id, clock.read);
      await lockWaiters(1);
      pendingCashout = cashout(r, at(r.end, -20), clock.read);
      await lockWaiters(2);
    }
    await release();
    const [res, settled] = await Promise.all([pendingCashout, pendingSettle]);
    expect(res.body.resolution).toBe('applied');
    expect(settled).toBe(false);
    await expectSettledOnce(r, cashoutPayout(r, at(r.end, -20)).payout);
  });

  it.each([
    ['cash-out queued first', 'cashout-first'],
    ['settlement queued first', 'settle-first'],
  ] as const)('3b. at the deadline the outcome is a bust whichever transaction wins the lock (%s)', async (_label, order) => {
    const p = await newPlayer('ord3b');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(r.deadline);
    const release = await holdWalletLock(p.userId);
    let pendingCashout: Promise<unknown>;
    let pendingSettle: Promise<boolean>;
    if (order === 'cashout-first') {
      pendingCashout = cashout(r, at(r.end, -20), clock.read).catch((e) => e);
      await lockWaiters(1);
      pendingSettle = expireRoundIfDue(r.row.id, clock.read);
      await lockWaiters(2);
    } else {
      pendingSettle = expireRoundIfDue(r.row.id, clock.read);
      await lockWaiters(1);
      pendingCashout = cashout(r, at(r.end, -20), clock.read).catch((e) => e);
      await lockWaiters(2);
    }
    await release();
    const [res, settled] = await Promise.all([pendingCashout, pendingSettle]);
    if (order === 'cashout-first') {
      // The cash-out held the round first, but past the deadline: it settles the bust itself.
      expect((res as { body: { resolution: string } }).body.resolution).toBe('processing_deadline_passed');
      expect(settled).toBe(false);
    } else {
      expect(settled).toBe(true);
      expect(codeOf(res)).toEqual({ code: 'CONFLICT', details: { status: 'SETTLED', resolution: 'already_settled' } });
    }
    await expectSettledOnce(r, 0);
  });

  it('4. two cash-outs for the same wager: one pays, the other is refused (different keys) or replayed (same key)', async () => {
    const p = await newPlayer('ord4');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.end, -500));
    let release = await holdWalletLock(p.userId);
    const a = cashout(r, at(r.end, -500), clock.read).catch((e) => e);
    await lockWaiters(1);
    const b = cashout(r, at(r.end, -490), clock.read).catch((e) => e);
    await lockWaiters(2);
    await release();
    const [ra, rb] = await Promise.all([a, b]);
    expect((ra as { body: { resolution: string } }).body.resolution).toBe('applied');
    expect(codeOf(rb)).toEqual({ code: 'CONFLICT', details: { status: 'SETTLED', resolution: 'already_settled' } });
    await expectSettledOnce(r, cashoutPayout(r, at(r.end, -500)).payout);

    const r2 = await flyingCrash(p.userId);
    const clock2 = controlledClock(at(r2.end, -500));
    const k = key();
    release = await holdWalletLock(p.userId);
    const c = cashout(r2, at(r2.end, -500), clock2.read, k);
    await lockWaiters(1);
    const d = cashout(r2, at(r2.end, -480), clock2.read, k);
    await lockWaiters(2);
    await release();
    const [rc, rd] = await Promise.all([c, d]);
    expect(rc.replayed).toBe(false);
    expect(rd.replayed).toBe(true);
    expect(rd.body).toEqual(rc.body);
    await expectSettledOnce(r2, cashoutPayout(r2, at(r2.end, -500)).payout);
  });

  it('5. a retry after a client timeout waits for the original and replays it; nothing is paid twice', async () => {
    const p = await newPlayer('ord5');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.end, -300));
    const k = key();
    const release = await holdWalletLock(p.userId);
    const original = cashout(r, at(r.end, -300), clock.read, k);
    await lockWaiters(1);
    // The client gave up waiting and retries with the same Idempotency-Key.
    const retry = cashout(r, at(r.end, -250), clock.read, k);
    await lockWaiters(2);
    await release();
    const [o, rt] = await Promise.all([original, retry]);
    expect(o.replayed).toBe(false);
    expect(rt.replayed).toBe(true);
    expect(rt.body).toEqual(o.body);
    expect(clock.readings).toHaveLength(1); // the replay never re-evaluated the timing
    await expectSettledOnce(r, cashoutPayout(r, at(r.end, -300)).payout);
  });

  it('8. a lock wait that ends before the deadline still pays; one that ends at the deadline does not', async () => {
    const p = await newPlayer('ord8');
    for (const [releaseAt, expectResolution] of [
      [-1, 'applied'],
      [0, 'processing_deadline_passed'],
    ] as const) {
      const r = await flyingCrash(p.userId);
      const clock = controlledClock(at(r.end, -300));
      const release = await holdWalletLock(p.userId);
      const pending = cashout(r, at(r.end, -300), clock.read);
      await lockWaiters(1);
      // The crash and (almost) the whole grace pass while the request waits for the lock.
      clock.advanceTo(at(r.deadline, releaseAt));
      await release();
      const res = await pending;
      expect(res.body.resolution).toBe(expectResolution);
      // The ordering clock was read once, after the lock was granted.
      expect(clock.readings).toEqual([at(r.deadline, releaseAt).getTime()]);
      await expectSettledOnce(r, expectResolution === 'applied' ? cashoutPayout(r, at(r.end, -300)).payout : 0);
    }
  });

  it('10. many workers settling the same round concurrently settle it exactly once', async () => {
    const p = await newPlayer('ord10');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.deadline, 3));
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => expireRoundIfDue(r.row.id, clock.read).then(Number)),
      expireDueRounds(at(r.deadline, 3), 10_000),
      expireDueRounds(at(r.deadline, 3), 10_000),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    await expectSettledOnce(r, 0);
  });
});

describe('crash ordering: failures roll back completely', () => {
  it('9a. a failure while settling a cash-out leaves the round open; the retry pays once', async () => {
    const p = await newPlayer('ord9a');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.end, -400));
    const k = key();
    armFault('round.beforeSettle');
    await expect(cashout(r, at(r.end, -400), clock.read, k)).rejects.toThrow(/injected fault/);
    await expectStillOpen(r);
    const retry = await cashout(r, at(r.end, -350), clock.read, k);
    expect(retry.replayed).toBe(false); // the failed attempt released its key
    expect(retry.body.resolution).toBe('applied');
    await expectSettledOnce(r, cashoutPayout(r, at(r.end, -350)).payout);
  });

  it('9b. a failure inside a time-based settlement rolls back; the next pass settles once', async () => {
    const p = await newPlayer('ord9b');
    const r = await flyingCrash(p.userId);
    const clock = controlledClock(at(r.deadline, 1));
    armFault('round.afterSettle');
    await expect(expireRoundIfDue(r.row.id, clock.read)).rejects.toThrow(/injected fault/);
    await expectStillOpen(r);
    expect(await expireRoundIfDue(r.row.id, clock.read)).toBe(true);
    await expectSettledOnce(r, 0);
  });
});

describe('crash ordering over HTTP: receipt is taken before authentication and rate limiting', () => {
  it('a request delayed inside the rate limiter is still priced at its receipt time', async () => {
    const p = await newPlayer('ordhttp');
    const r = await flyingCrash(p.userId, 160);
    // Stay clear of a rate-limit window boundary so the request uses the bucket row we lock.
    const windowMs = RATE_LIMITS.actionUser.windowSeconds * 1000;
    while (windowMs - (Date.now() % windowMs) < 3_000) await new Promise((res) => setTimeout(res, 50));
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const bucket = `${RATE_LIMITS.actionUser.name}:${p.userId}`;
    const holder = await getPool().connect();
    await holder.query('INSERT INTO rate_limit_buckets (key, window_start, count) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [bucket, windowStart]);
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM rate_limit_buckets WHERE key = $1 AND window_start = $2 FOR UPDATE', [bucket, windowStart]);
    const sentAt = Date.now();
    const pending = actionRoute(
      new NextRequest(`http://localhost:3000/api/rounds/${r.row.id}/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          cookie: `${SESSION_COOKIE_DEV}=${p.token}`,
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({ action: CASHOUT }),
      }),
      { params: Promise.resolve({ roundId: r.row.id }) },
    );
    await lockWaiters(1);
    await new Promise((res) => setTimeout(res, 1_500)); // a material delay (≈9 % of multiplier growth)
    await holder.query('COMMIT');
    holder.release();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: { state: CrashState }; resolution: string };
    expect(body.resolution).toBe('applied');
    const elapsedAtSend = sentAt - r.row.startedAt.getTime();
    expect(multiplierAt(elapsedAtSend + 1_500, r.s.growthPerMs)).toBeGreaterThan(multiplierAt(elapsedAtSend, r.s.growthPerMs) + 3);
    expect(body.round.state.cashedOutE2).toBeLessThanOrEqual(multiplierAt(elapsedAtSend + 100, r.s.growthPerMs));
    await expectSettledOnce(r, Math.floor((STAKE * body.round.state.cashedOutE2!) / 100));
  });
});

describe('the ordering clock', () => {
  it('reads the database clock correctly whatever the session DateStyle and time zone', async () => {
    const { databaseClock } = await import('@/server/games/round-service');
    const { withTransaction } = await import('@/server/db/client');
    const { sql } = await import('drizzle-orm');
    for (const [style, zone] of [['ISO, MDY', 'UTC'], ['SQL, DMY', 'Asia/Kolkata'], ['German', 'America/St_Johns']]) {
      const before = Date.now();
      const read = await withTransaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL DateStyle = '${style}'; SET LOCAL TimeZone = '${zone}'`));
        return databaseClock(tx);
      });
      expect(Number.isFinite(read.getTime())).toBe(true);
      // Same host: the database clock agrees with the test's clock to well within a second.
      expect(Math.abs(read.getTime() - before)).toBeLessThan(1_000);
    }
  });
});
