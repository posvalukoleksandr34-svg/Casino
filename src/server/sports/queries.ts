/**
 * Sports read models (events with markets and odds, provenance labels and the
 * demo fairness data), player favourites, provider health and audited
 * operator actions.
 */
import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { ScoreModel } from '@/engine/sports/model';
import { recordAdminAction } from '../audit/audit';
import { getDb, withTransaction } from '../db/client';
import {
  sportsCompetitions,
  sportsEvents,
  sportsMarkets,
  sportsProviderStatus,
  sportsResultLog,
  sportsSelections,
  sportsTeams,
  userSportsFavorites,
} from '../db/schema';
import { errors } from '../errors';
import { sportsConfig } from './config';
import { recordEventResult, setEventSuspended, settleEventTickets } from './settlement';

const homeTeam = alias(sportsTeams, 'home_team');
const awayTeam = alias(sportsTeams, 'away_team');

export interface EventSelection {
  id: number;
  code: 'HOME' | 'DRAW' | 'AWAY';
  oddsE2: number | null;
}

export interface EventView {
  id: string;
  isDemo: boolean;
  source: string;
  competition: { id: string; name: string; country: string | null };
  home: { id: string; name: string; shortName: string | null };
  away: { id: string; name: string; shortName: string | null };
  kickoffAt: string;
  status: string;
  score: { home: number; away: number } | null;
  resultVersion: number;
  resultSource: string | null;
  market: {
    id: number;
    status: string;
    statusReason: string | null;
    version: number;
    oddsSource: string;
    oddsUpdatedAt: string;
    /** Live odds older than the freshness limit (predictions paused). */
    stale: boolean;
    selections: EventSelection[];
  } | null;
  fairness: { seedHash: string; revealedSeed: string | null; model: ScoreModel | null } | null;
  /** Open for predictions right now. */
  open: boolean;
}

function toView(
  r: {
    event: typeof sportsEvents.$inferSelect;
    competition: typeof sportsCompetitions.$inferSelect;
    home: typeof sportsTeams.$inferSelect;
    away: typeof sportsTeams.$inferSelect;
    market: typeof sportsMarkets.$inferSelect | null;
  },
  selections: EventSelection[],
  now: Date,
  withModel: boolean,
): EventView {
  const cfg = sportsConfig();
  const stale = Boolean(r.market && !r.event.isDemo && now.getTime() - r.market.oddsUpdatedAt.getTime() > cfg.oddsMaxAgeMs);
  const open = Boolean(r.market && r.market.status === 'OPEN' && r.event.kickoffAt > now && !stale && r.event.resultVersion === 0);
  return {
    id: r.event.id,
    isDemo: r.event.isDemo,
    source: r.event.source,
    competition: { id: r.competition.id, name: r.competition.name, country: r.competition.country },
    home: { id: r.home.id, name: r.home.name, shortName: r.home.shortName },
    away: { id: r.away.id, name: r.away.name, shortName: r.away.shortName },
    kickoffAt: r.event.kickoffAt.toISOString(),
    status: r.event.status,
    score: r.event.homeScore === null || r.event.awayScore === null ? null : { home: r.event.homeScore, away: r.event.awayScore },
    resultVersion: r.event.resultVersion,
    resultSource: r.event.resultSource,
    market: r.market
      ? {
          id: r.market.id,
          status: r.market.status,
          statusReason: r.market.statusReason,
          version: r.market.version,
          oddsSource: r.market.oddsSource,
          oddsUpdatedAt: r.market.oddsUpdatedAt.toISOString(),
          stale,
          selections,
        }
      : null,
    fairness: r.event.isDemo
      ? { seedHash: r.event.seedHash!, revealedSeed: r.event.revealedSeed, model: withModel ? (r.event.model as unknown as ScoreModel) : null }
      : null,
    open,
  };
}

