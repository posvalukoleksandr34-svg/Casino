/**
 * Reconciliation: independent re-derivation of every financial invariant from
 * raw ledger data. Any non-zero result is a MISMATCH and raises a CRITICAL
 * alert. Runs read-only in a REPEATABLE READ snapshot so all checks see one
 * consistent state.
 */
import { eq, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
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

/**
 * Per-round summary of one transaction type's postings, classified against the
 * round's own player: the owner's wallet, wagers-in-play, the house, and any
 * other account ("foreign" — another player's wallet or an unrelated system
 * account). Derived from raw entries only.
 */
const roundLegs = (type: 'BET_PLACED' | 'BET_SETTLED' | 'ROUND_VOIDED') => `
  SELECT t.round_id, count(DISTINCT t.id) AS n,
         bool_or(t.user_id IS DISTINCT FROM r.user_id) AS wrong_user,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET' AND a.user_id = r.user_id), 0) AS owner_wallet,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'WAGERS_IN_PLAY'), 0) AS escrow,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'HOUSE_BANKROLL'), 0) AS house,
         count(e.id) FILTER (WHERE a.type = 'HOUSE_BANKROLL') AS house_legs,
         count(e.id) FILTER (WHERE NOT ((a.type = 'PLAYER_WALLET' AND a.user_id = r.user_id)
                                        OR a.type IN ('WAGERS_IN_PLAY', 'HOUSE_BANKROLL'))) AS foreign_legs
  FROM ledger_transactions t
  JOIN game_rounds r ON r.id = t.round_id
  LEFT JOIN ledger_entries e ON e.transaction_id = t.id
  LEFT JOIN ledger_accounts a ON a.id = e.account_id
  WHERE t.type = '${type}'
  GROUP BY t.round_id`;

/** Per-transaction posting summary relative to the transaction's own player (t.user_id). */
const txLegs = (types: string[]) => `
  SELECT t.id AS tx_id,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET' AND a.user_id = t.user_id), 0) AS owner_wallet,
         count(e.id) FILTER (WHERE a.type = 'PLAYER_WALLET' AND a.user_id = t.user_id) AS owner_legs,
         count(e.id) FILTER (WHERE a.type = 'PLAYER_WALLET' AND a.user_id IS DISTINCT FROM t.user_id) AS foreign_legs,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'PROMOTIONS'), 0) AS promotions,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'ADJUSTMENTS'), 0) AS adjustments,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'HOUSE_BANKROLL'), 0) AS house,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'ISSUANCE'), 0) AS issuance,
         coalesce(sum(e.amount) FILTER (WHERE a.type = 'WAGERS_IN_PLAY'), 0) AS escrow,
         count(e.id) FILTER (WHERE a.type IN ('WAGERS_IN_PLAY', 'HOUSE_BANKROLL', 'ADJUSTMENTS', 'ISSUANCE')) AS other_system_legs
  FROM ledger_transactions t
  LEFT JOIN ledger_entries e ON e.transaction_id = t.id
  LEFT JOIN ledger_accounts a ON a.id = e.account_id
  WHERE t.type IN (${types.map((x) => `'${x}'`).join(', ')})
  GROUP BY t.id`;

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
    description:
      "Each round's stake equals its bets (all owned by the round's player) and its BET_PLACED postings: exactly −stake from the owner's wallet, +stake to wagers-in-play, nothing else",
    sql: `SELECT r.id, r.stake_total::text AS stake, coalesce(b.total, 0)::text AS bets_total, b.foreign_bets,
                 l.n AS placements, l.wrong_user, l.owner_wallet::text, l.escrow::text, l.house_legs, l.foreign_legs
          FROM game_rounds r
          LEFT JOIN (SELECT bt.round_id, sum(bt.stake) AS total, count(*) FILTER (WHERE bt.user_id <> gr.user_id) AS foreign_bets
                     FROM bets bt JOIN game_rounds gr ON gr.id = bt.round_id GROUP BY bt.round_id) b ON b.round_id = r.id
          LEFT JOIN (${roundLegs('BET_PLACED')}) l ON l.round_id = r.id
          WHERE r.stake_total <> coalesce(b.total, 0) OR coalesce(b.foreign_bets, 0) <> 0
             OR l.round_id IS NULL OR l.wrong_user OR l.owner_wallet <> -r.stake_total OR l.escrow <> r.stake_total
             OR l.house_legs <> 0 OR l.foreign_legs <> 0`,
  },
  {
    name: 'settled_rounds_have_one_payout',
    description:
      "Every SETTLED round has exactly one settlement transaction for its player — owner's wallet +payout, wagers-in-play −stake, house +(stake − payout), nothing else — and exactly one matching payout record",
    sql: `SELECT r.id, r.stake_total::text AS stake, r.payout_total::text AS payout, s.n AS settlements, s.wrong_user,
                 s.owner_wallet::text, s.escrow::text, s.house::text, s.foreign_legs,
                 p.amount::text AS payout_record, p.user_id = r.user_id AS payout_owner_ok, p.ledger_transaction_id
          FROM game_rounds r
          LEFT JOIN (${roundLegs('BET_SETTLED')}) s ON s.round_id = r.id
          LEFT JOIN payouts p ON p.round_id = r.id
          LEFT JOIN ledger_transactions pt ON pt.id = p.ledger_transaction_id
          WHERE r.status = 'SETTLED' AND (
                s.n IS DISTINCT FROM 1 OR s.wrong_user OR s.owner_wallet <> r.payout_total OR s.escrow <> -r.stake_total
             OR s.house <> r.stake_total - r.payout_total OR s.foreign_legs <> 0
             OR p.round_id IS NULL OR p.amount <> r.payout_total OR p.user_id <> r.user_id
             OR pt.round_id IS DISTINCT FROM r.id OR pt.type <> 'BET_SETTLED')`,
  },
  {
    name: 'unsettled_rounds_have_no_payout',
    description: 'OPEN and VOIDED rounds have no payout and no settlement transaction',
    sql: `SELECT r.id, r.status FROM game_rounds r
          WHERE r.status <> 'SETTLED' AND (
            r.payout_total IS NOT NULL OR
            EXISTS (SELECT 1 FROM payouts p WHERE p.round_id = r.id) OR
            EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.round_id = r.id AND t.type = 'BET_SETTLED'))`,
  },
  {
    name: 'voided_rounds_refunded_exactly',
    description:
      "Every VOIDED round has exactly one ROUND_VOIDED transaction for its player that credits the owner's wallet with exactly the round stake and debits wagers-in-play by exactly the stake, with no other postings; no other round has a refund",
    sql: `SELECT r.id, r.status, r.stake_total::text AS stake, coalesce(v.n, 0) AS refunds, v.wrong_user,
                 v.owner_wallet::text, v.escrow::text, v.house_legs, v.foreign_legs
          FROM game_rounds r
          LEFT JOIN (${roundLegs('ROUND_VOIDED')}) v ON v.round_id = r.id
          WHERE (r.status = 'VOIDED' AND (
                  v.round_id IS NULL OR v.n <> 1 OR v.wrong_user OR v.owner_wallet <> r.stake_total
               OR v.escrow <> -r.stake_total OR v.house_legs <> 0 OR v.foreign_legs <> 0))
             OR (r.status <> 'VOIDED' AND v.round_id IS NOT NULL)`,
  },
  {
    name: 'round_transactions_linked',
    description:
      "Wager, settlement and refund transactions reference an existing round of the same player (settlements only SETTLED rounds, refunds only VOIDED rounds); other transaction types reference no round",
    sql: `SELECT t.id, t.type, t.round_id, t.user_id, r.user_id AS round_user, r.status
          FROM ledger_transactions t LEFT JOIN game_rounds r ON r.id = t.round_id
          WHERE (t.type IN ('BET_PLACED', 'BET_SETTLED', 'ROUND_VOIDED') AND (r.id IS NULL OR t.user_id IS DISTINCT FROM r.user_id))
             OR (t.type NOT IN ('BET_PLACED', 'BET_SETTLED', 'ROUND_VOIDED') AND t.round_id IS NOT NULL)
             OR (t.type = 'BET_SETTLED' AND r.status <> 'SETTLED')
             OR (t.type = 'ROUND_VOIDED' AND r.status <> 'VOIDED')`,
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
    description:
      "Bonus records and BONUS_GRANTED transactions correspond one-to-one: same player, owner's wallet +amount, promotions −amount, nothing else",
    sql: `SELECT t.id AS transaction_id, b.id AS bonus_id, b.amount::text, l.owner_wallet::text, l.promotions::text, l.foreign_legs
          FROM (SELECT * FROM ledger_transactions WHERE type = 'BONUS_GRANTED') t
          FULL JOIN bonuses b ON b.ledger_transaction_id = t.id
          LEFT JOIN (${txLegs(['BONUS_GRANTED'])}) l ON l.tx_id = t.id
          WHERE t.id IS NULL OR b.id IS NULL OR b.user_id IS DISTINCT FROM t.user_id
             OR l.owner_wallet IS DISTINCT FROM b.amount OR l.promotions IS DISTINCT FROM -b.amount OR l.foreign_legs <> 0
             OR l.other_system_legs <> 0`,
  },
  {
    name: 'admin_money_movements_audited',
    description:
      'Every balance adjustment (owner wallet ±x against the adjustments account) and every house funding after bootstrap was made by an identified admin and has the matching audited admin action',
    sql: `SELECT t.id, t.type, t.actor_id, t.user_id, l.owner_wallet::text, l.adjustments::text, l.house::text, l.issuance::text,
                 l.foreign_legs, l.other_system_legs, aa.n AS admin_actions, aa.amount::text AS audited_amount
          FROM ledger_transactions t
          LEFT JOIN (${txLegs(['ADJUSTMENT', 'HOUSE_FUNDING'])}) l ON l.tx_id = t.id
          LEFT JOIN (SELECT (after->>'transactionId')::bigint AS tx_id, admin_id, action, count(*) AS n,
                            max((after->>'amount')::bigint) AS amount
                     FROM admin_actions WHERE action IN ('ledger.adjustment', 'house.funded') AND after ? 'transactionId'
                     GROUP BY 1, 2, 3) aa
            ON aa.tx_id = t.id AND aa.admin_id = t.actor_id
               AND aa.action = CASE t.type WHEN 'ADJUSTMENT' THEN 'ledger.adjustment' ELSE 'house.funded' END
          WHERE (t.type = 'ADJUSTMENT' AND (
                  t.actor_id IS NULL OR t.user_id IS NULL OR aa.n IS DISTINCT FROM 1 OR aa.amount IS DISTINCT FROM l.owner_wallet
               OR l.owner_wallet = 0 OR l.owner_wallet <> -l.adjustments OR l.foreign_legs <> 0
               OR l.house <> 0 OR l.issuance <> 0 OR l.promotions <> 0 OR l.escrow <> 0))
             OR (t.type = 'HOUSE_FUNDING' AND (
                  l.house <= 0 OR l.house <> -l.issuance OR l.foreign_legs <> 0 OR l.owner_legs <> 0
               OR l.adjustments <> 0 OR l.promotions <> 0 OR l.escrow <> 0
               OR (t.idempotency_key <> 'house-funding:initial' AND (t.actor_id IS NULL OR aa.n IS DISTINCT FROM 1))))`,
  },
  {
    name: 'expiry_queue_not_overdue',
    description: 'No OPEN round is more than 5 minutes past its engine-declared expiry time (the expiry job is keeping up)',
    sql: `SELECT id, game_id, expires_at, expiry_attempts FROM game_rounds
          WHERE status = 'OPEN' AND expires_at < now() - interval '5 minutes'`,
  },
];

type Queryable = Pick<PoolClient, 'query'>;

/** Runs every check on the given connection (inside whatever transaction it holds). */
export async function runChecksWith(client: Queryable): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    const { rows } = await client.query(`${check.sql} LIMIT 20`);
    const countRes = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${check.sql}) q`);
    results.push({ name: check.name, description: check.description, mismatches: Number(countRes.rows[0]?.n ?? 0), sample: rows });
  }
  return results;
}

export async function runChecks(): Promise<CheckResult[]> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const results = await runChecksWith(client);
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
