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
 *
 * Balances are applied by a database trigger as entries are inserted, so a
 * balance can never drift from its entries. Entries are inserted in a
 * canonical account order (player wallets, then system accounts by rank) to
 * keep lock acquisition order consistent and deadlock-free.
 */
import { minor } from '@/engine/money';
import { pgConstraint, pgErrorCode, type Tx } from '../db/client';
import { ledgerEntries, ledgerTransactions, type LedgerTxType } from '../db/schema';
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

  const [created] = await tx
    .insert(ledgerTransactions)
    .values({
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      userId: input.userId ?? null,
      roundId: input.roundId ?? null,
      actorId: input.actorId ?? null,
      reversesId: input.reversesId ?? null,
      description: input.description,
      metadata: {
        ...(input.metadata ?? {}),
        ...(postings.some((p) => p.memo) ? { memos: postings.map((p) => p.memo ?? null) } : {}),
      },
    })
    .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
    .returning({ id: ledgerTransactions.id });
  if (!created) {
    throw errors.conflict('This transaction has already been recorded', { idempotencyKey: input.idempotencyKey });
  }

  const ordered = postings
    .map((p, i) => ({ p, i }))
    .sort((a, b) => accountRank(a.p.accountId) - accountRank(b.p.accountId) || a.p.accountId - b.p.accountId || a.i - b.i)
    .map(({ p }) => p);

  const entries: PostedEntry[] = [];
  for (const p of ordered) {
    try {
      const [row] = await tx
        .insert(ledgerEntries)
        .values({ transactionId: created.id, accountId: p.accountId, amount: p.amount })
        .returning({ balanceAfter: ledgerEntries.balanceAfter });
      entries.push({ accountId: p.accountId, amount: p.amount, balanceAfter: row!.balanceAfter as number });
    } catch (err) {
      throw mapLedgerError(err, p);
    }
  }
  return { id: created.id, entries };
}

function mapLedgerError(err: unknown, posting: Posting): unknown {
  if (pgErrorCode(err) === '23514' && pgConstraint(err) === 'ledger_accounts_non_negative') {
    if (accountRank(posting.accountId) === 0) return errors.insufficientFunds();
    return new AppError('SERVICE_UNAVAILABLE', 'The operator reserve cannot cover this transaction right now');
  }
  return err;
}
