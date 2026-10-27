/**
 * Administrative operations. Every state change runs in one transaction with
 * its admin_actions/audit_logs record (actor, time, target, before, after,
 * reason), so a change without an audit record cannot exist. There is no
 * operation that edits balances or settled rounds directly.
 */
import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getGameModule } from '@/engine/games/registry';
import { getDb, withTransaction } from '../db/client';
import {
  alerts,
  auditLogs,
  gameConfigurations,
  games,
  platformSettings,
  reconciliationRuns,
  riskLimits,
  users,
} from '../db/schema';
import { errors } from '../errors';
import { recordAdminAction } from '../audit/audit';
import { accountBalance, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { hasPermission } from '../auth/rbac';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { requireGameId } from '../games/catalog';
import { getPlatformSettings, openExposure } from '../risk/risk-service';
import { platformSummary, exposureByGame } from '../analytics/analytics';

export interface AdminCtx {
  adminId: string;
  ipHash: string | null;
  requestId: string;
}

export const reasonSchema = z.string().trim().min(5, 'A reason of at least 5 characters is required').max(500);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export async function overview() {
  const db = getDb();
  const ids = await systemAccountIds(db);
  const settings = await getPlatformSettings(db);
  const [userCounts] = (
    await db.execute<{ registered: number; active_24h: number; active_7d: number; suspended: number }>(sql`
      SELECT count(*) FILTER (WHERE status <> 'DELETED')::int AS registered,
             (SELECT count(DISTINCT user_id) FROM game_rounds WHERE started_at > now() - interval '1 day')::int AS active_24h,
             (SELECT count(DISTINCT user_id) FROM game_rounds WHERE started_at > now() - interval '7 days')::int AS active_7d,
             count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended
      FROM users`)
  ).rows;
  const house = await accountBalance(db, ids.HOUSE_BANKROLL);
  const escrow = await accountBalance(db, ids.WAGERS_IN_PLAY);
  const exposure = await openExposure(db);
  const allTime = await platformSummary();
  const last24h = await platformSummary({ from: new Date(Date.now() - 86400_000) });
  const gameRows = await db.select({ id: games.id, name: games.name, status: games.status, statusReason: games.statusReason }).from(games).orderBy(games.sortOrder);
  const errorsRes = await db.execute<{ last_hour: number; last_day: number }>(sql`
    SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
           count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day FROM error_events`);
  const openAlerts = await db.select().from(alerts).where(sql`${alerts.acknowledgedAt} IS NULL`).orderBy(desc(alerts.createdAt)).limit(10);
  const [lastRecon] = await db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.id)).limit(1);
  return {
    users: userCounts,
    allTime,
    last24h,
    reserves: {
      houseBalance: house,
      wagersInPlay: escrow,
      openNetExposure: exposure,
      minHouseReserve: settings.minHouseReserve,
      maxTotalExposure: settings.maxTotalExposure,
      availableHeadroom: house - exposure - settings.minHouseReserve,
    },
    exposureByGame: await exposureByGame(),
    platform: { newRoundsEnabled: settings.newRoundsEnabled, incidentMessage: settings.incidentMessage },
    games: gameRows,
    errors: errorsRes.rows[0] ?? { last_hour: 0, last_day: 0 },
    openAlerts,
    lastReconciliation: lastRecon ?? null,
  };
}

// ---------------------------------------------------------------------------
// Games, configuration and risk
// ---------------------------------------------------------------------------
export async function adminGames() {
  const db = getDb();
  const rows = await db
    .select({ game: games, limits: riskLimits })
    .from(games)
    .innerJoin(riskLimits, eq(riskLimits.gameId, games.id))
    .orderBy(games.sortOrder);
  const configs = await db.select().from(gameConfigurations).orderBy(desc(gameConfigurations.version));
  return rows.map((r) => {
    const mod = getGameModule(requireGameId(r.game.id));
    const versions = configs.filter((c) => c.gameId === r.game.id);
    const active = versions.find((c) => c.isActive);
    return {
      ...r.game,
      limits: r.limits,
      activeConfig: active ? { id: active.id, version: active.version, config: active.config, createdAt: active.createdAt } : null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, isActive: v.isActive, createdAt: v.createdAt })),
      theoretical: active ? mod.theoretical(mod.configSchema.parse(active.config)) : null,
      defaultConfig: mod.defaultConfig,
    };
  });
}

