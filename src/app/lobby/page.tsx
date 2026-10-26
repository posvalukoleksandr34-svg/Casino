import Link from 'next/link';
import { GameGlyph } from '@/components/games/game-glyph';
import { Badge } from '@/components/ui/badge';
import { Chips, PageHeader } from '@/components/ui/misc';
import { listGames } from '@/server/games/lobby';

export const metadata = { title: 'Game lobby' };

export default async function LobbyPage() {
  const games = await listGames();
  return (
    <>
      <PageHeader
        eyebrow="Lobby"
        title="Choose your table"
        subtitle="Every game shows its theoretical return to player (RTP) and table limits. RTP describes the long-run average; individual sessions can differ greatly."
      />
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {games.map((g, i) => (
          <article key={g.id} className="surface flex flex-col overflow-hidden animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="relative flex items-center justify-center border-b border-ink-700/70 bg-[radial-gradient(circle_at_50%_30%,rgb(199_163_91/0.12),transparent_65%)] py-8">
              <GameGlyph id={g.id} className="size-24" />
              <div className="absolute right-4 top-4">
                {g.status === 'ACTIVE' ? <Badge tone="positive">Open</Badge> : <Badge tone="warning">Paused</Badge>}
              </div>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="font-display text-3xl font-semibold text-ink-100">{g.name}</h2>
              <p className="mt-1 text-sm text-ink-400">{g.tagline}</p>
              <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="surface-raised px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wider text-ink-400">RTP</dt>
                  <dd className="num mt-1 text-sm font-semibold text-gold-300">{(g.theoretical.rtp * 100).toFixed(2)}%</dd>
                </div>
                <div className="surface-raised px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wider text-ink-400">Min</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    <Chips amount={g.limits.minStake} suffix={false} />
                  </dd>
                </div>
                <div className="surface-raised px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wider text-ink-400">Max</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    <Chips amount={g.limits.maxStake} suffix={false} />
                  </dd>
                </div>
              </dl>
              {g.status !== 'ACTIVE' && g.statusReason && <p className="mt-4 text-xs text-warning">{g.statusReason}</p>}
              <div className="mt-auto flex gap-2 pt-6">
                <Link
                  href={`/games/${g.id}`}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 text-sm font-semibold text-ink-950 hover:from-gold-300 hover:to-gold-500"
                >
                  {g.status === 'ACTIVE' ? 'Play' : 'View'}
                </Link>
                <Link href={`/rules/${g.id}`} className="inline-flex h-10 items-center justify-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
                  Rules
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