async function selectEvents(where: ReturnType<typeof and>, limit: number, order: 'asc' | 'desc') {
  const rows = await getDb()
    .select({ event: sportsEvents, competition: sportsCompetitions, home: homeTeam, away: awayTeam, market: sportsMarkets })
    .from(sportsEvents)
    .innerJoin(sportsCompetitions, eq(sportsCompetitions.id, sportsEvents.competitionId))
    .innerJoin(homeTeam, eq(homeTeam.id, sportsEvents.homeTeamId))
    .innerJoin(awayTeam, eq(awayTeam.id, sportsEvents.awayTeamId))
    .leftJoin(sportsMarkets, and(eq(sportsMarkets.eventId, sportsEvents.id), eq(sportsMarkets.type, '1X2')))
    .where(where)
    .orderBy(order === 'asc' ? asc(sportsEvents.kickoffAt) : desc(sportsEvents.kickoffAt))
    .limit(limit);
  const marketIds = rows.map((r) => r.market?.id).filter((x): x is number => typeof x === 'number');
  const sels = marketIds.length ? await getDb().select().from(sportsSelections).where(inArray(sportsSelections.marketId, marketIds)) : [];
  const order3 = { HOME: 0, DRAW: 1, AWAY: 2 } as const;
  const byMarket = new Map<number, EventSelection[]>();
  for (const s of sels.sort((a, b) => order3[a.code] - order3[b.code])) {
    byMarket.set(s.marketId, [...(byMarket.get(s.marketId) ?? []), { id: s.id, code: s.code, oddsE2: s.oddsE2 }]);
  }
  return rows.map((r) => ({ row: r, selections: r.market ? (byMarket.get(r.market.id) ?? []) : [] }));
}

/** Upcoming (and just-started) events plus recent results, for the current mode only. */
export async function listEvents(opts: { now?: Date; upcomingLimit?: number; recentLimit?: number } = {}): Promise<{ upcoming: EventView[]; recent: EventView[] }> {
  const now = opts.now ?? new Date();
  const cfg = sportsConfig();
  if (cfg.mode === 'off' || cfg.misconfigured) return { upcoming: [], recent: [] };
  const demo = cfg.mode === 'demo';
  const upcoming = await selectEvents(
    and(eq(sportsEvents.isDemo, demo), eq(sportsEvents.resultVersion, 0), gte(sportsEvents.kickoffAt, new Date(now.getTime() - 3 * 3_600_000))),
    opts.upcomingLimit ?? 60,
    'asc',
  );
  const recent = await selectEvents(
    and(eq(sportsEvents.isDemo, demo), or(eq(sportsEvents.status, 'FINISHED'), eq(sportsEvents.status, 'CANCELLED')), lte(sportsEvents.kickoffAt, now)),
    opts.recentLimit ?? 20,
    'desc',
  );
  return {
    upcoming: upcoming.map((e) => toView(e.row, e.selections, now, false)),
    recent: recent.map((e) => toView(e.row, e.selections, now, false)),
  };
}

export async function getEvent(id: string, now = new Date()): Promise<EventView & { results: { version: number; kind: string; home: number | null; away: number | null; reason: string; source: string; at: string }[] }> {
  if (!z.uuid().safeParse(id).success) throw errors.notFound('Event');
  const [row] = await selectEvents(and(eq(sportsEvents.id, id)), 1, 'asc');
  if (!row) throw errors.notFound('Event');
  const results = await getDb().select().from(sportsResultLog).where(eq(sportsResultLog.eventId, id)).orderBy(desc(sportsResultLog.version));
  return {
    ...toView(row.row, row.selections, now, true),
    results: results.map((r) => ({ version: r.version, kind: r.kind, home: r.homeScore, away: r.awayScore, reason: r.reason, source: r.source, at: r.createdAt.toISOString() })),
  };
}

// --- favourites -------------------------------------------------------------

export const favoriteKind = z.enum(['team', 'competition']);

export async function listSportsFavorites(userId: string): Promise<{ teams: string[]; competitions: string[] }> {
  const rows = await getDb().select().from(userSportsFavorites).where(eq(userSportsFavorites.userId, userId)).orderBy(asc(userSportsFavorites.createdAt));
  return { teams: rows.filter((r) => r.kind === 'team').map((r) => r.refId), competitions: rows.filter((r) => r.kind === 'competition').map((r) => r.refId) };
}

