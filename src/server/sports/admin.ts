/**
 * Operator tools for the prediction simulator, beyond suspend / resume /
 * result / void (queries.ts):
 *   * event detail: tickets by selection, result versions, settlement history,
 *     audit trail;
 *   * settlement preview: what recording a result (or void) would credit,
 *     computed with the same rules as settlement, without changing anything;
 *   * prediction window: optional opening and early closing times;
 *   * demo fixtures: an operator can schedule an extra fictional fixture.
 *     Prices come from the published demo model and the result from a seed
 *     committed now; operators can never set odds or pick a winner.
 * Every change is audited with its reason. Results, payouts and odds are never
 * taken from the client.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { correctionCredit, settleTicket, type ResultForSettlement } from '@/engine/sports/model';
import { DEMO_COMPETITIONS } from '@/engine/sports/demo-data';
import { getDb, withTransaction } from '../db/client';
import { adminActions, sportsCompetitions, sportsEvents, sportsMarkets, sportsResultLog, sportsSelections, sportsTeams, sportsTickets, users } from '../db/schema';
import { errors } from '../errors';
import { recordAdminAction } from '../audit/audit';
import { predictionWindow, sportsConfig } from './config';
import { createDemoEvent, DEMO_SOURCE, ensureDemoCatalog } from './sync';
import type { SportsAdminCtx } from './queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const home = alias(sportsTeams, 'home');
const away = alias(sportsTeams, 'away');

export async function sportsEventAdminDetail(eventId: string) {
  if (!UUID.test(eventId)) throw errors.notFound('Event');
  const db = getDb();
  const [row] = await db
    .select({ event: sportsEvents, competition: sportsCompetitions.name, home: home.name, away: away.name, market: sportsMarkets })
    .from(sportsEvents)
    .innerJoin(sportsCompetitions, eq(sportsCompetitions.id, sportsEvents.competitionId))
    .innerJoin(home, eq(home.id, sportsEvents.homeTeamId))
    .innerJoin(away, eq(away.id, sportsEvents.awayTeamId))
    .leftJoin(sportsMarkets, eq(sportsMarkets.eventId, sportsEvents.id))
    .where(eq(sportsEvents.id, eventId));
  if (!row) throw errors.notFound('Event');
  const [selections, byPick, results, settlements, history] = await Promise.all([
    row.market ? db.select().from(sportsSelections).where(eq(sportsSelections.marketId, row.market.id)).orderBy(sportsSelections.id) : Promise.resolve([]),
    db.execute<{ code: string; status: string; n: number; stake: string; potential: string; credited: string }>(sql`
      SELECT selection_code AS code, status, count(*)::int AS n, coalesce(sum(stake), 0)::text AS stake,
             coalesce(sum(potential_return), 0)::text AS potential, coalesce(sum(payout), 0)::text AS credited
        FROM sports_tickets WHERE event_id = ${eventId} GROUP BY selection_code, status ORDER BY selection_code, status`),
    db.select().from(sportsResultLog).where(eq(sportsResultLog.eventId, eventId)).orderBy(desc(sportsResultLog.version)),
    db.execute<{ version: number; tickets: number; won: number; lost: number; voided: number; credited: string; first_at: Date; last_at: Date }>(sql`
      SELECT s.version, count(*)::int AS tickets,
             count(*) FILTER (WHERE s.outcome = 'WON')::int AS won,
             count(*) FILTER (WHERE s.outcome = 'LOST')::int AS lost,
             count(*) FILTER (WHERE s.outcome = 'VOIDED')::int AS voided,
             coalesce(sum(s.credited), 0)::text AS credited, min(s.created_at) AS first_at, max(s.created_at) AS last_at
        FROM sports_settlements s JOIN sports_tickets k ON k.id = s.ticket_id
       WHERE k.event_id = ${eventId} GROUP BY s.version ORDER BY s.version DESC`),
    db
      .select({ id: adminActions.id, createdAt: adminActions.createdAt, action: adminActions.action, reason: adminActions.reason, after: adminActions.after, adminName: users.username })
      .from(adminActions)
      .innerJoin(users, eq(users.id, adminActions.adminId))
      .where(and(eq(adminActions.targetType, 'sports_event'), eq(adminActions.targetId, eventId)))
      .orderBy(desc(adminActions.id))
      .limit(50),
  ]);
  const now = new Date();
  const lagging = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM sports_tickets
     WHERE event_id = ${eventId} AND status <> 'REJECTED' AND coalesce(settlement_version, 0) < ${row.event.resultVersion}`);
  return {
    event: row.event,
    competition: row.competition,
    home: row.home,
    away: row.away,
    market: row.market,
    window: row.market ? predictionWindow(row.market, row.event.kickoffAt, now) : null,
    selections,
    byPick: byPick.rows.map((r) => ({ code: r.code, status: r.status, count: r.n, stake: Number(r.stake), potential: Number(r.potential), credited: Number(r.credited) })),
    results,
    settlements: settlements.rows.map((r) => ({ ...r, credited: Number(r.credited) })),
    history,
    /** Tickets not yet brought up to the event's latest result version. */
    unsettled: lagging.rows[0]?.n ?? 0,
  };
}

