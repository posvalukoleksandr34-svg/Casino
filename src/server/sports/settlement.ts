/**
 * Sports results and settlement.
 *
 *  * `recordEventResult` stores a result, void or correction as a new,
 *    append-only result version (repeating the current result is a no-op).
 *  * `settleTicket` brings one ticket up to its event's latest version in its
 *    own transaction (wallet lock first, then the ticket row):
 *      first settlement   escrow −stake; house +stake −entitlement; wallet +entitlement
 *                         (void: escrow −stake; wallet +stake) — ledger key
 *                         `sports:<ticket>:release`, so a stake is released
 *                         (and a void refunded) at most once;
 *      later versions     credit-only correction: wallet +(entitlement − credited
 *                         so far) when positive, from the house; never a debit.
 *    The settlement record is unique per (ticket, version), so re-running a
 *    settlement is harmless.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { correctionCredit, settleTicket as ticketOutcome, type Outcome, type ResultForSettlement } from '@/engine/sports/model';
import { getDb, withTransaction, type Tx } from '../db/client';
import { sportsEvents, sportsMarkets, sportsResultLog, sportsSettlements, sportsTickets } from '../db/schema';
import { errors } from '../errors';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction, type Posting } from '../ledger/ledger';
import { metrics } from '../observability/metrics';

export type ResultInput = { kind: 'RESULT'; home: number; away: number } | { kind: 'VOID' };

export interface ResultMeta {
  source: string;
  reason: string;
  actorId?: string | null;
  /** Demo events: the committed seed, revealed with the result. */
  revealSeed?: string | null;
}

/** Records a new result version for an event. Returns the event's current version and whether it changed. */
export async function recordEventResult(eventId: string, result: ResultInput, meta: ResultMeta, tx?: Tx): Promise<{ version: number; changed: boolean }> {
  const run = async (t: Tx) => {
    const [ev] = await t.select().from(sportsEvents).where(eq(sportsEvents.id, eventId)).for('update');
    if (!ev) throw errors.notFound('Event');
    if (result.kind === 'RESULT' && (!Number.isInteger(result.home) || !Number.isInteger(result.away) || result.home < 0 || result.away < 0 || result.home > 99 || result.away > 99)) {
      throw errors.validation('Scores must be whole numbers between 0 and 99');
    }
    const same =
      ev.resultVersion > 0 &&
      (result.kind === 'VOID' ? ev.status === 'CANCELLED' && ev.homeScore === null : ev.status === 'FINISHED' && ev.homeScore === result.home && ev.awayScore === result.away);
    if (same) return { version: ev.resultVersion, changed: false };
    const version = ev.resultVersion + 1;
    const kind = result.kind === 'VOID' ? 'VOID' : ev.resultVersion > 0 ? 'CORRECTION' : 'RESULT';
    const home = result.kind === 'RESULT' ? result.home : null;
    const away = result.kind === 'RESULT' ? result.away : null;
    const now = new Date();
    await t.insert(sportsResultLog).values({ eventId, version, kind, homeScore: home, awayScore: away, reason: meta.reason, source: meta.source, actorId: meta.actorId ?? null });
    await t
      .update(sportsEvents)
      .set({
        status: result.kind === 'VOID' ? 'CANCELLED' : 'FINISHED',
        homeScore: home,
        awayScore: away,
        resultVersion: version,
        resultSource: meta.source,
        resultAt: now,
        revealedSeed: meta.revealSeed ?? ev.revealedSeed,
        updatedAt: now,
      })
      .where(eq(sportsEvents.id, eventId));
    await t
      .update(sportsMarkets)
      .set({ status: result.kind === 'VOID' ? 'VOIDED' : 'SETTLED', statusReason: meta.reason, updatedAt: now })
      .where(eq(sportsMarkets.eventId, eventId));
    metrics.inc('casino_sports_results_total', { kind });
    return { version, changed: true };
  };
  return tx ? run(tx) : withTransaction(run);
}