export async function setSportsFavorite(userId: string, kindRaw: string, refId: string, on: boolean) {
  const kind = favoriteKind.safeParse(kindRaw);
  if (!kind.success || !/^[a-z0-9:_-]{1,80}$/i.test(refId)) throw errors.notFound('Favourite');
  const table = kind.data === 'team' ? sportsTeams : sportsCompetitions;
  const [exists] = await getDb().select({ id: table.id }).from(table).where(eq(table.id, refId));
  if (!exists) throw errors.notFound(kind.data === 'team' ? 'Team' : 'Competition');
  if (on) await getDb().insert(userSportsFavorites).values({ userId, kind: kind.data, refId }).onConflictDoNothing();
  else await getDb().delete(userSportsFavorites).where(and(eq(userSportsFavorites.userId, userId), eq(userSportsFavorites.kind, kind.data), eq(userSportsFavorites.refId, refId)));
  return listSportsFavorites(userId);
}

// --- operators ----------------------------------------------------------------

export async function providerHealth() {
  return getDb().select().from(sportsProviderStatus).orderBy(asc(sportsProviderStatus.provider));
}

export interface SportsAdminCtx {
  adminId: string;
  ipHash?: string | null;
  requestId?: string | null;
}

/** Records a corrected result (new version) and settles affected tickets under the credit-only policy. */
export async function adminCorrectResult(ctx: SportsAdminCtx, eventId: string, home: number, away: number, reason: string) {
  const res = await withTransaction(async (tx) => {
    const [before] = await tx.select({ home: sportsEvents.homeScore, away: sportsEvents.awayScore, version: sportsEvents.resultVersion, kickoffAt: sportsEvents.kickoffAt }).from(sportsEvents).where(eq(sportsEvents.id, eventId));
    if (!before) throw errors.notFound('Event');
    if (before.kickoffAt > new Date()) throw errors.conflict('An event cannot have a result before kick-off');
    const r = await recordEventResult(eventId, { kind: 'RESULT', home, away }, { source: 'operator', reason, actorId: ctx.adminId }, tx);
    if (r.changed) {
      await recordAdminAction(tx, { ...ctx, action: 'sports.result', targetType: 'sports_event', targetId: eventId, reason, before, after: { home, away, version: r.version } });
    }
    return r;
  });
  const settled = res.changed ? await settleEventTickets(eventId) : 0;
  return { ...res, settled };
}

export async function adminVoidEvent(ctx: SportsAdminCtx, eventId: string, reason: string) {
  const res = await withTransaction(async (tx) => {
    const [before] = await tx.select({ status: sportsEvents.status, version: sportsEvents.resultVersion }).from(sportsEvents).where(eq(sportsEvents.id, eventId));
    if (!before) throw errors.notFound('Event');
    const r = await recordEventResult(eventId, { kind: 'VOID' }, { source: 'operator', reason, actorId: ctx.adminId }, tx);
    if (r.changed) await recordAdminAction(tx, { ...ctx, action: 'sports.void', targetType: 'sports_event', targetId: eventId, reason, before, after: { version: r.version } });
    return r;
  });
  const settled = res.changed ? await settleEventTickets(eventId) : 0;
  return { ...res, settled };
}

export async function adminSuspendEvent(ctx: SportsAdminCtx, eventId: string, suspended: boolean, reason: string) {
  return withTransaction(async (tx) => {
    const [before] = await tx.select({ status: sportsEvents.status, resultVersion: sportsEvents.resultVersion }).from(sportsEvents).where(eq(sportsEvents.id, eventId));
    if (!before) throw errors.notFound('Event');
    if (before.resultVersion > 0) throw errors.conflict('This event already has a result');
    await setEventSuspended(eventId, suspended, reason, tx);
    await recordAdminAction(tx, { ...ctx, action: suspended ? 'sports.suspend' : 'sports.resume', targetType: 'sports_event', targetId: eventId, reason, before, after: { suspended } });
    return { suspended };
  });
}
