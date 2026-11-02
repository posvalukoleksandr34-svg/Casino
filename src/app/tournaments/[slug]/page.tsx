import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JoinTournament } from '@/components/tournaments/join-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { pageSession } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { tournamentDetail } from '@/server/tournaments/tournaments';

export const metadata = { title: 'Tournament' };

const score = (s: number) => `${(s / 100).toFixed(2)}×`;

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) notFound();
  const session = await pageSession();
  const d = await tournamentDetail(slug, session?.userId ?? null).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const t = d.tournament;
  const open = t.phase === 'RUNNING' || t.phase === 'UPCOMING';
  return (
    <>
      <PageHeader eyebrow={<Link href="/tournaments" className="hover:text-gold-300">Tournaments</Link>} title={t.name} subtitle={t.description} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Rules" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ['Ranking', t.metricLabel],
                    ['Games', t.games.length ? t.games.map((g) => g.name).join(', ') : 'Every casino game'],
                    ['Rounds that count', <>Settled after you join, with a stake of at least <Chips key="m" amount={t.minStake} /></>],
                    ['Window', `${new Date(t.startsAt).toLocaleString()} – ${new Date(t.endsAt).toLocaleString()}`],
                    ['Who may join', t.minVipLevel > 1 ? `VIP level ${t.minVipLevel} and above` : 'Every player'],
                    ['Ties', 'Whoever reached the score first ranks higher'],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-white/[0.06] pb-2 last:border-0">
                    <dt className="text-ink-400">{k}</dt>
                    <dd className="text-right text-ink-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Prizes" subtitle="Credited as rewards you claim on the Rewards page (no wagering)." />
            <CardBody>
              <ol className="space-y-1.5 text-sm" data-testid="prizes">
                {t.prizes.map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-ink-300">Place {i + 1}</span>
                    <Chips amount={p} />
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          {session ? (
            d.me?.joined ? (
              <Callout tone="positive" title="You are in" role="status">
                Joined {new Date(d.me.joinedAt!).toLocaleString()}. Play the listed games; rounds from now on count.
              </Callout>
            ) : open ? (
              d.me?.blocker ? (
                <Callout tone="warning">{d.me.blocker}</Callout>
              ) : (
                <JoinTournament slug={t.slug} />
              )
            ) : null
          ) : open ? (
            <Callout tone="info">
              <Link href={`/login?next=/tournaments/${t.slug}`} className="text-gold-300">
                Sign in
              </Link>{' '}
              to join.
            </Callout>
          ) : null}
          <p className="text-xs text-ink-400">
            Tournaments rank luck, not volume, so playing more does not help much. Keep to your <Link href="/responsible-play" className="text-gold-300">limits</Link>.
          </p>
        </div>
        <Card>
          <CardHeader
            title={t.phase === 'FINISHED' ? 'Final results' : 'Standings'}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={t.phase === 'RUNNING' ? 'positive' : 'neutral'}>{t.phase.toLowerCase()}</Badge>
                {t.entrants} entrant{t.entrants === 1 ? '' : 's'} · players appear by name only if they chose to (Settings)
              </span>
            }
          />
          <CardBody>
            {t.phase === 'CANCELLED' ? (
              <EmptyState title="Cancelled">This tournament was cancelled; no prizes are paid.</EmptyState>
            ) : d.board.length === 0 ? (
              <EmptyState title="No scores yet">Scores appear here as entrants finish qualifying rounds.</EmptyState>
            ) : (
              <Table data-testid="standings">
                <thead>
                  <tr>
                    <Th>Place</Th>
                    <Th>Player</Th>
                    <Th className="text-right">Score</Th>
                    <Th className="text-right">Prize</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.board.map((b) => (
                    <Tr key={`${b.rank}-${b.you}`} className={cn(b.you && 'bg-gold-500/[0.07]')}>
                      <Td className="num">{b.rank}</Td>
                      <Td>{b.you ? <span className="font-semibold text-gold-200">You</span> : b.name}</Td>
                      <Td className="num text-right">{score(b.score)}</Td>
                      <Td className="text-right">{b.prize > 0 ? <Chips amount={b.prize} suffix={false} /> : '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