export async function setGameStatus(ctx: AdminCtx, gameId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED', reason: string) {
  const id = requireGameId(gameId);
  return withTransaction(async (tx) => {
    const [before] = await tx.select({ status: games.status, statusReason: games.statusReason }).from(games).where(eq(games.id, id)).for('update');
    if (!before) throw errors.notFound('Game');
    await tx
      .update(games)
      .set({ status, statusReason: status === 'ACTIVE' ? null : reason, updatedAt: new Date() })
      .where(eq(games.id, id));
    await recordAdminAction(tx, { ...ctx, action: 'game.status', targetType: 'game', targetId: id, reason, before, after: { status } });
    return { status };
  });
}

/**
 * Publishes a new immutable configuration version. Refuses any configuration
 * whose documented theoretical house edge is not strictly positive.
 */
export async function publishGameConfig(ctx: AdminCtx, gameId: string, rawConfig: unknown, reason: string) {
  const id = requireGameId(gameId);
  const mod = getGameModule(id);
  const parsed = mod.configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw errors.validation('Invalid configuration', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const theory = mod.theoretical(parsed.data);
  if (!(theory.houseEdge > 0)) throw errors.validation('Configuration must keep a strictly positive house edge', { theory });
  return withTransaction(async (tx) => {
    const current = await tx.select().from(gameConfigurations).where(eq(gameConfigurations.gameId, id)).orderBy(desc(gameConfigurations.version)).for('update');
    const active = current.find((c) => c.isActive);
    const version = (current[0]?.version ?? 0) + 1;
    if (active) await tx.update(gameConfigurations).set({ isActive: false }).where(eq(gameConfigurations.id, active.id));
    const [created] = await tx
      .insert(gameConfigurations)
      .values({ gameId: id, version, config: parsed.data, isActive: true, createdBy: ctx.adminId })
      .returning();
    await recordAdminAction(tx, {
      ...ctx,
      action: 'game.config_published',
      targetType: 'game',
      targetId: id,
      reason,
      before: active ? { version: active.version, config: active.config } : null,
      after: { version, config: parsed.data, theoreticalRtp: theory.rtp },
    });
    return { version: created!.version, theoretical: theory };
  });
}

export const riskLimitsSchema = z
  .object({
    minStake: z.int().positive(),
    maxStake: z.int().positive(),
    maxPayoutPerRound: z.int().positive(),
    maxGameExposure: z.int().positive(),
  })
  .strict()
  .refine((l) => l.maxStake >= l.minStake, { message: 'maxStake must be ≥ minStake' });

export async function updateRiskLimits(ctx: AdminCtx, gameId: string, limits: z.infer<typeof riskLimitsSchema>, reason: string) {
  const id = requireGameId(gameId);
  return withTransaction(async (tx) => {
    const [before] = await tx.select().from(riskLimits).where(eq(riskLimits.gameId, id)).for('update');
    if (!before) throw errors.notFound('Risk limits');
    await tx.update(riskLimits).set({ ...limits, updatedAt: new Date(), updatedBy: ctx.adminId }).where(eq(riskLimits.gameId, id));
    const { updatedAt: _u, updatedBy: _b, gameId: _g, ...prev } = before;
    await recordAdminAction(tx, { ...ctx, action: 'risk.limits_updated', targetType: 'game', targetId: id, reason, before: prev, after: limits });
    return limits;
  });
}

export const platformPatchSchema = z
  .object({
    newRoundsEnabled: z.boolean(),
    incidentMessage: z.string().trim().max(300).nullable(),
    maxTotalExposure: z.int().positive(),
    minHouseReserve: z.int().min(0),
    maxPlayerBalance: z.int().positive(),
    signupBonus: z.int().min(0),
    dailyBonus: z.int().min(0),
    dailyBonusMaxBalance: z.int().min(0),
    anomalyZThreshold: z.number().min(2).max(10),
  })
  .partial()
  .strict();

export async function updatePlatformSettings(ctx: AdminCtx, patch: z.infer<typeof platformPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const [before] = await tx.select().from(platformSettings).where(eq(platformSettings.id, 1)).for('update');
    if (!before) throw errors.notFound('Platform settings');
    await tx.update(platformSettings).set({ ...patch, updatedAt: new Date(), updatedBy: ctx.adminId }).where(eq(platformSettings.id, 1));
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) prev[k] = (before as Record<string, unknown>)[k];
    await recordAdminAction(tx, { ...ctx, action: 'platform.settings_updated', targetType: 'platform', targetId: '1', reason, before: prev, after: patch });
    return patch;
  });
}

