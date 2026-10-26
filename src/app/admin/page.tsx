import Link from 'next/link';
import { Meter } from '@/components/admin/charts';
import { GAME_NAMES } from '@/components/account/labels';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { overview } from '@/server/admin/admin-service';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Overview' };

export default async function AdminOverviewPage() {
  // Every admin page checks for itself: layouts are not guaranteed to run for every page request.
  await requirePermission('admin:access');
  const o = await overview();
  const a = o.allTime;
  const d = o.last24h;
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Operations overview"
        subtitle="All figures come from recorded rounds and ledger balances. Theoretical values are derived from the documented game rules for the bets actually placed; no simulated data appears on this page."
      />
      {!o.platform.newRoundsEnabled && (
        <Callout tone="warning" title="New rounds are disabled platform-wide" className="mb-6">
          {o.platform.incidentMessage ?? 'Kill switch engaged.'} <Link href="/admin/risk" className="text-gold-400">Platform controls →</Link>
        </Callout>
      )}
      <section aria-labelledby="kpi" className="space-y-4">
        <h2 id="kpi" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
          Players & volume
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Registered users" value={o.users?.registered.toLocaleString() ?? '0'} sub={`${o.users?.suspended ?? 0} suspended`} />
          <Stat label="Active players" value={o.users?.active_24h.toLocaleString() ?? '0'} sub={`${o.users?.active_7d ?? 0} in the last 7 days`} />
          <Stat label="Completed rounds" value={a.rounds.toLocaleString()} sub={`${d.rounds.toLocaleString()} in the last 24 h`} />
          <Stat label="Total wagered" value={<Chips amount={a.stake} compact />} sub={<>24 h: <Chips amount={d.stake} suffix={false} /></>} />
        </div>
        <h2 className="pt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">Revenue (virtual)</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total payouts" value={<Chips amount={a.payout} compact />} />
          <Stat label="Actual GGR" value={<Chips amount={a.ggr} sign colored />} sub={<>Margin <Pct value={a.stake ? a.ggr / a.stake : null} /></>} />
          <Stat label="Theoretical GGR" value={<Chips amount={Math.round(a.theoreticalGgr)} sign />} sub={<>Margin <Pct value={a.stake ? a.theoreticalGgr / a.stake : null} /></>} />
          <Stat
            label="Actual vs theory"
            value={a.zScore === null ? '—' : `${a.zScore >= 0 ? '+' : ''}${a.zScore.toFixed(2)}σ`}
            sub={a.zScore === null ? 'No data' : `Players ${a.zScore > 0 ? 'above' : 'below'} expectation; p = ${a.pValue?.toFixed(3)}`}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Promotional cost" value={<Chips amount={a.bonusCost} compact />} sub="Virtual bonuses granted" />
          <Stat label="NGR" value={<Chips amount={a.ngr} sign colored compact />} sub="GGR − promotional cost" />
          <Stat label="GGR std. deviation" value={<Chips amount={Math.round(a.ggrStdDev)} />} sub="Expected spread around theory" />
          <Stat label="24 h actual GGR" value={<Chips amount={d.ggr} sign colored />} sub={<>Theory <Chips amount={Math.round(d.theoreticalGgr)} suffix={false} /></>} />
        </div>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Reserves & exposure" subtitle="Exposure = Σ (max payout − stake) over open rounds" />
          <CardBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label="House bankroll" value={<Chips amount={o.reserves.houseBalance} compact />} />
              <Stat label="Headroom above reserve" value={<Chips amount={o.reserves.availableHeadroom} compact />} tone={o.reserves.availableHeadroom < 0 ? 'negative' : undefined} />
              <Stat label="Wagers in play (escrow)" value={<Chips amount={o.reserves.wagersInPlay} compact />} />
              <Stat label="Open net exposure" value={<Chips amount={o.reserves.openNetExposure} compact />} />
            </div>
            <Meter label="Platform exposure vs limit" value={o.reserves.openNetExposure} limit={o.reserves.maxTotalExposure} />
            {o.exposureByGame.map((e) => (
              <Meter key={e.gameId} label={`${GAME_NAMES[e.gameId] ?? e.gameId} · ${e.openRounds} open`} value={e.netExposure} limit={e.limit} />
            ))}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Game availability" actions={<Link href="/admin/games" className="text-xs text-gold-400">Manage →</Link>} />
            <CardBody>
              <ul className="divide-y divide-ink-800">
                {o.games.map((g) => (
                  <li key={g.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink-100">{g.name}</span>
                    <span className="flex items-center gap-2">
                      {g.statusReason && <span className="max-w-48 truncate text-xs text-ink-400">{g.statusReason}</span>}
                      <StatusBadge status={g.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Integrity & errors" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-300">Last reconciliation</span>
                <span className="flex items-center gap-2">
                  {o.lastReconciliation ? (
                    <>
                      <span className="text-xs text-ink-400">{o.lastReconciliation.startedAt.toLocaleString()}</span>
                      <StatusBadge status={o.lastReconciliation.status} />
                    </>
                  ) : (
                    <span className="text-ink-400">never run</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-300">Server errors (1 h / 24 h)</span>
                <span className="num text-ink-100">
                  {o.errors.last_hour} / {o.errors.last_day}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-300">Open alerts</span>
                <Link href="/admin/alerts" className="num text-gold-300">
                  {o.openAlerts.length}
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Unacknowledged alerts" subtitle="Statistical deviations are judged against sampling variance (z-scores), not raw amounts." />
        <CardBody>
          {o.openAlerts.length === 0 ? (
            <p className="text-sm text-ink-400">No open alerts.</p>
          ) : (
            <ul className="divide-y divide-ink-800 text-sm">
              {o.openAlerts.map((al) => (
                <li key={al.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-ink-200">{al.message}</span>
                  <StatusBadge status={al.severity} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