/** Brings one ticket up to its event's latest result version. Returns true when something was settled. */
export async function settleTicket(ticketId: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [peek] = await tx.select({ userId: sportsTickets.userId }).from(sportsTickets).where(eq(sportsTickets.id, ticketId));
    if (!peek) throw errors.notFound('Ticket');
    // Same lock order as a wager: the player's wallet, then the ticket.
    const wallet = await lockWalletAccount(tx, peek.userId);
    const [t] = await tx.select().from(sportsTickets).where(eq(sportsTickets.id, ticketId)).for('update');
    const [ev] = await tx.select().from(sportsEvents).where(eq(sportsEvents.id, t!.eventId));
    if (!t || !ev || t.status === 'REJECTED' || ev.resultVersion <= (t.settlementVersion ?? 0)) return false;
    const [log] = await tx
      .select()
      .from(sportsResultLog)
      .where(and(eq(sportsResultLog.eventId, ev.id), eq(sportsResultLog.version, ev.resultVersion)));
    if (!log) throw new Error(`result version ${ev.resultVersion} of event ${ev.id} is missing`);
    const result: ResultForSettlement = log.kind === 'VOID' ? { kind: 'VOID' } : { kind: 'RESULT', home: log.homeScore!, away: log.awayScore! };
    const { outcome, entitlement } = ticketOutcome({ selectionCode: t.selectionCode as Outcome, stake: t.stake, potentialReturn: t.potentialReturn }, result);
    const first = t.status === 'ACCEPTED' || t.status === 'SUSPENDED';
    const credited = first ? entitlement : correctionCredit(t.payout ?? 0, entitlement);
    const ids = await systemAccountIds(tx);
    let ledgerTransactionId: number | null = null;
    if (first) {
      const postings: Posting[] =
        outcome === 'VOIDED'
          ? [
              { accountId: ids.SPORTS_IN_PLAY, amount: -t.stake, memo: 'release stake' },
              { accountId: wallet.id, amount: t.stake, memo: 'stake refunded' },
            ]
          : [
              { accountId: ids.SPORTS_IN_PLAY, amount: -t.stake, memo: 'release stake' },
              { accountId: ids.HOUSE_BANKROLL, amount: t.stake, memo: 'stake collected' },
              { accountId: ids.HOUSE_BANKROLL, amount: -entitlement, memo: 'return funded' },
              { accountId: wallet.id, amount: entitlement, memo: 'return' },
            ];
      const posted = await postTransaction(tx, {
        type: outcome === 'VOIDED' ? 'SPORTS_VOIDED' : 'SPORTS_SETTLED',
        idempotencyKey: `sports:${t.id}:release`,
        userId: t.userId,
        sportsTicketId: t.id,
        description: outcome === 'VOIDED' ? 'Sports prediction voided — stake returned' : outcome === 'WON' ? 'Sports prediction won' : 'Sports prediction settled',
        postings,
        metadata: { eventId: ev.id, version: ev.resultVersion, outcome, stake: t.stake, entitlement },
      });
      ledgerTransactionId = posted.id;
    } else if (credited > 0) {
      const posted = await postTransaction(tx, {
        type: 'SPORTS_CORRECTION',
        idempotencyKey: `sports:${t.id}:v${ev.resultVersion}`,
        userId: t.userId,
        sportsTicketId: t.id,
        description: 'Sports result corrected — difference credited',
        postings: [
          { accountId: ids.HOUSE_BANKROLL, amount: -credited, memo: 'correction funded' },
          { accountId: wallet.id, amount: credited, memo: 'correction credit' },
        ],
        metadata: { eventId: ev.id, version: ev.resultVersion, outcome, entitlement, creditedBefore: t.payout },
      });
      ledgerTransactionId = posted.id;
    }
    const now = new Date();
    await tx.insert(sportsSettlements).values({ ticketId: t.id, version: ev.resultVersion, outcome, entitlement, credited, ledgerTransactionId, source: log.source });
    await tx
      .update(sportsTickets)
      .set({
        status: outcome,
        payout: (t.payout ?? 0) + credited,
        settlementVersion: ev.resultVersion,
        settlementSource: log.source,
        settledAt: t.settledAt ?? now,
        updatedAt: now,
      })
      .where(eq(sportsTickets.id, t.id));
    metrics.inc('casino_sports_settlements_total', { outcome, kind: first ? 'first' : 'correction' });
    return true;
  });
}

