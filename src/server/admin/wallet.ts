/**
 * Virtual-chip administration on top of the one ledger (no second balance
 * system). Chips have no monetary value; nothing here moves real money.
 *
 *   CHIP_GRANT  (owner)  promotions −amount  wallet +amount   test chips, positive only
 *   ADJUSTMENT  (admin)  adjustments ∓amount wallet ±amount   compensating correction
 *
 * Both are posted under the wallet lock in one transaction with their audited
 * admin action, are idempotent per staff member and Idempotency-Key (a retry
 * replays the original response instead of posting again), never take a
 * resulting balance from the client and never edit existing entries. The
 * database refuses a negative wallet balance; grants also respect the
 * platform's player balance cap.
 */
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { getDb, withTransaction, type Tx } from '../db/client';
import { ledgerAccounts, ledgerEntries, ledgerTransactions, users, type LedgerTxType } from '../db/schema';
import { AppError, errors } from '../errors';
import { recordAdminAction } from '../audit/audit';
import { hasPermission, type Permission } from '../auth/rbac';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { getPlatformSettings } from '../risk/risk-service';
import type { AdminCtx } from './admin-service';

/** Largest single grant: 1,000,000 chips (minor units). */
export const MAX_GRANT = 100_000_000;
/** Largest single correction: 100,000,000 chips (minor units). */
export const MAX_ADJUSTMENT = 10_000_000_000;

export interface MoneyOpResult {
  transactionId: number;
  balance: number;
}

async function requireStaff(tx: Tx, adminId: string, permission: Permission) {
  const [actor] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, adminId));
  if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, permission)) throw errors.forbidden();
}

async function requireTarget(tx: Tx, userId: string, opts: { activeOnly: boolean }) {
  const [target] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
  if (!target) throw errors.notFound('User');
  if (target.status === 'DELETED' || (opts.activeOnly && target.status !== 'ACTIVE')) {
    throw errors.conflict(opts.activeOnly ? 'Chips can only be granted to active accounts' : 'Deleted accounts cannot be corrected');
  }
}

/** Owner-only grant of virtual test chips to a player. */
export async function grantChips(ctx: AdminCtx, userId: string, amount: number, reason: string, idempotencyKey: string): Promise<IdempotentResult<MoneyOpResult>> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw errors.validation('Amount must be a positive whole number of minor units');
  if (amount > MAX_GRANT) throw errors.validation(`A single grant is limited to ${(MAX_GRANT / 100).toLocaleString('en-US')} chips`);
  return withTransaction((tx) =>
    runIdempotent(tx, ctx.adminId, idempotencyKey, requestFingerprint('admin:grant', { userId, amount, reason }), async () => {
      // Wallet first, as every wager does; the account rows are only read.
      const wallet = await lockWalletAccount(tx, userId);
      await requireStaff(tx, ctx.adminId, 'ledger:grant');
      await requireTarget(tx, userId, { activeOnly: true });
      const settings = await getPlatformSettings(tx);
      if (wallet.balance + amount > settings.maxPlayerBalance) {
        throw errors.validation(`The grant would take the balance above the player balance cap of ${(settings.maxPlayerBalance / 100).toLocaleString('en-US')} chips`, {
          balance: wallet.balance,
          cap: settings.maxPlayerBalance,
        });
      }
      const ids = await systemAccountIds(tx);
      const posted = await postTransaction(tx, {
        type: 'CHIP_GRANT',
        idempotencyKey: `chip-grant:${ctx.adminId}:${idempotencyKey}`,
        userId,
        actorId: ctx.adminId,
        description: `Virtual test chips granted: ${reason}`,
        postings: [
          { accountId: wallet.id, amount },
          { accountId: ids.PROMOTIONS, amount: -amount },
        ],
        metadata: { reason },
      });
      const balance = wallet.balance + amount;
      await recordAdminAction(tx, {
        ...ctx,
        action: 'ledger.grant',
        targetType: 'user',
        targetId: userId,
        reason,
        before: { balance: wallet.balance },
        after: { balance, amount, transactionId: posted.id },
      });
      return { status: 201, body: { transactionId: posted.id, balance } };
    }),
  );
}