/**
 * What recording `result` would do, using the settlement rules: per ticket the
 * new entitlement and, under the credit-only policy, the chips that would be
 * credited. Nothing is written.
 */
export async function previewSettlement(eventId: string, result: ResultForSettlement) {
  if (!UUID.test(eventId)) throw errors.notFound('Event');
  const db = getDb();
  const [ev] = await db.select().from(sportsEvents).where(eq(sportsEvents.id, eventId));
  if (!ev) throw errors.notFound('Event');
  const [latest] = await db.select().from(sportsResultLog).where(eq(sportsResultLog.eventId, eventId)).orderBy(desc(sportsResultLog.version)).limit(1);
  // Recording the current result again is a no-op (recordEventResult ignores it).
  const sameAsCurrent = Boolean(
    latest && (result.kind === 'VOID' ? latest.kind === 'VOID' : latest.kind !== 'VOID' && latest.homeScore === result.home && latest.awayScore === result.away),
  );
  const tickets = await db
    .select({ id: sportsTickets.id, selectionCode: sportsTickets.selectionCode, stake: sportsTickets.stake, potentialReturn: sportsTickets.potentialReturn, payout: sportsTickets.payout, status: sportsTickets.status })
    .from(sportsTickets)
    .where(and(eq(sportsTickets.eventId, eventId), inArray(sportsTickets.status, ['ACCEPTED', 'SUSPENDED', 'WON', 'LOST', 'VOIDED'])));
  const out = { tickets: tickets.length, won: 0, lost: 0, voided: 0, credit: 0, ticketsCredited: 0, alreadySettled: 0 };
  for (const t of tickets) {
    const s = settleTicket({ selectionCode: t.selectionCode, stake: t.stake, potentialReturn: t.potentialReturn }, result);
    out[s.outcome === 'WON' ? 'won' : s.outcome === 'LOST' ? 'lost' : 'voided'] += 1;
    if (t.status === 'WON' || t.status === 'LOST' || t.status === 'VOIDED') out.alreadySettled += 1;
    const credit = correctionCredit(t.payout ?? 0, s.entitlement);
    if (credit > 0) {
      out.credit += credit;
      out.ticketsCredited += 1;
    }
  }
  return {
    ...out,
    sameAsCurrent,
    isCorrection: ev.resultVersion > 0 && !sameAsCurrent,
    beforeKickoff: ev.kickoffAt > new Date(),
  };
}

