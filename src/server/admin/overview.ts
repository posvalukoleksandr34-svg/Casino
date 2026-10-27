/**
 * Owner dashboard metrics for a reporting period (UTC, half-open [from, to);
 * see period.ts). Every figure is an aggregate query over recorded rows —
 * nothing is loaded row by row into memory and nothing is simulated.
 *
 * Definitions (also shown on the page):
 *   registered      accounts not deleted
 *   new accounts    accounts created in the period
 *   active players  distinct accounts that started a round or placed an accepted
 *                   prediction in the period
 *   recently active distinct accounts with a session request in the last
 *                   5 minutes (sessions record activity at most once a minute)
 *   wagered         casino stakes of rounds settled in the period + stakes of
 *                   predictions placed in the period (rejected ones excluded)
 *   paid out        casino payouts of rounds settled in the period + credits of
 *                   predictions settled in the period (incl. void refunds)
 *   house net       wagered − paid out: virtual chips that moved to the house.
 *                   Chips have no monetary value; this is not revenue or profit.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getPlatformSettings, openExposure } from '../risk/risk-service';
import { accountBalance, systemAccountIds } from '../ledger/accounts';

export interface Period {
  from: Date;
  to: Date;
}

const num = (v: unknown) => Number(v ?? 0);

export async function overviewMetrics(p: Period) {
  const db = getDb();
  const [users, active, recent, casino, sports, issued, byGame, daily, recentUsers, recentRounds, system] = await Promise.all([
    db.execute<{ registered: number; new_accounts: number; suspended: number; staff: number }>(sql`
      SELECT count(*) FILTER (WHERE status <> 'DELETED')::int AS registered,
             count(*) FILTER (WHERE created_at >= ${p.from} AND created_at < ${p.to})::int AS new_accounts,
             count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
             count(*) FILTER (WHERE role <> 'PLAYER' AND status = 'ACTIVE')::int AS staff
        FROM users`),
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (
        SELECT user_id FROM game_rounds WHERE started_at >= ${p.from} AND started_at < ${p.to}
        UNION
        SELECT user_id FROM sports_tickets WHERE placed_at >= ${p.from} AND placed_at < ${p.to} AND status <> 'REJECTED'
      ) a`),
    db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT user_id)::int AS n FROM sessions
       WHERE revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - interval '5 minutes'`),
    db.execute<{ rounds: number; stake: string; payout: string; voided: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'SETTLED')::int AS rounds,
             coalesce(sum(stake_total) FILTER (WHERE status = 'SETTLED'), 0)::text AS stake,
             coalesce(sum(payout_total) FILTER (WHERE status = 'SETTLED'), 0)::text AS payout,
             count(*) FILTER (WHERE status = 'VOIDED')::int AS voided
        FROM game_rounds WHERE settled_at >= ${p.from} AND settled_at < ${p.to}`),
    db.execute<{ placed: number; stake: string; settled: number; returned: string }>(sql`
      SELECT (SELECT count(*) FROM sports_tickets WHERE placed_at >= ${p.from} AND placed_at < ${p.to} AND status <> 'REJECTED')::int AS placed,
             (SELECT coalesce(sum(stake), 0) FROM sports_tickets WHERE placed_at >= ${p.from} AND placed_at < ${p.to} AND status <> 'REJECTED')::text AS stake,
             (SELECT count(DISTINCT ticket_id) FROM sports_settlements WHERE created_at >= ${p.from} AND created_at < ${p.to})::int AS settled,
             (SELECT coalesce(sum(credited), 0) FROM sports_settlements WHERE created_at >= ${p.from} AND created_at < ${p.to})::text AS returned`),
    db.execute<{ type: string; amount: string; n: number }>(sql`
      SELECT t.type, coalesce(sum(e.amount), 0)::text AS amount, count(DISTINCT t.id)::int AS n
        FROM ledger_transactions t
        JOIN ledger_entries e ON e.transaction_id = t.id
        JOIN ledger_accounts a ON a.id = e.account_id AND a.type = 'PLAYER_WALLET'
       WHERE t.type IN ('BONUS_GRANTED', 'CHIP_GRANT', 'ADJUSTMENT') AND t.created_at >= ${p.from} AND t.created_at < ${p.to}
       GROUP BY t.type`),
    db.execute<{ game_id: string; rounds: number; stake: string; players: number }>(sql`
      SELECT game_id, count(*)::int AS rounds, coalesce(sum(stake_total), 0)::text AS stake, count(DISTINCT user_id)::int AS players
        FROM game_rounds WHERE started_at >= ${p.from} AND started_at < ${p.to}
       GROUP BY game_id ORDER BY rounds DESC, game_id LIMIT 12`),
    db.execute<{ day: string; registrations: number; wagered: string }>(sql`
      WITH days AS (
        SELECT generate_series(date_trunc('day', ${p.from}::timestamptz AT TIME ZONE 'UTC'),
                               date_trunc('day', (${p.to}::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC'),
                               interval '1 day') AS d
      ),
      reg AS (
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS d, count(*) AS n FROM users
         WHERE created_at >= ${p.from} AND created_at < ${p.to} GROUP BY 1
      ),
      wag AS (
        SELECT d, sum(s) AS s FROM (
          SELECT date_trunc('day', settled_at AT TIME ZONE 'UTC') AS d, sum(stake_total) AS s FROM game_rounds
           WHERE status = 'SETTLED' AND settled_at >= ${p.from} AND settled_at < ${p.to} GROUP BY 1
          UNION ALL
          SELECT date_trunc('day', placed_at AT TIME ZONE 'UTC') AS d, sum(stake) AS s FROM sports_tickets
           WHERE status <> 'REJECTED' AND placed_at >= ${p.from} AND placed_at < ${p.to} GROUP BY 1
        ) x GROUP BY d
      )
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, coalesce(reg.n, 0)::int AS registrations, coalesce(wag.s, 0)::text AS wagered
        FROM days LEFT JOIN reg ON reg.d = days.d LEFT JOIN wag ON wag.d = days.d
       ORDER BY days.d`),
    db.execute<{ id: string; username: string; display_name: string | null; created_at: Date; status: string }>(sql`
      SELECT id, username, display_name, created_at, status FROM users WHERE status <> 'DELETED' ORDER BY created_at DESC LIMIT 8`),
    db.execute<{ id: string; game_id: string; username: string; user_id: string; stake_total: string; payout_total: string; settled_at: Date }>(sql`
      SELECT r.id, r.game_id, u.username, r.user_id, r.stake_total::text, r.payout_total::text, r.settled_at
        FROM game_rounds r JOIN users u ON u.id = r.user_id
       WHERE r.status = 'SETTLED' ORDER BY r.settled_at DESC LIMIT 10`),
    db.execute<{ errors_hour: number; errors_day: number; open_alerts: number; overdue_rounds: number; lagging_tickets: number }>(sql`
      SELECT (SELECT count(*) FROM error_events WHERE created_at > now() - interval '1 hour')::int AS errors_hour,
             (SELECT count(*) FROM error_events WHERE created_at > now() - interval '1 day')::int AS errors_day,
             (SELECT count(*) FROM alerts WHERE acknowledged_at IS NULL)::int AS open_alerts,
             (SELECT count(*) FROM game_rounds WHERE status = 'OPEN' AND expires_at < now() - interval '5 minutes')::int AS overdue_rounds,
             (SELECT count(*) FROM sports_tickets k JOIN sports_events e ON e.id = k.event_id
               WHERE k.status <> 'REJECTED' AND coalesce(k.settlement_version, 0) < e.result_version
                 AND e.result_at < now() - interval '10 minutes')::int AS lagging_tickets`),
  ]);
  const u = users.rows[0]!;
  const c = casino.rows[0]!;
  const s = sports.rows[0]!;
  const sys = system.rows[0]!;
  const issuedBy = (t: string) => issued.rows.find((r) => r.type === t);
  const wagered = num(c.stake) + num(s.stake);
  const paidOut = num(c.payout) + num(s.returned);

  const settings = await getPlatformSettings(db);
  const ids = await systemAccountIds(db);
  const house = await accountBalance(db, ids.HOUSE_BANKROLL);
  const exposure = await openExposure(db);
  const [lastRecon] = (await db.execute<{ id: number; status: string; started_at: Date; mismatch_count: number }>(sql`
    SELECT id, status, started_at, mismatch_count FROM reconciliation_runs ORDER BY id DESC LIMIT 1`)).rows;
  const openAlerts = (await db.execute<{ id: number; severity: string; message: string; created_at: Date }>(sql`
    SELECT id, severity, message, created_at FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 5`)).rows;

  return {
    period: p,
    users: { registered: u.registered, newAccounts: u.new_accounts, suspended: u.suspended, staff: u.staff, activePlayers: active.rows[0]?.n ?? 0, recentlyActive: recent.rows[0]?.n ?? 0 },
    casino: { rounds: c.rounds, stake: num(c.stake), payout: num(c.payout), voided: c.voided },
    sports: { placed: s.placed, stake: num(s.stake), settled: s.settled, returned: num(s.returned) },
    totals: { wagered, paidOut, houseNet: wagered - paidOut },
    issued: {
      bonuses: num(issuedBy('BONUS_GRANTED')?.amount),
      grants: num(issuedBy('CHIP_GRANT')?.amount),
      grantCount: issuedBy('CHIP_GRANT')?.n ?? 0,
      correctionsNet: num(issuedBy('ADJUSTMENT')?.amount),
      correctionCount: issuedBy('ADJUSTMENT')?.n ?? 0,
    },
    topGames: byGame.rows.map((g) => ({ gameId: g.game_id, rounds: g.rounds, stake: num(g.stake), players: g.players })),
    daily: daily.rows.map((d) => ({ day: d.day, registrations: d.registrations, wagered: num(d.wagered) })),
    recentUsers: recentUsers.rows,
    recentRounds: recentRounds.rows.map((r) => ({ ...r, stake: num(r.stake_total), payout: num(r.payout_total) })),
    system: {
      errorsHour: sys.errors_hour,
      errorsDay: sys.errors_day,
      openAlerts: sys.open_alerts,
      overdueRounds: sys.overdue_rounds,
      laggingTickets: sys.lagging_tickets,
      newRoundsEnabled: settings.newRoundsEnabled,
      incidentMessage: settings.incidentMessage,
      houseBalance: house,
      openExposure: exposure,
      headroom: house - exposure - settings.minHouseReserve,
      lastReconciliation: lastRecon ? { id: lastRecon.id, status: lastRecon.status, startedAt: lastRecon.started_at, mismatches: lastRecon.mismatch_count } : null,
      alerts: openAlerts,
    },
  };
}
