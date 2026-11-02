import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { pageSession } from '@/server/auth/current';
import { listTournaments, myTournaments } from '@/server/tournaments/tournaments';

export const metadata = { title: 'Tournaments' };

const PHASE: Record<string, { label: string; tone: 'positive' | 'info' | 'neutral' | 'warning' }> = {
  RUNNING: { label: 'Live', tone: 'positive' },
  UPCOMING: { label: 'Upcoming', tone: 'info' },
  ENDED: { label: 'Ended — results pending', tone: 'warning' },
  FINISHED: { label: 'Finished', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export default async function TournamentsPage() {
  const session = await pageSession();
  const [all, mine] = await Promise.all([listTournaments(), session ? myTournaments(session.userId) : Promise.resolve([])]);
  const order = ['RUNNING', 'UPCOMING', 'ENDED', 'FINISHED', 'CANCELLED'];
  const sorted = [...all].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  return (
    <>
      <PageHeader
        eyebrow="Compete"
        title="Tournaments"
        subtitle="Join, then play the listed games: your best multipliers after joining are ranked. Rankings reward luck, not how much you play. Prizes are virtual-credit rewards with no wagering."
      />
      {sorted.length === 0 ? (
        <EmptyState title="No tournaments scheduled">New tournaments are announced here and on the home page.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="tournament-list">
          {sorted.map((t) => {
            const p = PHASE[t.phase]!;
            return (
              <Link key={t.id} href={`/tournaments/${t.slug}`} className="surface group block p-5 transition-colors hover:border-gold-500/40">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={p.tone}>{p.label}</Badge>
                  {t.minVipLevel > 1 && <Badge tone="gold">VIP</Badge>}
                </div>
                <h2 className="mt-3 font-display text-2xl text-ink-100 group-hover:text-gold-200">{t.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-300">{t.description}</p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-400">Prize pool</dt>
                    <dd className="num text-sm font-semibold text-gold-200">
                      <Chips amount={t.prizePool} suffix={false} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Entrants</dt>
                    <dd className="num text-sm text-ink-100">{t.entrants}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-ink-400">{t.phase === 'UPCOMING' ? 'Starts' : 'Ends'}</dt>
                    <dd className="text-ink-200">{new Date(t.phase === 'UPCOMING' ? t.startsAt : t.endsAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
      {mine.length > 0 && (
        <Card className="mt-8">
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold text-ink-100">Your tournaments</h2>
            <ul className="divide-y divide-white/[0.06] text-sm" data-testid="my-tournaments">
              {mine.map((m) => (
                <li key={m.slug} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/tournaments/${m.slug}`} className="text-ink-100 hover:text-gold-200">
                    {m.name}
                  </Link>
                  <span className="text-xs text-ink-400">
                    {PHASE[m.phase]?.label}
                    {m.rank ? ` · place ${m.rank}` : ''}
                    {m.prize ? ` · prize ${(m.prize / 100).toFixed(2)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
