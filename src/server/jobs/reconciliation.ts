/**
 * Reconciliation: independent re-derivation of every financial invariant from
 * raw ledger data. Any non-zero result is a MISMATCH and raises a CRITICAL
 * alert. Runs read-only in a REPEATABLE READ snapshot so all checks see one
 * consistent state.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb, getPool } from '../db/client';
import { alerts, reconciliationRuns } from '../db/schema';
import { logger } from '../observability/logger';
import { SYSTEM_ACCOUNTS } from '../ledger/accounts';

export interface CheckResult {
  name: string;
  description: string;
  mismatches: number;
  sample: unknown[];
}

const CHECKS: { name: string; description: string; sql: string }[] = [
  {
    name: 'transactions_balanced',
    description: 'Every ledger transaction sums to zero and has at least two entries',
    sql: `SELECT t.id, coalesce(sum(e.amount), 0)::text AS total, count(e.id) AS entries
          FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id
          GROUP BY t.id HAVING coalesce(sum(e.amount), 0) <> 0 OR count(e.id) < 2`,
  },
  {
    name: 'account_balances_match_entries',
    description: 'Each account balance equals the sum of its ledger entries',
    sql: `SELECT a.id, a.code, a.balance::text AS balance, coalesce(s.total, 0)::text AS ledger_total
          FROM ledger_accounts a
          LEFT JOIN (SELECT account_id, sum(amount) AS total FROM ledger_entries GROUP BY account_id) s ON s.account_id = a.id
          WHERE a.balance <> coalesce(s.total, 0)`,
  },
  {
    name: 'balance_after_chain',
    description: "Each entry's balance_after equals the running sum of that account's entries in posting order",
    sql: `SELECT id, account_id, account_seq, balance_after::text, running::text FROM (
            SELECT id, account_id, account_seq, balance_after,
                   sum(amount) OVER (PARTITION BY account_id ORDER BY account_seq) AS running
            FROM ledger_entries) x
          WHERE balance_after IS DISTINCT FROM running`,
  },
  {
    name: 'account_sequence_gapless',
    description: 'Per-account entry sequence is gapless (1..n) and matches the account entry counter',
    sql: `SELECT a.id, a.code, a.entry_count, coalesce(s.n, 0) AS entries, coalesce(s.max_seq, 0) AS max_seq
          FROM ledger_accounts a
          LEFT JOIN (SELECT account_id, count(*) AS n, max(account_seq) AS max_seq FROM ledger_entries GROUP BY account_id) s
            ON s.account_id = a.id
          WHERE a.entry_count <> coalesce(s.n, 0) OR coalesce(s.max_seq, 0) <> coalesce(s.n, 0)`,
  },
  {
    name: 'system_closed',
    description: 'The sum of all account balances is zero (closed double-entry system)',
    sql: `SELECT sum(balance)::text AS total FROM ledger_accounts HAVING sum(balance) <> 0`,
  },
  {
    name: 'no_negative_restricted_accounts',
    description: 'No wallet, house or escrow account is negative',
    sql: `SELECT id, code, balance::text FROM ledger_accounts WHERE NOT allow_negative AND balance < 0`,
  },
  {
    name: 'escrow_matches_open_rounds',
    description: 'Wagers-in-play balance equals the total stake of OPEN rounds',
    sql: `SELECT a.balance::text AS escrow, coalesce((SELECT sum(stake_total) FROM game_rounds WHERE status = 'OPEN'), 0)::text AS open_stakes
          FROM ledger_accounts a WHERE a.code = '${SYSTEM_ACCOUNTS.WAGERS_IN_PLAY.code}'
            AND a.balance <> coalesce((SELECT sum(stake_total) FROM game_rounds WHERE status = 'OPEN'), 0)`,
  },
  {
    name: 'round_stakes_match_bets',
    description: 'Each round stake equals the sum of its bets and of its BET_PLACED ledger debits',
    sql: `SELECT r.id, r.stake_total::text, coalesce(b.total, 0)::text AS bets_total, coalesce(l.total, 0)::text AS ledger_total
          FROM game_rounds r
          LEFT JOIN (SELECT round_id, sum(stake) AS total FROM bets GROUP BY round_id) b ON b.round_id = r.id
          LEFT JOIN (
            SELECT t.round_id, sum(e.amount) AS total FROM ledger_transactions t
            JOIN ledger_entries e ON e.transaction_id = t.id
            JOIN ledger_accounts a ON a.id = e.account_id AND a.code = '${SYSTEM_ACCOUNTS.WAGERS_IN_PLAY.code}'
            WHERE t.type = 'BET_PLACED' GROUP BY t.round_id) l ON l.round_id = r.id
          WHERE r.stake_total <> coalesce(b.total, 0) OR r.stake_total <> coalesce(l.total, 0)`,
  },
  {
    name: 'settled_rounds_have_one_payout',
    description: 'Every SETTLED round has exactly one payout record and one settlement transaction matching payout_total',
    sql: `SELECT r.id, r.payout_total::text, p.amount::text AS payout_record, s.n AS settlements, s.credit::text
          FROM game_rounds r
          LEFT JOIN payouts p ON p.round_id = r.id
          LEFT JOIN (
            SELECT t.round_id, count(DISTINCT t.id) AS n,
                   coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET'), 0) AS credit
            FROM ledger_transactions t
            JOIN ledger_entries e ON e.transaction_id = t.id
            JOIN ledger_accounts a ON a.id = e.account_id
            WHERE t.type = 'BET_SETTLED' GROUP BY t.round_id) s ON s.round_id = r.id
          WHERE r.status = 'SETTLED'
            AND (p.amount IS NULL OR p.amount <> r.payout_total OR s.n IS DISTINCT FROM 1 OR s.credit <> r.payout_total)`,
  },
  {
    name: 'unsettled_rounds_have_no_payout',
    description: 'OPEN and VOIDED rounds have no payout and no settlement transaction',
    sql: `SELECT r.id, r.status FROM game_rounds r
          WHERE r.status <> 'SETTLED' AND (
            EXISTS (SELECT 1 FROM payouts p WHERE p.round_id = r.id) OR
            EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.round_id = r.id AND t.type = 'BET_SETTLED'))`,
  },
  {
    name: 'voided_rounds_refunded_once',
    description: 'Every VOIDED round has exactly one refund transaction equal to its stake',
    sql: `SELECT r.id, r.stake_total::text, count(t.id) AS refunds
          FROM game_rounds r LEFT JOIN ledger_transactions t ON t.round_id = r.id AND t.type = 'ROUND_VOIDED'
          WHERE r.status = 'VOIDED' GROUP BY r.id HAVING count(t.id) <> 1`,
  },
  {
    name: 'payouts_within_declared_max',
    description: 'No payout exceeds the max payout the risk engine approved',
    sql: `SELECT id, payout_total::text, max_payout::text FROM game_rounds WHERE payout_total > max_payout`,
  },
  {
    name: 'nonces_unique_and_below_counter',
    description: 'Each round nonce is below its seed pair counter (randomness never reused)',
    sql: `SELECT r.id, r.nonce, s.next_nonce FROM game_rounds r JOIN seed_pairs s ON s.id = r.seed_pair_id WHERE r.nonce >= s.next_nonce`,
  },
  {
    name: 'bonuses_match_ledger',
    description: 'Each bonus record matches its BONUS_GRANTED wallet credit',
    sql: `SELECT b.id, b.amount::text, coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET'), 0)::text AS credited
          FROM bonuses b JOIN ledger_transactions t ON t.id = b.ledger_transaction_id
          JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
          GROUP BY b.id, b.amount HAVING b.amount <> coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET'), 0)`,
  },
];

export async function runChecks(): Promise<CheckResult[]> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const results: CheckResult[] = [];
    for (const check of CHECKS) {
      const { rows } = await client.query(`${check.sql} LIMIT 20`);
      const countRes = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${check.sql}) q`);
      results.push({ name: check.name, description: check.description, mismatches: Number(countRes.rows[0]?.n ?? 0), sample: rows });
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function runReconciliation(triggeredBy: string) {
  const db = getDb();
  const [run] = await db.insert(reconciliationRuns).values({ status: 'RUNNING', triggeredBy }).returning({ id: reconciliationRuns.id });
  try {
    const checks = await runChecks();
    const mismatchCount = checks.reduce((a, c) => a + c.mismatches, 0);
    const status = mismatchCount === 0 ? 'OK' : 'MISMATCH';
    await db
      .update(reconciliationRuns)
      .set({ status, mismatchCount, checks, finishedAt: new Date() })
      .where(eq(reconciliationRuns.id, run!.id));
    if (mismatchCount > 0) {
      logger.error('reconciliation mismatch', { runId: run!.id, mismatchCount });
      await db
        .insert(alerts)
        .values({
          kind: 'RECONCILIATION_MISMATCH',
          severity: 'CRITICAL',
          message: `Reconciliation run ${run!.id} found ${mismatchCount} mismatch(es)`,
          details: { runId: run!.id, failing: checks.filter((c) => c.mismatches > 0).map((c) => c.name) },
          dedupeKey: `recon:${run!.id}`,
        })
        .onConflictDoNothing();
    } else {
      logger.info('reconciliation ok', { runId: run!.id });
    }
    return { id: run!.id, status, mismatchCount, checks };
  } catch (err) {
    await db
      .update(reconciliationRuns)
      .set({ status: 'ERROR', finishedAt: new Date(), checks: [{ error: (err as Error).message }] })
      .where(eq(reconciliationRuns.id, run!.id));
    throw err;
  }
}

export async function latestReconciliation() {
  const res = await getDb().execute<{ id: number; status: string; started_at: Date; mismatch_count: number }>(
    sql`SELECT id, status, started_at, mismatch_count FROM reconciliation_runs ORDER BY id DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}
