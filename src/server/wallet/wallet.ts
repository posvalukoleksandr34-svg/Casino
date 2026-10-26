import { and, desc, eq, lt } from 'drizzle-orm';
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
