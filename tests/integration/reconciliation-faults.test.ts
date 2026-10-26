/**
 * Reconciliation must catch money that is wrong, missing, duplicated or
 * misdirected — not merely count transactions. Every fault below is injected
 * inside a savepoint on one connection and rolled back, so the shared test
 * database is never damaged and no append-only trigger is disabled: the
 * faults use only INSERTs/UPDATEs the schema permits (extra balanced entries
 * on an existing transaction, an extra transaction, an OPEN round marked
 * VOIDED without a refund), which is exactly what a buggy code path could do.
 */
import { eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjustBalance } from '@/server/admin/admin-service';
import { getDb, getPool } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { startRound, voidRound } from '@/server/games/round-service';
import { runChecksWith } from '@/server/jobs/reconciliation';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

interface Ctx {
  a: string;
  b: string;
  admin: string;
  walletA: number;
  walletB: number;
  sys: Record<string, number>;
  voided: { id: string; stake: number; refundTx: number };
  open: { id: string; stake: number };
  settled: { id: string; settleTx: number; betTx: number };
}

let ctx: Ctx;
let client: PoolClient;

async function failing(): Promise<string[]> {
  return (await runChecksWith(client)).filter((c) => c.mismatches > 0).map((c) => c.name).sort();
}

/** Runs one fault in a savepoint and returns the checks that fired. */
async function withFault(inject: () => Promise<unknown>): Promise<string[]> {
  await client.query('SAVEPOINT fault');
  try {
    await inject();
    return await failing();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT fault');
  }
}

async function addEntries(txId: number, entries: [number, number][]) {
  for (const [account, amount] of entries) {
    await client.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, $3)', [txId, account, amount]);
  }
}

