import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { ledgerAccounts, type AccountType } from '../db/schema';

/** System accounts in canonical lock order (lower rank is locked first). */
export const SYSTEM_ACCOUNTS = {
  HOUSE_BANKROLL: { code: 'SYSTEM:HOUSE_BANKROLL', rank: 1, allowNegative: false },
  WAGERS_IN_PLAY: { code: 'SYSTEM:WAGERS_IN_PLAY', rank: 2, allowNegative: false },
  SPORTS_IN_PLAY: { code: 'SYSTEM:SPORTS_IN_PLAY', rank: 3, allowNegative: false },
  PROMOTIONS: { code: 'SYSTEM:PROMOTIONS', rank: 4, allowNegative: true },
  ADJUSTMENTS: { code: 'SYSTEM:ADJUSTMENTS', rank: 5, allowNegative: true },
  ISSUANCE: { code: 'SYSTEM:ISSUANCE', rank: 6, allowNegative: true },
} as const satisfies Partial<Record<AccountType, { code: string; rank: number; allowNegative: boolean }>>;

export type SystemAccountType = keyof typeof SYSTEM_ACCOUNTS;
export type SystemAccountIds = Record<SystemAccountType, number>;

let cache: { ids: SystemAccountIds; rankById: Map<number, number> } | undefined;

/** Creates the system accounts if missing (idempotent). */
export async function ensureSystemAccounts(db: Executor): Promise<SystemAccountIds> {
  for (const [type, def] of Object.entries(SYSTEM_ACCOUNTS)) {
    await db
      .insert(ledgerAccounts)
      .values({ code: def.code, type: type as AccountType, allowNegative: def.allowNegative })
      .onConflictDoNothing({ target: ledgerAccounts.code });
  }
  cache = undefined;
  return systemAccountIds(db);
}

export async function systemAccountIds(db: Executor): Promise<SystemAccountIds> {
  if (cache) return cache.ids;
  const rows = await db
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.code, Object.values(SYSTEM_ACCOUNTS).map((a) => a.code)));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const ids = {} as SystemAccountIds;
  const rankById = new Map<number, number>();
  for (const [type, def] of Object.entries(SYSTEM_ACCOUNTS) as [SystemAccountType, (typeof SYSTEM_ACCOUNTS)[SystemAccountType]][]) {
    const id = byCode.get(def.code);
    if (id === undefined) throw new Error(`system account ${def.code} is missing; run migrations and bootstrap`);
    ids[type] = id;
    rankById.set(id, def.rank);
  }
  cache = { ids, rankById };
  return ids;
}

/** Lock-order rank: player wallets (0) before system accounts (1..5). */
export function accountRank(accountId: number): number {
  return cache?.rankById.get(accountId) ?? 0;
}

export function resetAccountCache(): void {
  cache = undefined;
}

export async function createWalletAccount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .insert(ledgerAccounts)
    .values({ code: `WALLET:${userId}`, type: 'PLAYER_WALLET', userId, allowNegative: false })
    .returning({ id: ledgerAccounts.id });
  return row!.id;
}

export interface AccountRow {
  id: number;
  balance: number;
}

export async function getWalletAccount(db: Executor, userId: string): Promise<AccountRow | undefined> {
  const [row] = await db
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.userId, userId), eq(ledgerAccounts.type, 'PLAYER_WALLET')));
  return row;
}

/** SELECT … FOR UPDATE on the player's wallet: serialises all money movement for that player. */
export async function lockWalletAccount(tx: Tx, userId: string): Promise<AccountRow> {
  const [row] = await tx
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.userId, userId), eq(ledgerAccounts.type, 'PLAYER_WALLET')))
    .for('update');
  if (!row) throw new Error(`wallet for user ${userId} does not exist`);
  return row;
}

export async function lockAccount(tx: Tx, accountId: number): Promise<AccountRow> {
  const [row] = await tx
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, accountId))
    .for('update');
  if (!row) throw new Error(`account ${accountId} does not exist`);
  return row;
}

export async function accountBalance(db: Executor, accountId: number): Promise<number> {
  const [row] = await db
    .select({ balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, accountId));
  if (!row) throw new Error(`account ${accountId} does not exist`);
  return row.balance;
}

/** Sum of all entries for an account, computed from the ledger itself. */
export async function ledgerBalance(db: Executor, accountId: number): Promise<number> {
  const res = await db.execute<{ total: string }>(
    sql`SELECT coalesce(sum(amount), 0)::text AS total FROM ledger_entries WHERE account_id = ${accountId}`,
  );
  return Number(res.rows[0]?.total ?? 0);
}
