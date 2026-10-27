/**
 * Placing predictions (virtual chips). A slip holds 1–10 single predictions;
 * each becomes its own ticket. The server prices every ticket from its own
 * current odds — the odds the client saw are only compared, to detect a price
 * change — and the whole slip is decided in one transaction:
 *
 *  1. idempotency (same key + same slip → same answer, nothing placed twice);
 *  2. account, responsible-play and balance checks under the wallet lock;
 *  3. per selection: market open, before kick-off, odds offered and (live)
 *     fresh, price unchanged unless the player accepts changes — otherwise the
 *     ticket is recorded as REJECTED with its reason and moves no money;
 *  4. platform kill switch, per-ticket and per-event limits, total exposure and
 *     house reserve under the house-bankroll lock;
 *  5. one SPORTS_STAKE ledger transaction per accepted ticket.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { potentialReturn } from '@/engine/sports/model';
import { withTransaction, getDb, type Tx } from '../db/client';
import { sportsEvents, sportsMarkets, sportsSelections, sportsTickets, users } from '../db/schema';
import { errors } from '../errors';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { metrics } from '../observability/metrics';
import { assertCanWager } from '../responsible/limits';
import { getPlatformSettings } from '../risk/risk-service';
import { SPORTS_LIMITS, sportsConfig, predictionWindow } from './config';

export const slipSchema = z
  .object({
    selections: z
      .array(
        z
          .object({
            selectionId: z.int().positive(),
            stake: z.int().min(SPORTS_LIMITS.minStake).max(SPORTS_LIMITS.maxStake),
            /** The price the player saw (×100). Used only to detect a change. */
            oddsE2: z.int().min(101).max(100_000),
          })
          .strict(),
      )
      .min(1)
      .max(SPORTS_LIMITS.maxSelectionsPerSlip)
      .refine((s) => new Set(s.map((x) => x.selectionId)).size === s.length, { message: 'Each selection can appear only once in a slip' }),
    acceptOddsChanges: z.boolean().default(false),
  })
  .strict();
export type SlipInput = z.infer<typeof slipSchema>;

export interface TicketView {
  id: string;
  slipId: string;
  eventId: string;
  selectionCode: 'HOME' | 'DRAW' | 'AWAY';
  stake: number;
  oddsE2: number;
  potentialReturn: number;
  status: string;
  rejectReason: string | null;
  payout: number | null;
  isDemo: boolean;
  placedAt: string;
  settledAt: string | null;
  settlementVersion: number | null;
  settlementSource: string | null;
}

export interface SlipResponse {
  slipId: string;
  tickets: TicketView[];
  balance: number;
}

type TicketRow = typeof sportsTickets.$inferSelect;

export function ticketView(t: TicketRow): TicketView {
  return {
    id: t.id,
    slipId: t.slipId,
    eventId: t.eventId,
    selectionCode: t.selectionCode,
    stake: t.stake,
    oddsE2: t.oddsE2,
    potentialReturn: t.potentialReturn,
    status: t.status,
    rejectReason: t.rejectReason,
    payout: t.payout,
    isDemo: t.isDemo,
    placedAt: t.placedAt.toISOString(),
    settledAt: t.settledAt?.toISOString() ?? null,
    settlementVersion: t.settlementVersion,
    settlementSource: t.settlementSource,
  };
}

const odds = (e2: number) => (e2 / 100).toFixed(2);

