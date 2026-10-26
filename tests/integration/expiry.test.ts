import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flightEndMs, type CrashState } from '@/engine/games/crash';
import { getDb, getPool } from '@/server/db/client';
import { gameRounds, ledgerEntries, ledgerTransactions, payouts } from '@/server/db/schema';
import { getWalletAccount, systemAccountIds } from '@/server/ledger/accounts';
import { expireDueRounds, expireRoundIfDue, expiryBackoffMs, startRound } from '@/server/games/round-service';
import { TIME_SETTLEMENT_GRACE_MS } from '@/server/games/action-timing';
import { armFault, clearFaults } from '@/server/testing/faults';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const FAR = () => new Date(Date.now() + 10 * 60_000);
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;

async function roundRow(id: string) {
  const [row] = await getDb().select().from(gameRounds).where(eq(gameRounds.id, id));
  return row!;
}

/**
 * Starts crash rounds until one is still flying (≈2% of rounds crash at
 * take-off and settle immediately). `before` is the wallet balance just
 * before the round that is returned.
 */
async function flyingCrash(userId: string, bet: { amount: number; autoCashoutE2?: number }) {
  for (let i = 0; i < 50; i += 1) {
    const before = await balance(userId);
    const res = await startRound({ userId, gameId: 'crash', bet, idempotencyKey: key() });
    if (res.body.round.status === 'OPEN') return Object.assign(await roundRow(res.body.round.id), { before });
  }
  throw new Error('no flying crash round in 50 attempts');
}

function expectedCrashPayout(s: CrashState): number {
  if (s.autoCashoutE2 !== null && s.autoCashoutE2 <= s.crashE2) return Math.floor((s.amount * s.autoCashoutE2) / 100);
  if (s.crashE2 >= s.capE2) return Math.floor((s.amount * s.capE2) / 100);
  return 0;
}

async function openMinesBacklog(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = await newPlayer('mbl');
    const res = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 100, mines: 3 }, idempotencyKey: key() });
    ids.push(res.body.round.id);
  }
  return ids;
}

