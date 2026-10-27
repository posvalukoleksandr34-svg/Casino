/**
 * Player and staff account administration. Every change runs in one
 * transaction with its audited admin action, under row locks taken in one
 * order (all owner rows plus the actor and the target, by id), so concurrent
 * role or status changes serialise and can never remove the last active owner.
 *
 * Who may act on whom comes from rbac.ts: staff act only on accounts of a
 * lower rank (owners may act on owners), and only owners grant or remove the
 * ADMIN and OWNER roles. The actor's role is re-read under the lock rather
 * than trusted from the session.
 */
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { adminActions, auditLogs, ledgerTransactions, responsibleLimits, sessions, users, type UserRole, type UserStatus } from '../db/schema';
import { errors } from '../errors';
import { recordAdminAction } from '../audit/audit';
import { revokeAllSessions } from '../auth/sessions';
import { assignableRoles, canManageUser, hasPermission, maskEmail, ROLE_LABELS, type Permission } from '../auth/rbac';
import { countryName } from '../users/countries';
import { formatPhone } from '../users/onboarding';
import { getWalletAccount } from '../ledger/accounts';
import { listRounds } from '../games/round-service';
import { playerStats } from '../users/stats';
import { sportsStats } from '../sports/tickets';
import { listTransactions } from '../wallet/wallet';
import type { AdminCtx } from './admin-service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes LIKE wildcards so a search term matches literally. */
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------
// Listing and detail
// ---------------------------------------------------------------------------
export const USER_SORTS = ['created', 'last_login', 'username', 'balance'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface UserListOptions {
  q?: string;
  status?: UserStatus;
  role?: UserRole;
  /** Registration date range, inclusive start, exclusive end. */
  from?: Date;
  to?: Date;
  sort?: UserSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  /** Viewer may see and search e-mail addresses (users:pii). */
  canSeePii: boolean;
}

export async function listUsers(opts: UserListOptions) {
  const db = getDb();
  const q = opts.q?.trim().slice(0, 100);
  const conds: (SQL | undefined)[] = [
    opts.status ? eq(users.status, opts.status) : undefined,
    opts.role ? eq(users.role, opts.role) : undefined,
    opts.from ? sql`${users.createdAt} >= ${opts.from}` : undefined,
    opts.to ? sql`${users.createdAt} < ${opts.to}` : undefined,
  ];
  if (q) {
    if (UUID.test(q)) conds.push(eq(users.id, q));
    else {
      const term = likeTerm(q);
      conds.push(or(ilike(users.username, term), ilike(users.displayName, term), opts.canSeePii ? ilike(users.email, term) : undefined));
    }
  }
  const where = and(...conds.filter(Boolean));
  // Qualified explicitly: in a single-table select Drizzle renders ${users.id} as a bare "id", which the subquery would bind to ledger_accounts.id.
  const balance = sql<number>`(SELECT a.balance FROM ledger_accounts a WHERE a.user_id = "users"."id" AND a.type = 'PLAYER_WALLET')`;
  const dir = opts.dir === 'asc' ? sql`ASC` : sql`DESC`;
  const order = {
    created: sql`${users.createdAt} ${dir}`,
    last_login: sql`${users.lastLoginAt} ${dir} NULLS LAST`,
    username: sql`lower(${users.username}) ${dir}`,
    balance: sql`${balance} ${dir} NULLS LAST`,
  }[opts.sort ?? 'created'];
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        balance: balance.mapWith(Number),
      })
      .from(users)
      .where(where)
      .orderBy(order, desc(users.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, email: opts.canSeePii ? r.email : maskEmail(r.email) })),
    total: count?.n ?? 0,
    page,
    pageSize,
  };
}