export async function placeSlip(input: {
  userId: string;
  idempotencyKey: string;
  slip: unknown;
  sessionStartedAt?: Date | null;
  now?: Date;
}): Promise<IdempotentResult<SlipResponse>> {
  const parsed = slipSchema.safeParse(input.slip);
  if (!parsed.success) {
    throw errors.validation('Invalid prediction slip', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const slip = parsed.data;
  const cfg = sportsConfig();
  if (cfg.mode === 'off' || cfg.misconfigured) throw errors.gameUnavailable('Sports predictions are not available right now.');

  return withTransaction((tx) =>
    runIdempotent(tx, input.userId, input.idempotencyKey, requestFingerprint('sports:slip', slip), async (respond) => {
      const now = input.now ?? new Date();
      const settings = await getPlatformSettings(tx);
      if (!settings.newRoundsEnabled) throw errors.gameUnavailable(settings.incidentMessage || 'New predictions are temporarily disabled.');

      const wallet = await lockWalletAccount(tx, input.userId);
      const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, input.userId));
      if (user?.status !== 'ACTIVE') throw errors.forbidden('This account cannot place predictions.');

      // Lock the markets involved (shared) so odds cannot change while the slip is decided.
      const ids = slip.selections.map((s) => s.selectionId);
      const rows = await tx
        .select({ selection: sportsSelections, market: sportsMarkets, event: sportsEvents })
        .from(sportsSelections)
        .innerJoin(sportsMarkets, eq(sportsMarkets.id, sportsSelections.marketId))
        .innerJoin(sportsEvents, eq(sportsEvents.id, sportsMarkets.eventId))
        .where(inArray(sportsSelections.id, ids))
        .for('share', { of: [sportsMarkets] });
      const byId = new Map(rows.map((r) => [r.selection.id, r]));

      const decisions = slip.selections.map((s) => {
        const r = byId.get(s.selectionId);
        if (!r) throw errors.notFound('Selection');
        const current = r.selection.oddsE2;
        let reason: string | null = null;
        if (r.event.isDemo !== (cfg.mode === 'demo')) reason = 'This event is not available in the current mode';
        else if (r.market.status !== 'OPEN') reason = r.market.status === 'SUSPENDED' ? 'Market suspended' : 'Market closed';
        else if (r.event.kickoffAt <= now) reason = 'The event has started';
        else if (predictionWindow(r.market, r.event.kickoffAt, now).state === 'not_open') reason = 'Predictions on this market have not opened yet';
        else if (predictionWindow(r.market, r.event.kickoffAt, now).state === 'closed') reason = 'Predictions on this market have closed';
        else if (current === null) reason = 'This selection is not offered';
        else if (!r.event.isDemo && now.getTime() - r.market.oddsUpdatedAt.getTime() > cfg.oddsMaxAgeMs) reason = 'Odds are out of date';
        else if (current !== s.oddsE2 && !slip.acceptOddsChanges) reason = `Odds changed from ${odds(s.oddsE2)} to ${odds(current)}`;
        const oddsE2 = current ?? s.oddsE2;
        return { input: s, row: r, reason, oddsE2, potential: potentialReturn(s.stake, oddsE2) };
      });

      const accepted = decisions.filter((d) => d.reason === null);
      for (const d of accepted) {
        if (d.potential > SPORTS_LIMITS.maxReturnPerTicket) {
          throw errors.risk('A prediction’s potential return exceeds the per-ticket limit; lower the stake.', {
            maxReturnPerTicket: SPORTS_LIMITS.maxReturnPerTicket,
            potentialReturn: d.potential,
          });
        }
      }
      const totalStake = accepted.reduce((a, d) => a + d.input.stake, 0);
      if (totalStake > 0) {
        await assertCanWager(tx, input.userId, totalStake, { sessionStartedAt: input.sessionStartedAt ?? null });
        if (wallet.balance < totalStake) throw errors.insufficientFunds({ balance: wallet.balance, stake: totalStake });
        await assertSportsRisk(tx, settings, wallet.balance, accepted.map((d) => ({ eventId: d.row.event.id, stake: d.input.stake, potential: d.potential })));
      }

      const slipId = randomUUID();
      const sys = await systemAccountIds(tx);
      const created: TicketRow[] = [];
      for (const [leg, d] of decisions.entries()) {
        const [ticket] = await tx
          .insert(sportsTickets)
          .values({
            userId: input.userId,
            slipId,
            idempotencyKey: input.idempotencyKey,
            leg,
            eventId: d.row.event.id,
            marketId: d.row.market.id,
            selectionId: d.row.selection.id,
            selectionCode: d.row.selection.code,
            marketVersion: d.row.market.version,
            stake: d.input.stake,
            oddsE2: d.oddsE2,
            potentialReturn: d.potential,
            status: d.reason ? 'REJECTED' : 'ACCEPTED',
            rejectReason: d.reason,
            isDemo: d.row.event.isDemo,
            placedAt: now,
            updatedAt: now,
          })
          .returning();
        if (!d.reason) {
          await postTransaction(tx, {
            type: 'SPORTS_STAKE',
            idempotencyKey: `sports:${ticket!.id}:stake`,
            userId: input.userId,
            sportsTicketId: ticket!.id,
            description: 'Sports prediction placed',
            postings: [
              { accountId: wallet.id, amount: -d.input.stake, memo: 'stake' },
              { accountId: sys.SPORTS_IN_PLAY, amount: d.input.stake, memo: 'stake held' },
            ],
            metadata: { eventId: d.row.event.id, selection: d.row.selection.code, oddsE2: d.oddsE2 },
          });
        }
        created.push(ticket!);
        metrics.inc('casino_sports_tickets_total', { status: d.reason ? 'rejected' : 'accepted' });
      }
      const body: SlipResponse = { slipId, tickets: created.map(ticketView), balance: wallet.balance - totalStake };
      await respond(201, body);
      return { status: 201, body };
    }),
  );
}