/** Settles every ticket of an event that is behind the event's result version. */
export async function settleEventTickets(eventId: string): Promise<number> {
  const pending = await getDb()
    .select({ id: sportsTickets.id })
    .from(sportsTickets)
    .innerJoin(sportsEvents, eq(sportsEvents.id, sportsTickets.eventId))
    .where(and(eq(sportsTickets.eventId, eventId), ne(sportsTickets.status, 'REJECTED'), sql`coalesce(${sportsTickets.settlementVersion}, 0) < ${sportsEvents.resultVersion}`));
  let n = 0;
  for (const p of pending) if (await settleTicket(p.id)) n += 1;
  return n;
}

/** Catch-up: settles tickets on any event whose result is ahead of them (e.g. after a crash mid-settlement). */
export async function settleOutstanding(limit = 50): Promise<number> {
  const events = await getDb()
    .selectDistinct({ id: sportsEvents.id })
    .from(sportsTickets)
    .innerJoin(sportsEvents, eq(sportsEvents.id, sportsTickets.eventId))
    .where(and(ne(sportsTickets.status, 'REJECTED'), sql`coalesce(${sportsTickets.settlementVersion}, 0) < ${sportsEvents.resultVersion}`))
    .limit(limit);
  let n = 0;
  for (const e of events) n += await settleEventTickets(e.id);
  return n;
}

/**
 * Suspends (or resumes) an event: its open market stops (or restarts) taking
 * predictions and its accepted tickets show as suspended (or accepted again).
 * No money moves.
 */
export async function setEventSuspended(eventId: string, suspended: boolean, reason: string, tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    const now = new Date();
    const [ev] = await t.select().from(sportsEvents).where(eq(sportsEvents.id, eventId)).for('update');
    if (!ev) throw errors.notFound('Event');
    if (ev.resultVersion > 0) return; // results are final for this purpose; corrections go through recordEventResult
    await t
      .update(sportsEvents)
      .set({ status: suspended ? (ev.status === 'POSTPONED' ? 'POSTPONED' : 'SUSPENDED') : 'SCHEDULED', updatedAt: now })
      .where(eq(sportsEvents.id, eventId));
    await t
      .update(sportsMarkets)
      .set({ status: suspended ? 'SUSPENDED' : 'OPEN', statusReason: suspended ? reason : null, updatedAt: now })
      .where(and(eq(sportsMarkets.eventId, eventId), inArray(sportsMarkets.status, suspended ? ['OPEN'] : ['SUSPENDED'])));
    await t
      .update(sportsTickets)
      .set({ status: suspended ? 'SUSPENDED' : 'ACCEPTED', updatedAt: now })
      .where(and(eq(sportsTickets.eventId, eventId), eq(sportsTickets.status, suspended ? 'ACCEPTED' : 'SUSPENDED')));
  };
  return tx ? run(tx) : withTransaction(run);
}

/** Closes markets whose event has kicked off (pre-match only). */
export async function closeStartedMarkets(now = new Date()): Promise<number> {
  const res = await getDb().execute(sql`
    UPDATE sports_markets m SET status = 'CLOSED', status_reason = 'Kicked off', updated_at = ${now}
    FROM sports_events e
    WHERE e.id = m.event_id AND m.status IN ('OPEN', 'SUSPENDED') AND e.kickoff_at <= ${now} AND e.result_version = 0`);
  await getDb().execute(sql`
    UPDATE sports_events SET status = 'LIVE', updated_at = ${now}
    WHERE status = 'SCHEDULED' AND kickoff_at <= ${now} AND result_version = 0`);
  return res.rowCount ?? 0;
}

/** Most recent result versions of an event (for the audit trail shown to players and operators). */
export async function resultHistory(eventId: string) {
  return getDb().select().from(sportsResultLog).where(eq(sportsResultLog.eventId, eventId)).orderBy(desc(sportsResultLog.version));
}