export async function userDetail(userId: string, viewer: { role: UserRole }) {
  if (!UUID.test(userId)) throw errors.notFound('User');
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      role: users.role,
      status: users.status,
      statusReason: users.statusReason,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      deletedAt: users.deletedAt,
      emailVerifiedAt: users.emailVerifiedAt,
      emailVerificationMethod: users.emailVerificationMethod,
      onboardingRequired: users.onboardingRequired,
      onboardingCompletedAt: users.onboardingCompletedAt,
      firstName: users.firstName,
      lastName: users.lastName,
      dateOfBirth: users.dateOfBirth,
      countryCode: users.countryCode,
      phoneE164: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw errors.notFound('User');
  const canSeePii = hasPermission(viewer.role, 'users:pii');
  const { firstName, lastName, dateOfBirth, countryCode, phoneE164, phoneVerifiedAt, ...account } = user;
  const lifecycle = !account.emailVerifiedAt ? 'awaiting_verification' : account.onboardingRequired && !account.onboardingCompletedAt ? 'profile_pending' : 'active';
  const wallet = await getWalletAccount(db, userId);
  const [limits] = await db.select().from(responsibleLimits).where(eq(responsibleLimits.userId, userId));
  const [sessionRows, adminHistory, security, moneyOps, ledgerCheck, mfa] = await Promise.all([
    db
      .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt, userAgent: sessions.userAgent, mfaVerifiedAt: sessions.mfaVerifiedAt })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(10),
    db
      .select({ id: adminActions.id, createdAt: adminActions.createdAt, action: adminActions.action, reason: adminActions.reason, before: adminActions.before, after: adminActions.after, adminName: users.username })
      .from(adminActions)
      .innerJoin(users, eq(users.id, adminActions.adminId))
      .where(and(eq(adminActions.targetType, 'user'), eq(adminActions.targetId, userId)))
      .orderBy(desc(adminActions.id))
      .limit(50),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, createdAt: auditLogs.createdAt, outcome: auditLogs.outcome, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, userId), or(ilike(auditLogs.action, 'auth.%'), ilike(auditLogs.action, 'security.%'), ilike(auditLogs.action, 'user.%'))))
      .orderBy(desc(auditLogs.id))
      .limit(30),
    db
      .select({ id: ledgerTransactions.id, type: ledgerTransactions.type, createdAt: ledgerTransactions.createdAt, description: ledgerTransactions.description, actorId: ledgerTransactions.actorId })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.userId, userId), inArray(ledgerTransactions.type, ['ADJUSTMENT', 'CHIP_GRANT'])))
      .orderBy(desc(ledgerTransactions.id))
      .limit(20),
    wallet
      ? db.execute<{ entries_sum: string; entry_count: number }>(
          sql`SELECT coalesce(sum(amount), 0)::text AS entries_sum, count(*)::int AS entry_count FROM ledger_entries WHERE account_id = ${wallet.id}`,
        )
      : Promise.resolve(null),
    db.execute<{ enabled: boolean }>(sql`SELECT enabled_at IS NOT NULL AS enabled FROM user_mfa WHERE user_id = ${userId}`),
  ]);
  const entriesSum = ledgerCheck ? Number(ledgerCheck.rows[0]?.entries_sum ?? 0) : 0;
  return {
    user: { ...account, email: canSeePii ? user.email : maskEmail(user.email), roleLabel: ROLE_LABELS[user.role] },
    /** Registration progress: unverified accounts have no wallet, session or chips yet. */
    lifecycle,
    /** Personal details only for roles with users:pii (support); others see whether they are present. */
    personal: canSeePii
      ? { firstName, lastName, dateOfBirth, countryCode, countryName: countryName(countryCode), phone: formatPhone(phoneE164), phoneVerified: phoneVerifiedAt !== null }
      : { provided: Boolean(firstName && lastName && dateOfBirth && countryCode && phoneE164) },
    balance: wallet?.balance ?? 0,
    /** The stored balance re-derived from the wallet's ledger entries; they must agree. */
    ledgerCheck: { entriesSum, matches: !wallet || entriesSum === wallet.balance },
    mfaEnabled: mfa.rows[0]?.enabled ?? false,
    stats: await playerStats(userId),
    sports: await sportsStats(userId),
    responsibleLimits: limits ?? null,
    sessions: sessionRows,
    recentRounds: await listRounds({ userId, limit: 20 }),
    recentTransactions: await listTransactions(userId, { limit: 20 }),
    adminHistory,
    security,
    moneyOps,
    /** What the viewer may do to this account (the server re-checks each action). */
    allowed: {
      changeStatus: hasPermission(viewer.role, 'users:suspend') && canManageUser(viewer.role, user.role) && user.status !== 'DELETED',
      revokeSessions: hasPermission(viewer.role, 'users:suspend') && canManageUser(viewer.role, user.role),
      roles: user.status === 'DELETED' ? [] : assignableRoles(viewer.role, user.role),
      grant: hasPermission(viewer.role, 'ledger:grant') && user.status === 'ACTIVE' && wallet !== undefined && wallet !== null,
      adjust: hasPermission(viewer.role, 'ledger:adjust') && user.status !== 'DELETED' && wallet !== undefined && wallet !== null,
    },
  };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------
interface LockedAccount {
  id: string;
  role: UserRole;
  status: UserStatus;
  statusReason: string | null;
}

/**
 * Locks every owner row, the actor and the target in id order (one global
 * order, so these changes cannot deadlock each other) and returns them.
 */
export async function lockForStaffChange(tx: Tx, actorId: string, targetId: string) {
  const res = await tx.execute<{ id: string; role: UserRole; status: UserStatus; status_reason: string | null }>(sql`
    SELECT id, role, status, status_reason FROM users
     WHERE id IN (${actorId}, ${targetId}) OR role = 'OWNER'
     ORDER BY id FOR UPDATE`);
  const rows: LockedAccount[] = res.rows.map((r) => ({ id: r.id, role: r.role, status: r.status, statusReason: r.status_reason }));
  const actor = rows.find((r) => r.id === actorId);
  const target = rows.find((r) => r.id === targetId);
  const activeOwners = rows.filter((r) => r.role === 'OWNER' && r.status === 'ACTIVE').length;
  return { actor, target, activeOwners };
}

