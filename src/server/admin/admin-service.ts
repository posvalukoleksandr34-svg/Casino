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
  gameRounds,
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
import { canonicalJson } from '../crypto';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { HARD_LIMITS, requireGameId } from '../games/catalog';
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

/**
 * ACTIVE: open. SUSPENDED ("maintenance"): no new rounds; open rounds can be
 * finished. DISABLED: as suspended and hidden from the lobby. Pausing a game
 * that has open rounds needs explicit confirmation (`confirmOpenRounds`).
 */
export async function setGameStatus(
  ctx: AdminCtx,
  gameId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED',
  reason: string,
  opts: { confirmOpenRounds?: boolean } = {},
) {
  const id = requireGameId(gameId);
  return withTransaction(async (tx) => {
    const [before] = await tx.select({ status: games.status, statusReason: games.statusReason }).from(games).where(eq(games.id, id)).for('update');
    if (!before) throw errors.notFound('Game');
    if (before.status === status) throw errors.conflict(`The game is already ${status.toLowerCase()}`);
    const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(gameRounds).where(and(eq(gameRounds.gameId, id), eq(gameRounds.status, 'OPEN')));
    const openRounds = open?.n ?? 0;
    if (status !== 'ACTIVE' && openRounds > 0 && !opts.confirmOpenRounds) {
      throw errors.conflict(`${openRounds} round${openRounds === 1 ? ' is' : 's are'} still open. Confirm to continue: players can finish them, but cannot start new ones.`, { openRounds, needsConfirmation: true });
    }
    await tx
      .update(games)
      .set({ status, statusReason: status === 'ACTIVE' ? null : reason, updatedAt: new Date() })
      .where(eq(games.id, id));
    await recordAdminAction(tx, { ...ctx, action: 'game.status', targetType: 'game', targetId: id, reason, before, after: { status, openRoundsAtChange: openRounds } });
    return { status, openRounds };
  });
}

/**
 * Publishes a new immutable configuration version. Only the game's published
 * reference configuration (engine defaultConfig, from which the player-facing
 * rules, payout tables and RTP are generated and tested) is accepted, so an
 * administrator can restore it but never activate maths players were not
 * shown. Rounds keep a reference to the version they were played under.
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
  if (canonicalJson(parsed.data) !== canonicalJson(mod.configSchema.parse(mod.defaultConfig))) {
    throw errors.validation(
      'Only the published reference configuration can be activated: the rules, payout tables and RTP shown to players are generated from it. Changing game mathematics needs a code change that updates the published rules and their tests.',
      { reference: mod.defaultConfig },
    );
  }
  return withTransaction(async (tx) => {
    const current = await tx.select().from(gameConfigurations).where(eq(gameConfigurations.gameId, id)).orderBy(desc(gameConfigurations.version)).for('update');
    const active = current.find((c) => c.isActive);
    if (active && canonicalJson(active.config) === canonicalJson(parsed.data)) throw errors.conflict('The reference configuration is already active');
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

/** Checks limits against HARD_LIMITS and the platform exposure cap; returns problems (empty = valid). */
export function limitProblems(l: z.infer<typeof riskLimitsSchema>, platformMaxExposure: number): string[] {
  const p: string[] = [];
  if (l.minStake < HARD_LIMITS.minStakeFloor) p.push('The minimum stake must be at least 0.01 chip');
  if (l.maxStake < l.minStake) p.push('The maximum stake must not be below the minimum stake');
  if (l.maxStake > HARD_LIMITS.maxStakeCeiling) p.push(`The maximum stake cannot exceed ${(HARD_LIMITS.maxStakeCeiling / 100).toLocaleString('en-US')} chips`);
  if (l.maxPayoutPerRound < l.maxStake) p.push('The maximum payout per round must be at least the maximum stake');
  if (l.maxPayoutPerRound > HARD_LIMITS.maxPayoutCeiling) p.push(`The maximum payout per round cannot exceed ${(HARD_LIMITS.maxPayoutCeiling / 100).toLocaleString('en-US')} chips`);
  if (l.maxGameExposure < l.maxPayoutPerRound) p.push('The game exposure limit must be at least the maximum payout per round');
  if (l.maxGameExposure > platformMaxExposure) p.push('The game exposure limit cannot exceed the platform exposure limit');
  return p;
}

export async function updateRiskLimits(ctx: AdminCtx, gameId: string, limits: z.infer<typeof riskLimitsSchema>, reason: string) {
  const id = requireGameId(gameId);
  return withTransaction(async (tx) => {
    const settings = await getPlatformSettings(tx);
    const problems = limitProblems(limits, settings.maxTotalExposure);
    if (problems.length) throw errors.validation(problems[0]!, { problems });
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
export interface AuditQuery {
  /** Action prefix, e.g. "user." or "auth.login". */
  action?: string;
  actorId?: string;
  /** Exact username of the actor (resolved to an id). */
  actorName?: string;
  resourceId?: string;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
  from?: Date;
  to?: Date;
  /** Keyset pagination: entries with id below this. */
  before?: number;
  limit?: number;
}

/** Audit entries newest first. Bounded (≤ 500 per page) and keyset-paginated. */
export async function listAudit(opts: AuditQuery) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const prefix = opts.action ? `${opts.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  const conds = [
    prefix ? ilike(auditLogs.action, prefix) : undefined,
    opts.actorId ? eq(auditLogs.actorId, opts.actorId) : undefined,
    opts.actorName ? sql`${auditLogs.actorId} = (SELECT id FROM users WHERE lower(username) = lower(${opts.actorName}))` : undefined,
    opts.resourceId ? eq(auditLogs.resourceId, opts.resourceId) : undefined,
    opts.outcome ? eq(auditLogs.outcome, opts.outcome) : undefined,
    opts.from ? sql`${auditLogs.createdAt} >= ${opts.from}` : undefined,
    opts.to ? sql`${auditLogs.createdAt} < ${opts.to}` : undefined,
    opts.before ? sql`${auditLogs.id} < ${opts.before}` : undefined,
  ].filter(Boolean) as SQL[];
  const rows = await getDb()
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorType: auditLogs.actorType,
      actorRole: auditLogs.actorRole,
      actorName: users.username,
      action: auditLogs.action,
      outcome: auditLogs.outcome,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      before: auditLogs.before,
      after: auditLogs.after,
      reason: auditLogs.reason,
      requestId: auditLogs.requestId,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(limit + 1);
  return { items: rows.slice(0, limit), nextBefore: rows.length > limit ? rows[limit - 1]!.id : null };
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