/**
 * Compensating correction of a player's balance. Visible in the player's own
 * transaction history as a correction with the stated reason; never edits
 * existing entries. A debit larger than the balance is refused by the
 * database (wallets cannot go negative).
 */
export async function adjustBalance(
  ctx: AdminCtx,
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey: string,
  reversesTransactionId?: number,
): Promise<IdempotentResult<MoneyOpResult>> {
  if (!Number.isSafeInteger(amount) || amount === 0) throw errors.validation('Amount must be a non-zero whole number of minor units');
  if (Math.abs(amount) > MAX_ADJUSTMENT) throw errors.validation('Corrections above 100,000,000 chips require a migration-level change');
  return withTransaction((tx) =>
    runIdempotent(tx, ctx.adminId, idempotencyKey, requestFingerprint('admin:adjust', { userId, amount, reason, reversesTransactionId: reversesTransactionId ?? null }), async () => {
      const wallet = await lockWalletAccount(tx, userId);
      await requireStaff(tx, ctx.adminId, 'ledger:adjust');
      await requireTarget(tx, userId, { activeOnly: false });
      if (reversesTransactionId !== undefined) {
        const [orig] = await tx.select({ id: ledgerTransactions.id, userId: ledgerTransactions.userId }).from(ledgerTransactions).where(eq(ledgerTransactions.id, reversesTransactionId));
        if (!orig || orig.userId !== userId) throw errors.validation('Referenced transaction does not belong to this player');
      }
      if (wallet.balance + amount < 0) throw new AppError('INSUFFICIENT_FUNDS', 'The correction would make the balance negative', { balance: wallet.balance });
      const ids = await systemAccountIds(tx);
      const posted = await postTransaction(tx, {
        type: 'ADJUSTMENT',
        idempotencyKey: `adjustment:${ctx.adminId}:${idempotencyKey}`,
        userId,
        actorId: ctx.adminId,
        reversesId: reversesTransactionId ?? null,
        description: `Balance correction: ${reason}`,
        postings: [
          { accountId: wallet.id, amount },
          { accountId: ids.ADJUSTMENTS, amount: -amount },
        ],
        metadata: { reason },
      });
      const balance = wallet.balance + amount;
      await recordAdminAction(tx, {
        ...ctx,
        action: 'ledger.adjustment',
        targetType: 'user',
        targetId: userId,
        reason,
        before: { balance: wallet.balance },
        after: { balance, amount, transactionId: posted.id, reverses: reversesTransactionId ?? null },
      });
      return { status: 201, body: { transactionId: posted.id, balance } };
    }),
  );
}

// ---------------------------------------------------------------------------
// Ledger browsing
// ---------------------------------------------------------------------------
export const LEDGER_TYPES: readonly LedgerTxType[] = [
  'BET_PLACED',
  'BET_SETTLED',
  'ROUND_VOIDED',
  'BONUS_GRANTED',
  'CHIP_GRANT',
  'ADJUSTMENT',
  'HOUSE_FUNDING',
  'SPORTS_STAKE',
  'SPORTS_SETTLED',
  'SPORTS_VOIDED',
  'SPORTS_CORRECTION',
];

export interface LedgerQuery {
  type?: LedgerTxType;
  userId?: string;
  transactionId?: number;
  from?: Date;
  to?: Date;
  /** Keyset pagination: transactions with id below this. */
  before?: number;
  limit?: number;
}

