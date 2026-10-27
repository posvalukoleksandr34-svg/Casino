import Link from 'next/link';
import { DailyGgrChart, RtpDeviationChart, type DailyPoint } from '@/components/admin/charts';
import { GAME_NAMES } from '@/components/account/labels';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { dailySeries, platformSummary } from '@/server/analytics/analytics';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Analytics' };

const PERIODS = [
  { key: '1', label: '24 hours' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All time' },
];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; game?: string }> }) {
  await requirePermission('analytics:read');
  const sp = await searchParams;
  const period = PERIODS.find((p) => p.key === sp.days) ?? PERIODS[2]!;
  const days = period.key === 'all' ? null : Number(period.key);
  const from = days ? new Date(Date.now() - days * 86400_000) : undefined;
  const [summary, series] = await Promise.all([platformSummary({ from }), dailySeries(days ?? 365, sp.game || undefined)]);

  const byDay = new Map<string, DailyPoint>();
  for (const p of series) {
    const cur = byDay.get(p.day) ?? { day: p.day, actual: 0, theory: 0, rounds: 0 };
    cur.actual += p.stake - p.payout;
    cur.theory += p.stake - p.expectedPayout;
    cur.rounds += p.rounds;
    byDay.set(p.day, cur);
  }
  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((p) => ({ ...p, theory: Math.round(p.theory) }));
  const games = summary.games;

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Actual vs theoretical performance"
        subtitle="Realised results from recorded rounds, compared with the expectation implied by the documented rules for the exact bets placed. Deviations are measured in standard deviations of their own sampling variance."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/admin/analytics?days=${p.key}${sp.game ? `&game=${sp.game}` : ''}`}
            aria-current={p.key === period.key ? 'true' : undefined}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm',
              p.key === period.key ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500',
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rounds" value={summary.rounds.toLocaleString()} />
        <Stat label="Wagered" value={<Chips amount={summary.stake} />} />
        <Stat label="House net (actual)" value={<Chips amount={summary.ggr} sign colored />} sub={<>Theoretical <Chips amount={Math.round(summary.theoreticalGgr)} suffix={false} /></>} />
        <Stat
          label="Deviation from theory"
          value={summary.zScore === null ? '—' : `${summary.zScore >= 0 ? '+' : ''}${summary.zScore.toFixed(2)}σ`}
          sub={summary.pValue === null ? 'Not enough data' : `two-sided p = ${summary.pValue.toFixed(3)}`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Daily house net chips" subtitle={`Last ${days ?? 365} days${sp.game ? ` · ${GAME_NAMES[sp.game] ?? sp.game}` : ' · all games'} · chips`} />
        <CardBody>
          <DailyGgrChart points={daily} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="RTP by game" subtitle={`${period.label}. Dots outside their band are worth investigating; inside is ordinary variance.`} />
        <CardBody>
          <RtpDeviationChart
            rows={games.map((g) => ({
              gameId: g.gameId,
              label: GAME_NAMES[g.gameId] ?? g.gameId,
              actual: g.actualRtp,
              theory: g.theoreticalRtp,
              ci: g.rtpCi95,
              z: g.zScore,
              rounds: g.rounds,
            }))}
          />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Per-game detail" subtitle={period.label} />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th className="text-right">Rounds</Th>
                <Th className="text-right">Stakes</Th>
                <Th className="text-right">Payouts</Th>
                <Th className="text-right">House net</Th>
                <Th className="text-right">Expected net</Th>
                <Th className="text-right">Actual RTP</Th>
                <Th className="text-right">Theo. RTP</Th>
                <Th className="text-right">95% band</Th>
                <Th className="text-right">z</Th>
                <Th className="text-right" title="Standard deviation of net result per unit staked">SD / round</Th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <Tr key={g.gameId}>
                  <Td className="font-medium text-ink-100">
                    <Link href={`/admin/analytics?days=${period.key}&game=${g.gameId}`} className="hover:text-gold-300">
                      {GAME_NAMES[g.gameId] ?? g.gameId}
                    </Link>
                  </Td>
                  <Td className="num text-right">{g.rounds.toLocaleString()}</Td>
                  <Td className="text-right"><Chips amount={g.stake} suffix={false} /></Td>
                  <Td className="text-right"><Chips amount={g.payout} suffix={false} /></Td>
                  <Td className="text-right"><Chips amount={g.ggr} sign colored suffix={false} /></Td>
                  <Td className="text-right"><Chips amount={Math.round(g.theoreticalGgr)} suffix={false} /></Td>
                  <Td className="text-right"><Pct value={g.actualRtp} /></Td>
                  <Td className="text-right"><Pct value={g.theoreticalRtp} /></Td>
                  <Td className="num text-right text-xs text-ink-400">
                    {g.rtpCi95 ? `${(g.rtpCi95[0] * 100).toFixed(1)}–${(g.rtpCi95[1] * 100).toFixed(1)}%` : '—'}
                  </Td>
                  <Td className={cn('num text-right', g.zScore !== null && Math.abs(g.zScore) >= 3 && 'text-warning')}>{g.zScore === null ? '—' : g.zScore.toFixed(2)}</Td>
                  <Td className="num text-right">{g.roundStdDev === null ? '—' : g.roundStdDev.toFixed(2)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Outcome distribution" subtitle="Settled rounds by gross return relative to stake" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th className="text-right">Lost all</Th>
                <Th className="text-right">Partial return</Th>
                <Th className="text-right">Push</Th>
                <Th className="text-right">≤ 2×</Th>
                <Th className="text-right">2–10×</Th>
                <Th className="text-right">10–100×</Th>
                <Th className="text-right">&gt; 100×</Th>
                <Th className="text-right">Max multiple</Th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <Tr key={g.gameId}>
                  <Td className="font-medium text-ink-100">{GAME_NAMES[g.gameId] ?? g.gameId}</Td>
                  {[g.distribution.lost, g.distribution.partial, g.distribution.push, g.distribution.upTo2x, g.distribution.upTo10x, g.distribution.upTo100x, g.distribution.above100x].map((n, i) => (
                    <Td key={i} className="num text-right">
                      {n.toLocaleString()} <span className="text-xs text-ink-400">({((n / Math.max(1, g.rounds)) * 100).toFixed(1)}%)</span>
                    </Td>
                  ))}
                  <Td className="num text-right">{g.maxMultiplier.toFixed(2)}×</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Method: for each settled round the server stores the theoretical expected payout E and variance V of the wager under the documented rules (computed exactly for roulette and dice).
        Expected house net = Σ stake − Σ E (virtual chips, not revenue); z = (Σ payout − Σ E) / √Σ V. Bonus chips issued are shown separately. Passing these checks is
        consistent with correct operation but does not prove it.
      </p>
    </>
  );
}