function requireActor(actor: LockedAccount | undefined, permission: Permission): LockedAccount {
  if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, permission)) throw errors.forbidden();
  return actor;
}

function isLastActiveOwner(target: LockedAccount, activeOwners: number): boolean {
  return target.role === 'OWNER' && target.status === 'ACTIVE' && activeOwners <= 1;
}

export async function setUserStatus(ctx: AdminCtx, userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
  if (userId === ctx.adminId) throw errors.conflict('You cannot change the status of your own account');
  return withTransaction(async (tx) => {
    const { actor: a, target, activeOwners } = await lockForStaffChange(tx, ctx.adminId, userId);
    const actor = requireActor(a, 'users:suspend');
    if (!target) throw errors.notFound('User');
    if (target.status === 'DELETED') throw errors.conflict('Deleted accounts cannot be reactivated');
    if (!canManageUser(actor.role, target.role)) throw errors.forbidden('You cannot change an account with the same or a higher role than yours');
    if (target.status === status) throw errors.conflict(status === 'SUSPENDED' ? 'The account is already suspended' : 'The account is already active');
    if (status === 'SUSPENDED' && isLastActiveOwner(target, activeOwners)) throw errors.conflict('The last active owner cannot be suspended');
    await tx.update(users).set({ status, statusReason: reason, updatedAt: new Date() }).where(eq(users.id, userId));
    const revoked = status === 'SUSPENDED' ? await revokeAllSessions(tx, userId) : 0;
    await recordAdminAction(tx, {
      ...ctx,
      action: status === 'SUSPENDED' ? 'user.suspended' : 'user.reinstated',
      targetType: 'user',
      targetId: userId,
      reason,
      before: { status: target.status, statusReason: target.statusReason },
      after: { status, statusReason: reason, sessionsRevoked: revoked },
    });
    return { status };
  });
}

export async function setUserRole(ctx: AdminCtx, userId: string, role: UserRole, reason: string) {
  if (userId === ctx.adminId) throw errors.conflict('You cannot change your own role');
  return withTransaction(async (tx) => {
    const { actor: a, target, activeOwners } = await lockForStaffChange(tx, ctx.adminId, userId);
    const actor = requireActor(a, 'roles:manage');
    if (!target) throw errors.notFound('User');
    if (target.status === 'DELETED') throw errors.conflict('Deleted accounts cannot be given roles');
    if (target.role === role) throw errors.conflict('The account already has this role');
    if (!assignableRoles(actor.role, target.role).includes(role)) {
      throw errors.forbidden(
        role === 'ADMIN' || role === 'OWNER' || target.role === 'ADMIN' || target.role === 'OWNER'
          ? 'Only an owner can grant or remove the admin and owner roles'
          : 'You cannot change an account with the same or a higher role than yours',
      );
    }
    if (isLastActiveOwner(target, activeOwners)) throw errors.conflict('The last active owner cannot be demoted; make another account owner first');
    await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
    const revoked = await revokeAllSessions(tx, userId); // force re-login with the new privileges
    await recordAdminAction(tx, {
      ...ctx,
      action: 'user.role',
      targetType: 'user',
      targetId: userId,
      reason,
      before: { role: target.role },
      after: { role, sessionsRevoked: revoked },
    });
    return { role };
  });
}

/** Signs an account out everywhere (e.g. a suspected compromise), without suspending it. */
export async function revokeUserSessions(ctx: AdminCtx, userId: string, reason: string) {
  if (userId === ctx.adminId) throw errors.conflict('Use “Sign out everywhere” in your own settings instead');
  return withTransaction(async (tx) => {
    const { actor: a, target } = await lockForStaffChange(tx, ctx.adminId, userId);
    const actor = requireActor(a, 'users:suspend');
    if (!target) throw errors.notFound('User');
    if (!canManageUser(actor.role, target.role)) throw errors.forbidden('You cannot change an account with the same or a higher role than yours');
    const revoked = await revokeAllSessions(tx, userId);
    await recordAdminAction(tx, { ...ctx, action: 'user.sessions_revoked', targetType: 'user', targetId: userId, reason, before: null, after: { sessionsRevoked: revoked } });
    return { revoked };
  });
}

/** Active (unrevoked, unexpired) owner accounts; used by provisioning and checks. */
export async function activeOwnerCount(db: Executor = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.status, 'ACTIVE'), isNull(users.deletedAt)));
  return row?.n ?? 0;
}
