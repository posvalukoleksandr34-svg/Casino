/**
 * Double-entry ledger. A ledger transaction is a set of entries whose amounts
 * sum to exactly zero; a positive amount increases the account balance.
 *
 *   BET_PLACED     wallet −stake            escrow +stake
 *   BET_SETTLED    escrow −stake, house +stake, house −payout, wallet +payout
 *   ROUND_VOIDED   escrow −stake            wallet +stake
 *   BONUS_GRANTED  promotions −amount       wallet +amount
 *   ADJUSTMENT     adjustments ∓amount      wallet ±amount   (compensating corrections)
 *   HOUSE_FUNDING  issuance −amount         house +amount
 *   SPORTS_STAKE       wallet −stake                       sports escrow +stake
 *   SPORTS_SETTLED     sports escrow −stake, house +stake, house −return, wallet +return
 *   SPORTS_VOIDED      sports escrow −stake                wallet +stake
 *   SPORTS_CORRECTION  house −credit                       wallet +credit   (never a debit)
 *
 * Balances are applied by a database trigger as entries are inserted, so a
 * balance can never drift from its entries. Entries are inserted in a
 * canonical account order (player wallets, then system accounts by rank) to
 * keep lock acquisition order consistent and deadlock-free.
 */
import { minor } from '@/engine/money';
import { pgConstraint, pgErrorCode, type Tx } from '../db/client';
import { sql } from 'drizzle-orm';
import type { LedgerTxType } from '../db/schema';
import { AppError, errors } from '../errors';
import { accountRank } from './accounts';

export interface Posting {
  accountId: number;
  amount: number;
  /** Optional label kept in transaction metadata (e.g. "stake", "payout"). */
  memo?: string;
}

export interface PostTransactionInput {
  type: LedgerTxType;
  /** Globally unique business key, e.g. `round:<id>:settle`. Guarantees exactly-once posting. */
  idempotencyKey: string;
  description: string;
  postings: Posting[];
  userId?: string | null;
  roundId?: string | null;
  /** Sports ticket this transaction belongs to (SPORTS_* types only). */
  sportsTicketId?: string | null;
  actorId?: string | null;
  reversesId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface PostedEntry {
  accountId: number;
  amount: number;
  balanceAfter: number;
}

export interface PostedTransaction {
  id: number;
  entries: PostedEntry[];
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function validatePostings(postings: readonly Posting[]): void {
  if (postings.length < 2) throw new LedgerError('a ledger transaction needs at least two postings');
  let total = 0n;
  for (const p of postings) {
    minor(p.amount, 'posting amount');
    if (p.amount === 0) throw new LedgerError('postings must be non-zero');
    if (!Number.isSafeInteger(p.accountId) || p.accountId <= 0) throw new LedgerError('invalid account id');
    total += BigInt(p.amount);
  }
  if (total !== 0n) throw new LedgerError(`postings do not balance (sum = ${total})`);
}

export async function postTransaction(tx: Tx, input: PostTransactionInput): Promise<PostedTransaction> {
  const postings = input.postings.filter((p) => p.amount !== 0);
  validatePostings(postings);

  const ordered = postings
    .map((p, i) => ({ p, i }))
    .sort((a, b) => accountRank(a.p.accountId) - accountRank(b.p.accountId) || a.p.accountId - b.p.accountId || a.i - b.i)
    .map(({ p }) => p);
  const metadata = {
    ...(input.metadata ?? {}),
    ...(postings.some((p) => p.memo) ? { memos: postings.map((p) => p.memo ?? null) } : {}),
  };
  const values = sql.join(
    ordered.map((p, i) => sql`(${i}::int, ${p.accountId}::bigint, ${p.amount}::bigint)`),
    sql`, `,
  );

  // Header and all entries in one statement: one round trip while hot
  // account rows are locked. Entries are inserted in canonical lock order.
  let rows: { tx_id: number; account_id: number; amount: number; balance_after: number }[];
  try {
    const res = await tx.execute<{ tx_id: number; account_id: number; amount: number; balance_after: number }>(sql`
      WITH t AS (
        INSERT INTO ledger_transactions (type, idempotency_key, user_id, round_id, sports_ticket_id, actor_id, reverses_id, description, metadata)
        VALUES (${input.type}, ${input.idempotencyKey}, ${input.userId ?? null}, ${input.roundId ?? null}, ${input.sportsTicketId ?? null}, ${input.actorId ?? null},
                ${input.reversesId ?? null}, ${input.description}, ${JSON.stringify(metadata)}::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      ), e AS (
        INSERT INTO ledger_entries (transaction_id, account_id, amount)
        SELECT t.id, v.account_id, v.amount FROM t, (VALUES ${values}) AS v(ord, account_id, amount)
        ORDER BY v.ord
        RETURNING transaction_id, account_id, amount, balance_after, account_seq
      )
      SELECT transaction_id AS tx_id, account_id, amount, balance_after FROM e ORDER BY account_id, account_seq`);
    rows = res.rows;
  } catch (err) {
    throw mapLedgerError(err, ordered);
  }
  if (rows.length === 0) {
    throw errors.conflict('This transaction has already been recorded', { idempotencyKey: input.idempotencyKey });
  }
  // Report entries in posting order with their resulting balances.
  const queue = new Map<string, { balanceAfter: number }[]>();
  for (const r of rows) {
    const k = `${r.account_id}:${r.amount}`;
    queue.set(k, [...(queue.get(k) ?? []), { balanceAfter: Number(r.balance_after) }]);
  }
  const entries: PostedEntry[] = ordered.map((p) => ({
    accountId: p.accountId,
    amount: p.amount,
    balanceAfter: queue.get(`${p.accountId}:${p.amount}`)!.shift()!.balanceAfter,
  }));
  return { id: Number(rows[0]!.tx_id), entries };
}

function mapLedgerError(err: unknown, postings: Posting[]): unknown {
  if (pgErrorCode(err) === '23514' && pgConstraint(err) === 'ledger_accounts_non_negative') {
    // A debit to a player wallet is the only way a player-facing posting can overdraw.
    if (postings.some((p) => p.amount < 0 && accountRank(p.accountId) === 0)) return errors.insufficientFunds();
    return new AppError('SERVICE_UNAVAILABLE', 'The operator reserve cannot cover this transaction right now');
  }
  return err;
}