/**
 * Risk for a slip, decided before any result exists and under the house lock:
 * total and per-event liability caps, the house reserve and the player
 * balance cap. Liability = potential return − stake.
 */
async function assertSportsRisk(
  tx: Tx,
  settings: Awaited<ReturnType<typeof getPlatformSettings>>,
  playerBalance: number,
  legs: { eventId: string; stake: number; potential: number }[],
): Promise<void> {
  const added = legs.reduce((a, l) => a + (l.potential - l.stake), 0);
  const stakes = legs.reduce((a, l) => a + l.stake, 0);
  const returns = legs.reduce((a, l) => a + l.potential, 0);
  let snap: { house_balance: string; exposure_total: string } | undefined;
  const byEvent = new Map<string, number>();
  for (const l of legs) byEvent.set(l.eventId, (byEvent.get(l.eventId) ?? 0) + (l.potential - l.stake));
  for (const [eventId, eventAdded] of byEvent) {
    const res = await tx.execute<{ house_balance: string; exposure_event: string; exposure_total: string }>(
      sql`SELECT house_balance, exposure_event, exposure_total FROM sports_risk_snapshot(${eventId}::uuid)`,
    );
    const row = res.rows[0]!;
    snap = row;
    if (Number(row.exposure_event) + eventAdded > SPORTS_LIMITS.maxEventLiability) {
      throw errors.risk('This event has reached its prediction limit; try a smaller stake.', { maxEventLiability: SPORTS_LIMITS.maxEventLiability });
    }
  }
  const house = Number(snap!.house_balance);
  const total = Number(snap!.exposure_total);
  if (total + added > settings.maxTotalExposure) {
    throw errors.risk('The platform has reached its exposure limit; try again shortly.', { maxTotalExposure: settings.maxTotalExposure });
  }
  if (house - total - added < settings.minHouseReserve) {
    throw errors.risk('The operator reserve cannot cover this prediction right now.', { minHouseReserve: settings.minHouseReserve });
  }
  if (playerBalance - stakes + returns > settings.maxPlayerBalance) {
    throw errors.risk('This slip could take your balance above the maximum virtual balance.', { maxPlayerBalance: settings.maxPlayerBalance });
  }
}

export async function listTickets(userId: string, opts: { status?: 'open' | 'settled' | 'all'; before?: Date; limit?: number } = {}): Promise<TicketView[]> {
  const statuses =
    opts.status === 'open' ? (['ACCEPTED', 'SUSPENDED'] as const) : opts.status === 'settled' ? (['WON', 'LOST', 'VOIDED', 'REJECTED'] as const) : null;
  const rows = await getDb()
    .select()
    .from(sportsTickets)
    .where(
      and(
        eq(sportsTickets.userId, userId),
        statuses ? inArray(sportsTickets.status, [...statuses]) : undefined,
        opts.before ? lt(sportsTickets.placedAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(sportsTickets.placedAt), desc(sportsTickets.leg))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(ticketView);
}

export interface SportsStats {
  tickets: number;
  open: number;
  won: number;
  lost: number;
  voided: number;
  rejected: number;
  /** Stakes of accepted tickets (turnover — not a gain). */
  staked: number;
  /** Everything credited back: returns, void refunds and corrections. */
  returned: number;
  /** returned − staked over settled tickets. */
  net: number;
}

export async function sportsStats(userId: string): Promise<SportsStats> {
  const res = await getDb().execute<{
    tickets: number;
    open: number;
    won: number;
    lost: number;
    voided: number;
    rejected: number;
    staked: string;
    returned: string;
    settled_staked: string;
  }>(sql`
    SELECT count(*)::int AS tickets,
           count(*) FILTER (WHERE status IN ('ACCEPTED', 'SUSPENDED'))::int AS open,
           count(*) FILTER (WHERE status = 'WON')::int AS won,
           count(*) FILTER (WHERE status = 'LOST')::int AS lost,
           count(*) FILTER (WHERE status = 'VOIDED')::int AS voided,
           count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
           coalesce(sum(stake) FILTER (WHERE status <> 'REJECTED'), 0)::text AS staked,
           coalesce(sum(payout), 0)::text AS returned,
           coalesce(sum(stake) FILTER (WHERE status IN ('WON', 'LOST', 'VOIDED')), 0)::text AS settled_staked
    FROM sports_tickets WHERE user_id = ${userId}`);
  const r = res.rows[0]!;
  return {
    tickets: r.tickets,
    open: r.open,
    won: r.won,
    lost: r.lost,
    voided: r.voided,
    rejected: r.rejected,
    staked: Number(r.staked),
    returned: Number(r.returned),
    net: Number(r.returned) - Number(r.settled_staked),
  };
}