async function insertTx(type: string, userId: string | null, roundId: string | null, entries: [number, number][], actorId: string | null = null) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, idempotency_key, user_id, round_id, actor_id, description)
     VALUES ($1, $2, $3, $4, $5, 'injected fault') RETURNING id`,
    [type, `fault:${key()}`, userId, roundId, actorId],
  );
  await addEntries(Number(rows[0]!.id), entries);
}

async function txId(roundId: string, type: string): Promise<number> {
  const { rows } = await getPool().query<{ id: string }>('SELECT id FROM ledger_transactions WHERE round_id = $1 AND type = $2', [roundId, type]);
  expect(rows).toHaveLength(1);
  return Number(rows[0]!.id);
}

beforeAll(async () => {
  const pa = await newPlayer('rfa');
  const pb = await newPlayer('rfb');
  const adm = await newPlayer('rfadm');
  await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, adm.userId));
  // Escrow liquidity for the duplicate-refund fault, held by an unrelated open round.
  await startRound({ userId: (await newPlayer('rfliq')).userId, gameId: 'mines', bet: { amount: 50_000, mines: 3 }, idempotencyKey: key() });

  const toVoid = await startRound({ userId: pa.userId, gameId: 'mines', bet: { amount: 1_000, mines: 3 }, idempotencyKey: key() });
  await voidRound({ roundId: toVoid.body.round.id, adminId: adm.userId, reason: 'Reconciliation test void' });
  const open = await startRound({ userId: pa.userId, gameId: 'mines', bet: { amount: 2_000, mines: 3 }, idempotencyKey: key() });
  const settled = await startRound({ userId: pb.userId, gameId: 'dice', bet: { amount: 1_500, target: 5000, direction: 'under' }, idempotencyKey: key() });
  await adjustBalance({ adminId: adm.userId, ipHash: null, requestId: key() }, pa.userId, 4_321, 'Reconciliation test adjustment', key());

  const accounts = await getPool().query<{ id: string; type: string; user_id: string | null }>('SELECT id, type, user_id FROM ledger_accounts');
  const wallet = (u: string) => Number(accounts.rows.find((r) => r.user_id === u)!.id);
  const sys = Object.fromEntries(accounts.rows.filter((r) => r.user_id === null).map((r) => [r.type, Number(r.id)]));
  ctx = {
    a: pa.userId,
    b: pb.userId,
    admin: adm.userId,
    walletA: wallet(pa.userId),
    walletB: wallet(pb.userId),
    sys,
    voided: { id: toVoid.body.round.id, stake: 1_000, refundTx: await txId(toVoid.body.round.id, 'ROUND_VOIDED') },
    open: { id: open.body.round.id, stake: 2_000 },
    settled: { id: settled.body.round.id, settleTx: await txId(settled.body.round.id, 'BET_SETTLED'), betTx: await txId(settled.body.round.id, 'BET_PLACED') },
  };
  client = await getPool().connect();
  await client.query('BEGIN');
});

afterAll(async () => {
  await client.query('ROLLBACK');
  client.release();
  await expectLedgerConsistent(); // nothing leaked out of the rolled-back faults
});

describe('reconciliation: positive case', () => {
  it('a legitimately voided round, settled round and audited adjustment reconcile cleanly', async () => {
    expect(await failing()).toEqual([]);
  });
});

describe('reconciliation: voided-round refunds', () => {
  it('detects a refund that is short by an amount moved to another account (transaction still balanced)', async () => {
    const fired = await withFault(() => addEntries(ctx.voided.refundTx, [[ctx.walletA, -100], [ctx.sys.ADJUSTMENTS!, 100]]));
    expect(fired).toEqual(['voided_rounds_refunded_exactly']);
  });

  it('detects part of a refund credited to a different player', async () => {
    const fired = await withFault(() => addEntries(ctx.voided.refundTx, [[ctx.walletA, -100], [ctx.walletB, 100]]));
    expect(fired).toEqual(['voided_rounds_refunded_exactly']);
  });

  it('detects an over-refund (wallet credited more than the stake)', async () => {
    const fired = await withFault(() => addEntries(ctx.voided.refundTx, [[ctx.walletA, 250], [ctx.sys.PROMOTIONS!, -250]]));
    expect(fired).toEqual(['voided_rounds_refunded_exactly']);
  });

  it('detects wagers-in-play debited by the wrong amount', async () => {
    const fired = await withFault(() => addEntries(ctx.voided.refundTx, [[ctx.sys.WAGERS_IN_PLAY!, -100], [ctx.sys.HOUSE_BANKROLL!, 100]]));
    expect(fired).toEqual(expect.arrayContaining(['voided_rounds_refunded_exactly', 'escrow_matches_open_rounds']));
  });

  it('detects a VOIDED round with no refund transaction (missing record, not hidden by a join)', async () => {
    const fired = await withFault(() =>
      client.query(`UPDATE game_rounds SET status = 'VOIDED', settled_at = now(), expires_at = NULL, void_reason = 'fault' WHERE id = $1`, [ctx.open.id]),
    );
    expect(fired).toEqual(expect.arrayContaining(['voided_rounds_refunded_exactly', 'escrow_matches_open_rounds']));
  });

  it('detects a duplicate refund', async () => {
    const fired = await withFault(() =>
      insertTx('ROUND_VOIDED', ctx.a, ctx.voided.id, [[ctx.sys.WAGERS_IN_PLAY!, -ctx.voided.stake], [ctx.walletA, ctx.voided.stake]]),
    );
    expect(fired).toEqual(expect.arrayContaining(['voided_rounds_refunded_exactly', 'escrow_matches_open_rounds']));
  });

  it('detects a refund posted against a round that was not voided', async () => {
    const fired = await withFault(() =>
      insertTx('ROUND_VOIDED', ctx.a, ctx.open.id, [[ctx.sys.WAGERS_IN_PLAY!, -ctx.open.stake], [ctx.walletA, ctx.open.stake]]),
    );
    expect(fired).toEqual(expect.arrayContaining(['voided_rounds_refunded_exactly', 'round_transactions_linked']));
  });

  it('detects a refund transaction attributed to the wrong player', async () => {
    const fired = await withFault(async () => {
      await client.query(`UPDATE game_rounds SET status = 'VOIDED', settled_at = now(), expires_at = NULL, void_reason = 'fault' WHERE id = $1`, [ctx.open.id]);
      await insertTx('ROUND_VOIDED', ctx.b, ctx.open.id, [[ctx.sys.WAGERS_IN_PLAY!, -ctx.open.stake], [ctx.walletA, ctx.open.stake]]);
    });
    expect(fired).toEqual(expect.arrayContaining(['voided_rounds_refunded_exactly', 'round_transactions_linked']));
    expect(fired).not.toContain('escrow_matches_open_rounds');
  });
});

describe('reconciliation: wagers and settlements', () => {
  it('detects a settlement payout partly redirected to another wallet', async () => {
    const fired = await withFault(() => addEntries(ctx.settled.settleTx, [[ctx.walletB, -10], [ctx.walletA, 10]]));
    expect(fired).toEqual(['settled_rounds_have_one_payout']);
  });

  it('detects a settlement that skims the house instead of releasing escrow', async () => {
    const fired = await withFault(() => addEntries(ctx.settled.settleTx, [[ctx.sys.HOUSE_BANKROLL!, -10], [ctx.sys.WAGERS_IN_PLAY!, 10]]));
    expect(fired).toEqual(expect.arrayContaining(['settled_rounds_have_one_payout', 'escrow_matches_open_rounds']));
  });

  it('detects a stake debited from someone other than the round owner', async () => {
    const fired = await withFault(() => addEntries(ctx.settled.betTx, [[ctx.walletB, 500], [ctx.walletA, -500]]));
    expect(fired).toEqual(['round_stakes_match_bets']);
  });

  it('detects a wager transaction that references no round', async () => {
    const fired = await withFault(() => insertTx('BET_PLACED', ctx.a, null, [[ctx.walletA, -50], [ctx.sys.WAGERS_IN_PLAY!, 50]]));
    expect(fired).toEqual(expect.arrayContaining(['round_transactions_linked', 'escrow_matches_open_rounds']));
  });
});

describe('reconciliation: bonuses and admin money movements', () => {
  it('detects a bonus credit with no bonus record', async () => {
    const fired = await withFault(() => insertTx('BONUS_GRANTED', ctx.a, null, [[ctx.sys.PROMOTIONS!, -777], [ctx.walletA, 777]]));
    expect(fired).toEqual(['bonuses_match_ledger']);
  });

  it('detects an unaudited balance adjustment', async () => {
    const fired = await withFault(() => insertTx('ADJUSTMENT', ctx.a, null, [[ctx.walletA, 555], [ctx.sys.ADJUSTMENTS!, -555]], ctx.admin));
    expect(fired).toEqual(['admin_money_movements_audited']);
  });

  it('detects house funding without an admin action', async () => {
    const fired = await withFault(() => insertTx('HOUSE_FUNDING', null, null, [[ctx.sys.ISSUANCE!, -1], [ctx.sys.HOUSE_BANKROLL!, 1]], ctx.admin));
    expect(fired).toEqual(['admin_money_movements_audited']);
  });
});

describe('reconciliation: operations', () => {
  it('flags rounds overdue for time-based expiry', async () => {
    const fired = await withFault(() => client.query(`UPDATE game_rounds SET expires_at = now() - interval '1 hour' WHERE id = $1`, [ctx.open.id]));
    expect(fired).toEqual(['expiry_queue_not_overdue']);
  });
});