// ---------------------------------------------------------------------------
// House funding (owner only; player grants and corrections: wallet.ts)
// ---------------------------------------------------------------------------
/**
 * Issues virtual chips into the house bankroll (owner only). Idempotent per
 * owner and Idempotency-Key: a retry replays the original response.
 */
export async function fundHouse(ctx: AdminCtx, amount: number, reason: string, idempotencyKey: string): Promise<IdempotentResult<{ balance: number; transactionId: number }>> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw errors.validation('Amount must be a positive integer (minor units)');
  return withTransaction((tx) =>
    runIdempotent(tx, ctx.adminId, idempotencyKey, requestFingerprint('admin:house-fund', { amount, reason }), async () => {
      const [actor] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, ctx.adminId));
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'house:fund')) throw errors.forbidden();
      const ids = await systemAccountIds(tx);
      const before = await accountBalance(tx, ids.HOUSE_BANKROLL);
      const posted = await postTransaction(tx, {
        type: 'HOUSE_FUNDING',
        idempotencyKey: `house-funding:${ctx.adminId}:${idempotencyKey}`,
        actorId: ctx.adminId,
        description: `House reserve funding: ${reason}`,
        postings: [
          { accountId: ids.ISSUANCE, amount: -amount },
          { accountId: ids.HOUSE_BANKROLL, amount },
        ],
      });
      await recordAdminAction(tx, { ...ctx, action: 'house.funded', targetType: 'account', targetId: 'HOUSE_BANKROLL', reason, before: { balance: before }, after: { balance: before + amount, amount, transactionId: posted.id } });
      return { status: 201, body: { balance: before + amount, transactionId: posted.id } };
    }),
  );
}

// ---------------------------------------------------------------------------
// Audit, alerts, reconciliation
// ---------------------------------------------------------------------------
export async function listAudit(opts: { action?: string; actorId?: string; resourceId?: string; limit?: number; before?: number }) {
  const conds = [
    opts.action ? ilike(auditLogs.action, `${opts.action}%`) : undefined,
    opts.actorId ? eq(auditLogs.actorId, opts.actorId) : undefined,
    opts.resourceId ? eq(auditLogs.resourceId, opts.resourceId) : undefined,
    opts.before ? sql`${auditLogs.id} < ${opts.before}` : undefined,
  ].filter(Boolean) as SQL[];
  return getDb()
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorType: auditLogs.actorType,
      actorName: users.username,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      before: auditLogs.before,
      after: auditLogs.after,
      reason: auditLogs.reason,
      requestId: auditLogs.requestId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function listAlerts(opts: { includeAcknowledged?: boolean; limit?: number } = {}) {
  return getDb()
    .select()
    .from(alerts)
    .where(opts.includeAcknowledged ? undefined : sql`${alerts.acknowledgedAt} IS NULL`)
    .orderBy(desc(alerts.createdAt))
    .limit(opts.limit ?? 100);
}

export async function acknowledgeAlert(ctx: AdminCtx, alertId: number, reason: string) {
  return withTransaction(async (tx) => {
    const [alert] = await tx.select().from(alerts).where(eq(alerts.id, alertId)).for('update');
    if (!alert) throw errors.notFound('Alert');
    if (alert.acknowledgedAt) return { acknowledged: true };
    await tx.update(alerts).set({ acknowledgedAt: new Date(), acknowledgedBy: ctx.adminId }).where(eq(alerts.id, alertId));
    await recordAdminAction(tx, { ...ctx, action: 'alert.acknowledged', targetType: 'alert', targetId: String(alertId), reason, before: { acknowledged: false }, after: { acknowledged: true } });
    return { acknowledged: true };
  });
}

export async function listReconciliations(limit = 20) {
  return getDb().select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.id)).limit(limit);
}