describe('time-based round expiry', () => {
  beforeAll(async () => {
    // Drain due rounds left by other files so each test controls its own queue.
    await expireDueRounds(FAR(), 10_000);
  });
  afterEach(() => clearFaults());

  it('schedules only rounds that can expire by time', async () => {
    const p = await newPlayer('sched');
    const crashRound = await flyingCrash(p.userId, { amount: 1000 });
    const s = crashRound.state as CrashState;
    // Queued for the settlement deadline: the flight end plus the grace (action-timing.ts).
    expect(crashRound.expiresAt!.getTime()).toBe(crashRound.startedAt.getTime() + flightEndMs(s) + TIME_SETTLEMENT_GRACE_MS);
    const [mines] = await openMinesBacklog(1);
    expect((await roundRow(mines!)).expiresAt).toBeNull();
    const dice = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    expect((await roundRow(dice.body.round.id)).expiresAt).toBeNull();
    await expireDueRounds(FAR(), 10_000);
  });

  it('a backlog of older non-expiring rounds does not starve a due crash round', async () => {
    const backlog = await openMinesBacklog(30);
    const p = await newPlayer('starve');
    const crashRound = await flyingCrash(p.userId, { amount: 1000, autoCashoutE2: 150 });
    const before = crashRound.before;
    const minesBefore = await getDb().select().from(gameRounds).where(inArray(gameRounds.id, backlog));

    // The old job took the 20 oldest OPEN rounds (all Mines) and never reached the crash round.
    const settled = await expireDueRounds(FAR(), 20);
    expect(settled).toBeGreaterThanOrEqual(1);
    const after = await roundRow(crashRound.id);
    expect(after.status).toBe('SETTLED');
    expect(after.expiresAt).toBeNull();
    const payout = expectedCrashPayout(crashRound.state as CrashState);
    expect(after.payoutTotal).toBe(payout);
    expect(await balance(p.userId)).toBe(before - crashRound.stakeTotal + payout);

    // The Mines rounds are untouched and still waiting for their players.
    const minesAfter = await getDb().select().from(gameRounds).where(inArray(gameRounds.id, backlog));
    for (const m of minesAfter) {
      const b = minesBefore.find((x) => x.id === m.id)!;
      expect(m.status).toBe('OPEN');
      expect(m.actionCount).toBe(b.actionCount);
      expect(m.state).toEqual(b.state);
      expect(m.updatedAt.getTime()).toBe(b.updatedAt.getTime());
    }
    await expectLedgerConsistent();
  });

  it('back-filled schedules on non-expiring rounds are corrected and cannot keep the queue head', async () => {
    const backlog = await openMinesBacklog(30);
    // What migration 0003 does to rounds that were open when it ran.
    await getDb().update(gameRounds).set({ expiresAt: sql`${gameRounds.startedAt}` }).where(inArray(gameRounds.id, backlog));
    const p = await newPlayer('backfill');
    const crashRound = await flyingCrash(p.userId, { amount: 500, autoCashoutE2: 120 });

    let passes = 0;
    while ((await roundRow(crashRound.id)).status === 'OPEN') {
      passes += 1;
      expect(passes).toBeLessThanOrEqual(3);
      await expireDueRounds(FAR(), 20);
    }
    const rows = await getDb().select().from(gameRounds).where(inArray(gameRounds.id, backlog));
    expect(rows.every((r) => r.status === 'OPEN' && r.expiresAt === null && r.expiryAttempts === 0)).toBe(true);
    await expectLedgerConsistent();
  });

  it('a crash round that is not yet due does not settle; it settles exactly at its due time', async () => {
    const p = await newPlayer('notdue');
    const crashRound = await flyingCrash(p.userId, { amount: 2000 });
    const before = crashRound.before;
    const due = crashRound.expiresAt!;
    const early = new Date(due.getTime() - 1);

    await expireDueRounds(early, 10_000);
    expect(await expireRoundIfDue(crashRound.id, early)).toBe(false);
    const still = await roundRow(crashRound.id);
    expect(still.status).toBe('OPEN');
    expect(still.expiresAt!.getTime()).toBe(due.getTime());
    expect(await balance(p.userId)).toBe(before - 2000);

    await expireDueRounds(due, 10_000);
    const done = await roundRow(crashRound.id);
    expect(done.status).toBe('SETTLED');
    expect(done.payoutTotal).toBe(expectedCrashPayout(crashRound.state as CrashState));
    expect((done.state as CrashState).endedAtMs).toBeLessThanOrEqual(due.getTime() - crashRound.startedAt.getTime());
    await expectLedgerConsistent();
  });

  it('concurrent expiry attempts settle once: one payout, one settlement transaction, escrow released once', async () => {
    const p = await newPlayer('race');
    const crashRound = await flyingCrash(p.userId, { amount: 3000, autoCashoutE2: 130 });
    const before = crashRound.before;
    const now = new Date(crashRound.expiresAt!.getTime() + 5);

    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => expireRoundIfDue(crashRound.id, now).catch(() => false)),
      expireDueRounds(now, 10_000).then((n) => n > 0),
      expireDueRounds(now, 10_000).then((n) => n > 0),
    ]);
    const direct = results.slice(0, 8).filter(Boolean).length;
    const viaJob = results.slice(8).filter(Boolean).length;
    expect(direct + viaJob).toBeGreaterThanOrEqual(1);
    expect(direct).toBeLessThanOrEqual(1);

    const settleTx = await getDb()
      .select()
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.roundId, crashRound.id), eq(ledgerTransactions.type, 'BET_SETTLED')));
    expect(settleTx).toHaveLength(1);
    expect(await getDb().select().from(payouts).where(eq(payouts.roundId, crashRound.id))).toHaveLength(1);

    const payout = expectedCrashPayout(crashRound.state as CrashState);
    expect(await balance(p.userId)).toBe(before - 3000 + payout);
    // Escrow: everything this round put into WAGERS_IN_PLAY came out again.
    const ids = await systemAccountIds(getDb());
    const [row] = await getDb()
      .select({ net: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::bigint` })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .where(and(eq(ledgerTransactions.roundId, crashRound.id), eq(ledgerEntries.accountId, ids.WAGERS_IN_PLAY)));
    expect(Number(row!.net)).toBe(0);
    await expectLedgerConsistent();
  });

  it('a round that fails to expire is deferred with backoff and does not block the rounds behind it', async () => {
    await expireDueRounds(FAR(), 10_000);
    const a = await flyingCrash((await newPlayer('fa')).userId, { amount: 1000, autoCashoutE2: 110 });
    const b = await flyingCrash((await newPlayer('fb')).userId, { amount: 1000, autoCashoutE2: 110 });
    const now = new Date(Math.max(a.expiresAt!.getTime(), b.expiresAt!.getTime()) + 10);
    const [first, second] = a.expiresAt! <= b.expiresAt! ? [a, b] : [b, a];

    armFault('round.beforeSettle'); // the first settlement attempt of the pass fails
    const settled = await expireDueRounds(now, 10_000);
    expect(settled).toBe(1);
    const failed = await roundRow(first.id);
    expect(failed.status).toBe('OPEN');
    expect(failed.expiryAttempts).toBe(1);
    expect(failed.expiresAt!.getTime()).toBe(now.getTime() + expiryBackoffMs(0));
    expect((await roundRow(second.id)).status).toBe('SETTLED');

    // Not retried before its backoff; retried and settled after it.
    await expireDueRounds(new Date(now.getTime() + expiryBackoffMs(0) - 1), 10_000);
    expect((await roundRow(first.id)).status).toBe('OPEN');
    await expireDueRounds(new Date(now.getTime() + expiryBackoffMs(0)), 10_000);
    expect((await roundRow(first.id)).status).toBe('SETTLED');
    await expectLedgerConsistent();
  });

  it('the due-queue query can use the partial expiry index', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM game_rounds WHERE status = 'OPEN' AND expires_at <= now() ORDER BY expires_at, id LIMIT 200`,
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('game_rounds_expiry_due_idx');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('finished rounds can never carry an expiry schedule (database constraint)', async () => {
    const { rows: bad } = await getPool().query(`SELECT 1 FROM game_rounds WHERE status <> 'OPEN' AND expires_at IS NOT NULL`);
    expect(bad).toHaveLength(0);
    const { rows } = await getPool().query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'game_rounds_expiry_only_open'`,
    );
    expect(rows[0]?.def).toMatch(/status = 'OPEN'.*expires_at IS NULL/);
  });
});