/** Sets or clears the prediction window. The close may not be later than kick-off. */
export async function adminSetMarketWindow(ctx: SportsAdminCtx, eventId: string, window: { opensAt: Date | null; closesAt: Date | null }, reason: string) {
  if (!UUID.test(eventId)) throw errors.notFound('Event');
  return withTransaction(async (tx) => {
    const [ev] = await tx.select().from(sportsEvents).where(eq(sportsEvents.id, eventId));
    if (!ev) throw errors.notFound('Event');
    if (ev.resultVersion > 0) throw errors.conflict('This event already has a result');
    const now = new Date();
    if (ev.kickoffAt <= now) throw errors.conflict('The event has started; its market is closed');
    const [market] = await tx.select().from(sportsMarkets).where(eq(sportsMarkets.eventId, eventId)).for('update');
    if (!market) throw errors.notFound('Market');
    if (window.closesAt && window.closesAt > ev.kickoffAt) throw errors.validation('Predictions must close no later than kick-off');
    if (window.closesAt && window.closesAt <= now) throw errors.validation('The closing time must be in the future (suspend the event to stop predictions now)');
    if (window.opensAt && window.opensAt >= (window.closesAt ?? ev.kickoffAt)) throw errors.validation('Predictions must open before they close');
    // A market closed early by its window reopens if the new window is open again.
    const reopen = market.status === 'CLOSED' && market.statusReason === 'Predictions closed';
    await tx
      .update(sportsMarkets)
      .set({ opensAt: window.opensAt, closesAt: window.closesAt, ...(reopen ? { status: 'OPEN', statusReason: null } : {}), updatedAt: now })
      .where(eq(sportsMarkets.id, market.id));
    await recordAdminAction(tx, {
      ...ctx,
      action: 'sports.window',
      targetType: 'sports_event',
      targetId: eventId,
      reason,
      before: { opensAt: market.opensAt, closesAt: market.closesAt, status: market.status },
      after: { opensAt: window.opensAt, closesAt: window.closesAt, reopened: reopen },
    });
    return { opensAt: window.opensAt, closesAt: window.closesAt };
  });
}

/** Schedules an extra fictional fixture (demo mode only), priced by the published model. */
export async function adminCreateDemoFixture(ctx: SportsAdminCtx, input: { competitionId: string; homeId: string; awayId: string; kickoffAt: Date }, reason: string) {
  if (sportsConfig().mode !== 'demo') throw errors.conflict('Demo fixtures can only be created in demo mode');
  const comp = DEMO_COMPETITIONS.find((c) => c.id === input.competitionId);
  if (!comp) throw errors.validation('Unknown demo competition');
  if (!comp.teams.includes(input.homeId) || !comp.teams.includes(input.awayId)) throw errors.validation('Both teams must belong to that demo competition');
  if (input.homeId === input.awayId) throw errors.validation('A team cannot play itself');
  const now = Date.now();
  if (input.kickoffAt.getTime() < now + 15 * 60_000) throw errors.validation('Kick-off must be at least 15 minutes from now');
  if (input.kickoffAt.getTime() > now + 14 * 86_400_000) throw errors.validation('Kick-off must be within 14 days');
  await ensureDemoCatalog();
  return withTransaction(async (tx) => {
    const externalId = `demo:manual:${createHash('sha256').update(`${ctx.adminId}:${input.kickoffAt.toISOString()}:${input.homeId}:${input.awayId}`).digest('hex').slice(0, 16)}`;
    const created = await createDemoEvent(tx, { externalId, competitionId: comp.id, homeId: input.homeId, awayId: input.awayId }, input.kickoffAt, new Date());
    if (!created) throw errors.conflict('That fixture already exists');
    const [ev] = await tx.select({ id: sportsEvents.id, seedHash: sportsEvents.seedHash }).from(sportsEvents).where(and(eq(sportsEvents.source, DEMO_SOURCE), eq(sportsEvents.externalId, externalId)));
    await recordAdminAction(tx, {
      ...ctx,
      action: 'sports.demo_fixture_created',
      targetType: 'sports_event',
      targetId: ev!.id,
      reason,
      before: null,
      after: { ...input, kickoffAt: input.kickoffAt.toISOString(), seedHash: ev!.seedHash },
    });
    return { eventId: ev!.id };
  });
}
