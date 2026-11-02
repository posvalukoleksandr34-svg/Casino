import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from '../db/schema';

export interface WalletTransaction {
  entryId: number;
  transactionId: number;
  type: string;
  description: string;
  amount: number;
  balanceAfter: number | null;
  roundId: string | null;
  createdAt: string;
}

/**
 * The player's statement: their wallet's ledger entries joined with the
 * transaction header, newest first, keyset-paginated by entry id.
 */
export async function listTransactions(
  userId: string,
  opts: { beforeEntryId?: number; limit?: number; type?: string } = {},
): Promise<WalletTransaction[]> {
  const db = getDb();
  const rows = await db
    .select({
      entryId: ledgerEntries.id,
      transactionId: ledgerTransactions.id,
      type: ledgerTransactions.type,
      description: ledgerTransactions.description,
      amount: ledgerEntries.amount,
      balanceAfter: ledgerEntries.balanceAfter,
      roundId: ledgerTransactions.roundId,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(
      and(
        eq(ledgerAccounts.userId, userId),
        opts.beforeEntryId ? lt(ledgerEntries.id, opts.beforeEntryId) : undefined,
        opts.type ? eq(ledgerTransactions.type, opts.type as never) : undefined,
      ),
    )
    .orderBy(desc(ledgerEntries.id))
    .limit(Math.min(opts.limit ?? 50, 10_000));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export interface WalletSummary {
  /** Spendable credits in the wallet. */
  available: number;
  /** Stakes held for rounds and predictions still in progress (already debited from the wallet). */
  reserved: number;
  /** Bonus credits locked until their wagering requirement is met (not spendable). */
  lockedBonus: number;
  /** Withdrawals requested and not yet paid, rejected or cancelled (already taken out of the wallet). */
  pendingWithdrawals: number;
  /** Lifetime totals from the player's ledger entries. */
  totals: { wagered: number; won: number; received: number; refunded: number; adjusted: number; deposited: number; withdrawn: number };
}

/**
 * The cashier overview, computed from the ledger and the open rounds/tickets
 * (never from client data). Totals use the wallet's own entries by
 * transaction type, so they always agree with the statement.
 */
export async function walletSummary(userId: string): Promise<WalletSummary> {
  const db = getDb();
  const res = await db.execute<{
    available: string | null;
    reserved_rounds: string;
    reserved_sports: string;
    locked: string;
    pending_wd: string;
    wagered: string;
    won: string;
    received: string;
    refunded: string;
    adjusted: string;
    deposited: string;
    withdrawn: string;
  }>(sql`
    WITH w AS (SELECT id, balance FROM ledger_accounts WHERE user_id = ${userId} AND type = 'PLAYER_WALLET'),
         e AS (SELECT t.type, e.amount FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = (SELECT id FROM w))
    SELECT (SELECT balance FROM w)::text AS available,
           coalesce((SELECT sum(stake_total) FROM game_rounds WHERE user_id = ${userId} AND status = 'OPEN'), 0)::text AS reserved_rounds,
           coalesce((SELECT sum(stake) FROM sports_tickets WHERE user_id = ${userId} AND status IN ('ACCEPTED', 'SUSPENDED')), 0)::text AS reserved_sports,
           coalesce((SELECT sum(amount) FROM bonus_claims WHERE user_id = ${userId} AND status = 'ACTIVE'), 0)::text AS locked,
           coalesce((SELECT sum(amount) FROM withdrawals WHERE user_id = ${userId} AND status IN ('REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING')), 0)::text AS pending_wd,
           coalesce((SELECT -sum(amount) FROM e WHERE type IN ('BET_PLACED', 'SPORTS_STAKE')), 0)::text AS wagered,
           coalesce((SELECT sum(amount) FROM e WHERE type IN ('BET_SETTLED', 'SPORTS_SETTLED', 'SPORTS_CORRECTION')), 0)::text AS won,
           coalesce((SELECT sum(amount) FROM e WHERE type IN ('BONUS_GRANTED', 'BONUS_RELEASED', 'CHIP_GRANT', 'REWARD_CREDITED')), 0)::text AS received,
           coalesce((SELECT sum(amount) FROM e WHERE type IN ('ROUND_VOIDED', 'SPORTS_VOIDED')), 0)::text AS refunded,
           coalesce((SELECT sum(amount) FROM e WHERE type = 'ADJUSTMENT'), 0)::text AS adjusted,
           coalesce((SELECT sum(amount) FROM e WHERE type = 'DEPOSIT'), 0)::text AS deposited,
           coalesce((SELECT -sum(amount) FROM e WHERE type IN ('WITHDRAWAL_HOLD', 'WITHDRAWAL_RELEASED')), 0)::text AS withdrawn`);
  const r = res.rows[0]!;
  return {
    available: Number(r.available ?? 0),
    reserved: Number(r.reserved_rounds) + Number(r.reserved_sports),
    lockedBonus: Number(r.locked),
    pendingWithdrawals: Number(r.pending_wd),
    totals: { wagered: Number(r.wagered), won: Number(r.won), received: Number(r.received), refunded: Number(r.refunded), adjusted: Number(r.adjusted), deposited: Number(r.deposited), withdrawn: Number(r.withdrawn) },
  };
}
