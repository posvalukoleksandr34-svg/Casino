import Link from 'next/link';
import { GameGlyph } from '@/components/games/game-glyph';
import { Badge } from '@/components/ui/badge';
import { pageSession } from '@/server/auth/current';
import { listGames } from '@/server/games/lobby';
import { rtpText } from '@/lib/format';

export default async function HomePage() {
  const [session, games] = await Promise.all([pageSession(), listGames()]);
  return (
    <div className="space-y-24">
      <section className="relative grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div className="animate-rise">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-700/60 bg-ink-900/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400">
            Virtual chips · Verifiable odds
          </div>
          <h1 className="font-display text-5xl font-semibold leading-[1.02] text-ink-100 sm:text-7xl">
            The house edge,
            <br />
            <span className="gold-text italic">in plain sight.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-300">
            Aurovane publishes the exact probabilities and payouts of every game. Outcomes are generated on the server from a seed
            committed before you bet, and every chip moves through an audited double-entry ledger. Play for entertainment — chips
            have no cash value.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/lobby" className="inline-flex h-12 items-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 px-6 font-semibold text-ink-950 shadow-[0_8px_30px_-12px_rgb(199_163_91/0.7)] hover:from-gold-300 hover:to-gold-500">
              Enter the lobby
            </Link>
            {!session && (
              <Link href="/register" className="inline-flex h-12 items-center rounded-xl border border-ink-600 bg-ink-850 px-6 text-ink-100 hover:border-gold-600">
                Create account — 10,000 free chips
              </Link>
            )}
          </div>
          <p className="mt-4 text-xs text-ink-400">18+ only. Chips cannot be purchased, withdrawn or exchanged.</p>
        </div>
        <div className="surface relative overflow-hidden p-6 animate-fade-in">
          <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-gold-500/10 blur-3xl" />
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">Published return to player</div>
          <ul className="mt-4 divide-y divide-ink-800">
            {games.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <GameGlyph id={g.id} className="size-9" />
                  <div>
                    <div className="text-sm font-medium text-ink-100">{g.name}</div>
                    <div className="text-xs text-ink-400">{g.theoretical.method === 'exact' ? 'Exact, analytical' : 'Simulation estimate'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-lg font-semibold text-gold-300">{rtpText(g.theoretical)}</div>
                  <div className="num text-[11px] text-ink-400">edge {(g.theoretical.houseEdge * 100).toFixed(2)}%</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-ink-400">
            RTP includes the returned stake. A positive house edge means players are expected to lose chips over time; short-term
            results vary widely.
          </p>
        </div>
      </section>

      <section aria-labelledby="pillars" className="grid gap-5 md:grid-cols-3">
        <h2 id="pillars" className="sr-only">
          How Aurovane works
        </h2>
        {[
          ['Published mathematics', 'Every outcome space, probability, payout and RTP is documented — and enforced by automated tests against the live game code.'],
          ['Provably fair', 'Before you bet you see a SHA-256 commitment to the server seed. Rotate it at any time to reveal the seed and re-compute any result yourself.'],
          ['Server-authoritative ledger', 'Results are produced only on the server. Every stake and payout is an immutable double-entry record, reconciled automatically.'],
        ].map(([title, body], i) => (
          <div key={title} className="surface p-6 animate-rise" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-gold-700/60 bg-gold-800/20 font-display text-lg text-gold-300">
              {i + 1}
            </div>
            <h3 className="font-display text-2xl font-semibold text-ink-100">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-400">{body}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="games-heading">
        <div className="mb-6 flex items-end justify-between">
          <h2 id="games-heading" className="font-display text-4xl font-semibold text-ink-100">
            The tables
          </h2>
          <Link href="/lobby" className="text-sm text-gold-400 hover:text-gold-300">
            View lobby →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <Link key={g.id} href={`/games/${g.id}`} className="surface group flex items-center gap-5 p-5 transition-shadow hover:shadow-[var(--shadow-gold)]">
              <GameGlyph id={g.id} className="size-16 shrink-0 transition-transform group-hover:scale-105" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-2xl font-semibold text-ink-100">{g.name}</span>
                  {g.status !== 'ACTIVE' && <Badge tone="warning">Paused</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-400">{g.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="surface grid gap-8 p-8 md:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="font-display text-4xl font-semibold text-ink-100">Play within your limits</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            Set loss, wagering and session limits, schedule reality checks, take a cool-off break or self-exclude. Limits are enforced
            on the server before a wager is accepted.
          </p>
          <Link href="/responsible-play" className="mt-5 inline-block text-sm font-medium text-gold-400 hover:text-gold-300">
            Responsible play tools →
          </Link>
        </div>
        <ul className="grid gap-3 text-sm text-ink-300 sm:grid-cols-2">
          {['24-hour and 7-day loss limits', 'Daily wagering limit', 'Session time limit', 'Reality-check reminders', 'Cool-off breaks', 'Self-exclusion'].map((t) => (
            <li key={t} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
              <span className="size-1.5 rotate-45 bg-gold-500" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
