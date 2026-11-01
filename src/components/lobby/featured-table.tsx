import Link from 'next/link';
import { GameCover } from './game-cover';

/**
 * The lobby's featured banner: the automatic roulette table, which runs
 * continuously (a spin every round, whether or not anyone bets).
 */
export function FeaturedTable() {
  return (
    <section aria-labelledby="featured-heading" className="surface sheen relative mb-8 overflow-hidden">
      <div className="grid items-center md:grid-cols-[1.1fr_1fr]">
        <div className="relative z-10 space-y-4 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive/60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-positive" />
            </span>
            Live table
          </div>
          <h2 id="featured-heading" className="font-display text-4xl font-semibold leading-tight text-ink-100 sm:text-5xl">
            European Roulette
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-ink-300">
            The wheel turns all day: 15 seconds to place your chips, then a spin, every round. Bet when you like, or simply watch — every result is drawn and committed by
            the server.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/games/roulette"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-6 text-sm font-semibold text-ink-950 shadow-[0_1px_0_rgb(255_255_255/0.45)_inset,0_10px_26px_-12px_rgb(199_163_91/0.85)] transition-[filter] hover:brightness-110"
            >
              Join the table
            </Link>
            <Link href="/rules/roulette" className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-5 text-sm text-ink-200 backdrop-blur-md transition-colors hover:border-gold-400/50 hover:bg-white/[0.09]">
              How it works
            </Link>
          </div>
        </div>
        <GameCover id="roulette" className="h-56 md:h-full md:min-h-64" />
      </div>
    </section>
  );
}
