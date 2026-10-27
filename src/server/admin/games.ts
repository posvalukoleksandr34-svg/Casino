/**
 * Per-game back-office view: status, limits, configuration and its history,
 * activity for a period, recent and stuck rounds. Read-only; changes go
 * through admin-service (status, limits, configuration), each audited.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { getGameModule } from '@/engine/games/registry';
import { getDb } from '../db/client';
import { auditLogs, gameConfigurations, games, riskLimits, users } from '../db/schema';
import { errors } from '../errors';
import { canonicalJson } from '../crypto';
import { gameMetrics } from '../analytics/analytics';
import { isGameId } from '@/engine/games/types';
import { CATALOG, HARD_LIMITS } from '../games/catalog';
import { listRounds } from '../games/round-service';
import type { Period } from './overview';

export async function gameDetail(gameId: string, period: Period) {
  if (!isGameId(gameId) || !CATALOG[gameId]) throw errors.notFound('Game');
  const db = getDb();
  const mod = getGameModule(gameId);
  const [row] = await db.select({ game: games, limits: riskLimits }).from(games).innerJoin(riskLimits, eq(riskLimits.gameId, games.id)).where(eq(games.id, gameId));
  if (!row) throw errors.notFound('Game');
  const [versions, history, open, metrics, recentRounds, started] = await Promise.all([
    db
      .select({ id: gameConfigurations.id, version: gameConfigurations.version, isActive: gameConfigurations.isActive, config: gameConfigurations.config, createdAt: gameConfigurations.createdAt, createdBy: users.username })
      .from(gameConfigurations)
      .leftJoin(users, eq(users.id, gameConfigurations.createdBy))
      .where(eq(gameConfigurations.gameId, gameId))
      .orderBy(desc(gameConfigurations.version)),
    db
      .select({ id: auditLogs.id, createdAt: auditLogs.createdAt, action: auditLogs.action, reason: auditLogs.reason, before: auditLogs.before, after: auditLogs.after, actorName: users.username, actorRole: auditLogs.actorRole })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.resourceType, 'game'), eq(auditLogs.resourceId, gameId)))
      .orderBy(desc(auditLogs.id))
      .limit(30),
    db.execute<{ open: number; overdue: number; oldest: Date | null }>(sql`
      SELECT count(*)::int AS open,
             count(*) FILTER (WHERE expires_at < now() - interval '5 minutes')::int AS overdue,
             min(started_at) AS oldest
        FROM game_rounds WHERE game_id = ${gameId} AND status = 'OPEN'`),
    gameMetrics(period),
    listRounds({ gameId, limit: 15 }),
    db.execute<{ rounds: number; players: number }>(sql`
      SELECT count(*)::int AS rounds, count(DISTINCT user_id)::int AS players
        FROM game_rounds WHERE game_id = ${gameId} AND started_at >= ${period.from} AND started_at < ${period.to}`),
  ]);
  const active = versions.find((v) => v.isActive) ?? null;
  const reference = mod.configSchema.parse(mod.defaultConfig);
  const overdueRounds = open.rows[0]?.overdue
    ? (
        await db.execute<{ id: string; user_id: string; started_at: Date; expires_at: Date; expiry_attempts: number }>(sql`
          SELECT id, user_id, started_at, expires_at, expiry_attempts FROM game_rounds
           WHERE game_id = ${gameId} AND status = 'OPEN' AND expires_at < now() - interval '5 minutes'
           ORDER BY expires_at LIMIT 20`)
      ).rows
    : [];
  return {
    game: row.game,
    entry: CATALOG[gameId]!,
    limits: row.limits,
    hardLimits: HARD_LIMITS,
    activeConfig: active,
    referenceConfig: reference,
    matchesReference: active ? canonicalJson(active.config) === canonicalJson(reference) : false,
    theoretical: active ? mod.theoretical(mod.configSchema.parse(active.config)) : null,
    versions,
    history,
    open: { count: open.rows[0]?.open ?? 0, overdue: open.rows[0]?.overdue ?? 0, oldest: open.rows[0]?.oldest ?? null },
    overdueRounds,
    period: { ...period, startedRounds: started.rows[0]?.rounds ?? 0, players: started.rows[0]?.players ?? 0, metrics: metrics.find((m) => m.gameId === gameId) ?? null },
    recentRounds,
  };
}
