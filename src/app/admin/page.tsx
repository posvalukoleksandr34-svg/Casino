import Link from 'next/link';
import { DailyBars } from '@/components/admin/charts';
import { PeriodFilter } from '@/components/admin/period-filter';
import { GAME_NAMES } from '@/components/account/labels';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { overviewMetrics } from '@/server/admin/overview';
import { resolvePeriod } from '@/server/admin/period';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Dashboard' };

function utc(d: Date | string) {
  return `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  // Every admin page checks for itself: layouts are not guaranteed to run for every page request.
  const session = await requirePermission('admin:access');
  const sp = await searchParams;
  let periodError: string | null = null;
  let period;
  try {
    period = resolvePeriod(sp);
  } catch (err) {
    periodError = err instanceof AppError ? err.message : 'Invalid period';
    period = resolvePeriod({ period: '7d' });
  }
  const m = await overviewMetrics(period);
  const canUsers = hasPermission(session.role, 'users:read');
  const canRounds = hasPermission(session.role, 'rounds:read');
  const pending = [
    m.system.openAlerts > 0 && { href: '/admin/alerts', text: `${m.system.openAlerts} unacknowledged alert${m.system.openAlerts === 1 ? '' : 's'}` },
    m.system.overdueRounds > 0 && { href: '/admin/rounds?status=OPEN', text: `${m.system.overdueRounds} time-decided round${m.system.overdueRounds === 1 ? '' : 's'} overdue for settlement` },
    m.system.laggingTickets > 0 && { href: '/admin/sports', text: `${m.system.laggingTickets} sports prediction${m.system.laggingTickets === 1 ? '' : 's'} behind their event's result` },
    m.system.lastReconciliation && m.system.lastReconciliation.status !== 'OK' && { href: '/admin/reconciliation', text: `Last reconciliation: ${m.system.lastReconciliation.status.toLowerCase()}` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={session.role === 'OWNER' ? 'Owner dashboard' : 'Operations dashboard'}
        subtitle="Every figure is computed from recorded accounts, rounds, predictions and ledger entries. Chips are virtual and have no monetary value: “house net” is chip movement, not revenue or profit."
      />
      <PeriodFilter basePath="/admin" params={sp} period={period} />
      {periodError && (
        <Callout tone="warning" className="mb-6" title="Showing the last 7 days instead">
          {periodError}
        </Callout>
      )}
      {!m.system.newRoundsEnabled && (
        <Callout tone="warning" title="New rounds are disabled platform-wide" className="mb-6">
          {m.system.incidentMessage ?? 'Kill switch engaged.'} <Link href="/admin/risk" className="text-gold-400">Platform controls →</Link>
        </Callout>
      )}

      <section aria-labelledby="kpi-players" className="space-y-3">
        <h2 id="kpi-players" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
          Players
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Registered accounts" value={m.users.registered.toLocaleString()} sub={`${m.users.suspended} suspended · ${m.users.staff} staff`} />
          <Stat label="New accounts" value={m.users.newAccounts.toLocaleString()} sub={period.label} />
          <Stat label="Active players" value={m.users.activePlayers.toLocaleString()} sub="Started a round or placed a prediction" />
          <Stat label="Recently active" value={m.users.recentlyActive.toLocaleString()} sub="Signed-in requests in the last 5 minutes" />
        </div>
      </section>

      <section aria-labelledby="kpi-chips" className="mt-8 space-y-3">
        <h2 id="kpi-chips" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
          Virtual chips · {period.label}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Game rounds settled" value={m.casino.rounds.toLocaleString()} sub={`${m.sports.placed.toLocaleString()} predictions placed`} />
          <Stat label="Chips wagered" value={<Chips amount={m.totals.wagered} compact />} sub={<>Casino <Chips amount={m.casino.stake} compact suffix={false} /> · sports <Chips amount={m.sports.stake} compact suffix={false} /></>} />
          <Stat label="Chips paid out" value={<Chips amount={m.totals.paidOut} compact />} sub={<>Casino <Chips amount={m.casino.payout} compact suffix={false} /> · sports <Chips amount={m.sports.returned} compact suffix={false} /></>} />
          <Stat
            label="House net (virtual)"
            value={<Chips amount={m.totals.houseNet} sign colored compact />}
            sub="Wagered − paid out; not money"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Bonuses issued" value={<Chips amount={m.issued.bonuses} compact />} sub="Sign-up and daily chips" />
          <Stat label="Test chips granted" value={<Chips amount={m.issued.grants} compact />} sub={`${m.issued.grantCount} owner grant${m.issued.grantCount === 1 ? '' : 's'}`} />
          <Stat label="Corrections (net)" value={<Chips amount={m.issued.correctionsNet} sign compact />} sub={`${m.issued.correctionCount} compensating correction${m.issued.correctionCount === 1 ? '' : 's'}`} />
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="New accounts per day" subtitle="UTC days" />
          <CardBody>
            <DailyBars points={m.daily.map((d) => ({ day: d.day, value: d.registrations }))} kind="count" label="New accounts per day" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Chips wagered per day" subtitle="Casino rounds settled + predictions placed, UTC days" />
          <CardBody>
            <DailyBars points={m.daily.map((d) => ({ day: d.day, value: d.wagered }))} kind="chips" label="Chips wagered per day" />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Most played games" subtitle="Rounds started in the period" actions={<Link href="/admin/games" className="text-xs text-gold-400">Games →</Link>} />
          <CardBody>
            {m.topGames.length === 0 ? (
              <EmptyState title="No rounds in this period" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Game</Th>
                    <Th className="text-right">Rounds</Th>
                    <Th className="text-right">Players</Th>
                    <Th className="text-right">Wagered</Th>
                  </tr>
                </thead>
                <tbody>
                  {m.topGames.map((g) => (
                    <Tr key={g.gameId}>
                      <Td>
                        <Link href={`/admin/games/${g.gameId}`} className="text-ink-100 hover:text-gold-300">
                          {GAME_NAMES[g.gameId] ?? g.gameId}
                        </Link>
                      </Td>
                      <Td className="num text-right">{g.rounds.toLocaleString()}</Td>
                      <Td className="num text-right">{g.players.toLocaleString()}</Td>
                      <Td className="text-right">
                        <Chips amount={g.stake} compact suffix={false} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="System health" actions={hasPermission(session.role, 'system:read') ? <Link href="/admin/health" className="text-xs text-gold-400">Details →</Link> : undefined} />
          <CardBody className="space-y-3 text-sm">
            <Row label="Last reconciliation">
              {m.system.lastReconciliation ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink-400">{utc(m.system.lastReconciliation.startedAt)}</span>
                  <StatusBadge status={m.system.lastReconciliation.status} />
                </span>
              ) : (
                <span className="text-ink-400">never run</span>
              )}
            </Row>
            <Row label="Server errors (1 h / 24 h)">
              <span className="num text-ink-100">
                {m.system.errorsHour} / {m.system.errorsDay}
              </span>
            </Row>
            <Row label="House bankroll">
              <Chips amount={m.system.houseBalance} compact />
            </Row>
            <Row label="Headroom above reserve (after open exposure)">
              <Chips amount={m.system.headroom} compact className={m.system.headroom < 0 ? 'text-negative' : undefined} />
            </Row>
            <div className="border-t border-ink-800 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Needs attention</div>
              {pending.length === 0 ? (
                <p className="text-ink-400">Nothing pending.</p>
              ) : (
                <ul className="space-y-1.5">
                  {pending.map((p) => (
                    <li key={p.text}>
                      <Link href={p.href} className="text-warning hover:underline">
                        {p.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent registrations" actions={canUsers ? <Link href="/admin/users" className="text-xs text-gold-400">All users →</Link> : undefined} />
          <CardBody>
            {m.recentUsers.length === 0 ? (
              <EmptyState title="No accounts yet" />
            ) : (
              <ul className="divide-y divide-ink-800 text-sm">
                {m.recentUsers.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                    {canUsers ? (
                      <Link href={`/admin/users/${u.id}`} className="truncate text-ink-100 hover:text-gold-300">
                        {u.display_name ?? u.username}
                      </Link>
                    ) : (
                      <span className="truncate text-ink-100">{u.display_name ?? u.username}</span>
                    )}
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-ink-400">{utc(u.created_at)}</span>
                      {u.status !== 'ACTIVE' && <StatusBadge status={u.status} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent game activity" subtitle="Latest settled rounds" actions={canRounds ? <Link href="/admin/rounds" className="text-xs text-gold-400">All rounds →</Link> : undefined} />
          <CardBody>
            {m.recentRounds.length === 0 ? (
              <EmptyState title="No settled rounds yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Game</Th>
                    <Th>Player</Th>
                    <Th className="text-right">Stake</Th>
                    <Th className="text-right">Paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {m.recentRounds.map((r) => (
                    <Tr key={r.id}>
                      <Td>{canRounds ? <Link href={`/admin/rounds/${r.id}`} className="hover:text-gold-300">{GAME_NAMES[r.game_id] ?? r.game_id}</Link> : GAME_NAMES[r.game_id] ?? r.game_id}</Td>
                      <Td className="max-w-32 truncate text-ink-300">{r.username}</Td>
                      <Td className="text-right">
                        <Chips amount={r.stake} suffix={false} />
                      </Td>
                      <Td className="text-right">
                        <Chips amount={r.payout} suffix={false} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {m.system.alerts.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Unacknowledged alerts" actions={<Link href="/admin/alerts" className="text-xs text-gold-400">Review →</Link>} />
          <CardBody>
            <ul className="divide-y divide-ink-800 text-sm">
              {m.system.alerts.map((al) => (
                <li key={al.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-ink-200">{al.message}</span>
                  <StatusBadge status={al.severity} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-300">{label}</span>
      {children}
    </div>
  );
}