/** Transactions newest first, with the player's wallet leg (if any) and the total moved. */
export async function listLedger(q: LedgerQuery) {
  const conds = [
    q.type ? eq(ledgerTransactions.type, q.type) : undefined,
    q.userId ? eq(ledgerTransactions.userId, q.userId) : undefined,
    q.transactionId ? eq(ledgerTransactions.id, q.transactionId) : undefined,
    q.from ? gte(ledgerTransactions.createdAt, q.from) : undefined,
    q.to ? lt(ledgerTransactions.createdAt, q.to) : undefined,
    q.before ? lt(ledgerTransactions.id, q.before) : undefined,
  ].filter(Boolean) as SQL[];
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await getDb()
    .select({
      id: ledgerTransactions.id,
      createdAt: ledgerTransactions.createdAt,
      type: ledgerTransactions.type,
      description: ledgerTransactions.description,
      userId: ledgerTransactions.userId,
      username: users.username,
      actorId: ledgerTransactions.actorId,
      roundId: ledgerTransactions.roundId,
      sportsTicketId: ledgerTransactions.sportsTicketId,
      reversesId: ledgerTransactions.reversesId,
      walletDelta: sql<number | null>`(SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = "ledger_transactions"."id" AND a.type = 'PLAYER_WALLET')`.mapWith((v) => (v === null ? null : Number(v))),
      moved: sql<number>`(SELECT sum(e.amount) FILTER (WHERE e.amount > 0) FROM ledger_entries e WHERE e.transaction_id = "ledger_transactions"."id")`.mapWith(Number),
    })
    .from(ledgerTransactions)
    .leftJoin(users, eq(users.id, ledgerTransactions.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ledgerTransactions.id))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), nextBefore: rows.length > limit ? rows[limit - 1]!.id : null };
}

/** The entries of one transaction, with account codes, for investigation. */
export async function ledgerTransactionDetail(id: number) {
  const db = getDb();
  const [tx] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id));
  if (!tx) throw errors.notFound('Transaction');
  const entries = await db
    .select({ id: ledgerEntries.id, accountCode: ledgerAccounts.code, accountType: ledgerAccounts.type, amount: ledgerEntries.amount, balanceAfter: ledgerEntries.balanceAfter, accountSeq: ledgerEntries.accountSeq })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.transactionId, id))
    .orderBy(ledgerEntries.id);
  return { transaction: tx, entries, balanced: entries.reduce((a, e) => a + e.amount, 0) === 0 };
}

/** Totals per transaction type in a period: count and chips credited to / debited from player wallets. */
export async function ledgerTotals(period: { from?: Date; to?: Date }) {
  const res = await getDb().execute<{ type: LedgerTxType; n: number; wallet_in: string; wallet_out: string }>(sql`
    SELECT t.type, count(DISTINCT t.id)::int AS n,
           coalesce(sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET' AND e.amount > 0), 0)::text AS wallet_in,
           coalesce(-sum(e.amount) FILTER (WHERE a.type = 'PLAYER_WALLET' AND e.amount < 0), 0)::text AS wallet_out
      FROM ledger_transactions t
      JOIN ledger_entries e ON e.transaction_id = t.id
      JOIN ledger_accounts a ON a.id = e.account_id
     WHERE TRUE ${period.from ? sql`AND t.created_at >= ${period.from}` : sql``} ${period.to ? sql`AND t.created_at < ${period.to}` : sql``}
     GROUP BY t.type ORDER BY t.type`);
  return res.rows.map((r) => ({ type: r.type, count: r.n, walletIn: Number(r.wallet_in), walletOut: Number(r.wallet_out) }));
}

/** Balances of the system accounts (house, escrows, promotions, adjustments, issuance). */
export async function systemBalances() {
  return getDb()
    .select({ code: ledgerAccounts.code, type: ledgerAccounts.type, balance: ledgerAccounts.balance, entryCount: ledgerAccounts.entryCount })
    .from(ledgerAccounts)
    .where(sql`${ledgerAccounts.userId} IS NULL`)
    .orderBy(ledgerAccounts.id);
}
