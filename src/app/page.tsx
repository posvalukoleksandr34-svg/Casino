import Link from 'next/link';
import { GameCover } from '@/components/lobby/game-cover';
import { GameTile } from '@/components/lobby/game-tile';
import { FeaturedTable } from '@/components/lobby/featured-table';
import { LiveFeed } from '@/components/live/live-feed';
import { Chips } from '@/components/ui/misc';
import { formatChips } from '@/engine/money';
import { pageSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { GAME_CATEGORIES } from '@/server/games/catalog';
import { recentlyPlayed } from '@/server/games/favorites';
import { listGames, popularGameIds } from '@/server/games/lobby';
import { getWalletAccount } from '@/server/ledger/accounts';
import { DEFAULT_WELCOME_CAMPAIGN } from '@/server/promotions/campaigns';
import { getPlatformSettings } from '@/server/risk/risk-service';
import { rtpText } from '@/lib/format';

export default async function HomePage() {
  const [session, games, popular, settings] = await Promise.all([pageSession(), listGames(), popularGameIds(7, 8), getPlatformSettings(getDb())]);
  const player = session && !session.onboardingPending ? session : null;
  const [recent, wallet] = player ? await Promise.all([recentlyPlayed(player.userId, 6), getWalletAccount(getDb(), player.userId)]) : [[], undefined];
  const byId = new Map(games.map((g) => [g.id, g]));
  const tile = (id: string) => {
    const g = byId.get(id);
    return g ? <GameTile key={g.id} id={g.id} name={g.name} rtp={rtpText(g.theoretical)} isNew={g.isNew} paused={g.status !== 'ACTIVE'} /> : null;
  };
  // Popular by play this week, topped up from the catalogue so the row is never empty.
  const popularIds = [...popular, ...games.map((g) => g.id)].filter((id, i, a) => a.indexOf(id) === i && byId.has(id)).slice(0, 8);
  const newIds = games.filter((g) => g.isNew).map((g) => g.id);
  const welcome = Math.min(DEFAULT_WELCOME_CAMPAIGN.maxBonus, settings.signupBonus);

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="surface relative overflow-hidden" aria-labelledby="hero-h">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_85%_20%,rgb(199_163_91/0.22),transparent_65%),radial-gradient(50%_70%_at_10%_100%,rgb(60_90_200/0.18),transparent_70%)]" aria-hidden="true" />
        <div className="relative grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr]">
          <div className="animate-rise">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold-600/50 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">
              Free to play · Virtual credits · Provably fair
            </div>
            {player ? (
              <>
                <h1 id="hero-h" className="font-display text-5xl font-semibold leading-[1.02] text-ink-100 sm:text-6xl">
                  Welcome back,
                  <br />
                  <span className="gold-text">{player.displayName ?? player.username}</span>
                </h1>
                <p className="mt-4 text-sm text-ink-300">
                  Balance <span className="num text-lg font-semibold text-gold-200">{formatChips(wallet?.balance ?? 0)}</span> credits
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/lobby" className="inline-flex h-12 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-7 font-semibold text-ink-950 shadow-[0_10px_30px_-12px_rgb(199_163_91/0.8)] hover:brightness-110">
                    Play now
                  </Link>
                  <Link href="/wallet" className="inline-flex h-12 items-center rounded-xl border border-white/12 bg-white/[0.05] px-6 text-ink-100 backdrop-blur-md hover:border-gold-500/50">
                    Cashier
                  </Link>
                  <Link href="/promotions" className="inline-flex h-12 items-center rounded-xl px-4 text-sm text-gold-300 hover:text-gold-200">
                    Bonuses →
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h1 id="hero-h" className="font-display text-5xl font-semibold leading-[1.02] text-ink-100 sm:text-6xl xl:text-7xl">
                  The casino,
                  <br />
                  <span className="gold-text italic">without the cash.</span>
                </h1>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-300">
                  Roulette, blackjack, slots and more — with published odds, results committed before you play, and every credit on an audited
                  ledger. Credits are free and have no monetary value.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link href="/register" className="inline-flex h-12 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-7 font-semibold text-ink-950 shadow-[0_10px_30px_-12px_rgb(199_163_91/0.8)] hover:brightness-110">
                    Join free — {formatChips(settings.signupBonus)} credits
                  </Link>
                  <Link href="/lobby" className="inline-flex h-12 items-center rounded-xl border border-white/12 bg-white/[0.05] px-6 text-ink-100 backdrop-blur-md hover:border-gold-500/50">
                    Browse games
                  </Link>
                </div>
                <p className="mt-3 text-xs text-ink-400">
                  Plus a {DEFAULT_WELCOME_CAMPAIGN.matchPercent}% welcome bonus of up to {formatChips(welcome)} credits. 18+ only.
                </p>
              </>
            )}
          </div>
          {/* Cover collage, positioned in percentages of its own column so it never reaches the text. */}
          <div className="relative hidden h-72 lg:block" aria-hidden="true">
            <GameCover id="lantern-hollow" className="absolute left-[4%] top-[8%] aspect-[4/3] w-[48%] -rotate-6 rounded-2xl shadow-2xl ring-1 ring-white/15" />
            <GameCover id="roulette" className="absolute right-0 top-0 aspect-[4/3] w-[52%] rotate-3 rounded-2xl shadow-2xl ring-1 ring-white/15" />
            <GameCover id="blackjack" className="absolute bottom-0 left-[26%] aspect-[4/3] w-[42%] rotate-[-2deg] rounded-2xl shadow-2xl ring-1 ring-white/15" />
          </div>
        </div>
      </section>

      {/* Search and categories */}
      <section aria-label="Find a game" className="flex flex-col gap-4 md:flex-row md:items-center">
        <form action="/lobby" method="get" role="search" className="relative md:w-96">
          <label htmlFor="home-search" className="sr-only">
            Search games
          </label>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true">
            <path d="M11 4a7 7 0 1 0 4.4 12.4l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" fill="currentColor" />
          </svg>
          <input id="home-search" name="q" placeholder="Search games" className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.05] pl-10 pr-4 text-sm text-ink-100 outline-none backdrop-blur-md focus:border-gold-500" />
        </form>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {Object.entries(GAME_CATEGORIES).map(([id, label]) => (
            <li key={id}>
              <Link href={`/lobby?c=${id}`} className="block whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-ink-200 hover:border-gold-500/50 hover:text-ink-100">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Promotional banners */}
      <section aria-label="Promotions" className="grid gap-4 md:grid-cols-3">
        {[
          { href: player ? '/promotions' : '/register', eyebrow: 'Welcome offer', title: `+${DEFAULT_WELCOME_CAMPAIGN.matchPercent}% bonus`, body: `Up to ${formatChips(welcome)} bonus credits on your starting credits.`, tone: 'from-[#5a3a0e] to-[#1a1004]' },
          { href: player ? '/wallet#top-up' : '/register', eyebrow: 'Every day', title: 'Free top-up', body: `${formatChips(settings.dailyBonus)} free credits a day while your balance is low.`, tone: 'from-[#0e3b2b] to-[#04140e]' },
          { href: '/games/roulette', eyebrow: 'Live now', title: 'Roulette table', body: 'A spin every 28 seconds, all day. Bet or just watch.', tone: 'from-[#2a1450] to-[#0b0618]' },
        ].map((b) => (
          <Link key={b.title} href={b.href} className={`sheen relative overflow-hidden rounded-2xl bg-gradient-to-br ${b.tone} p-5 ring-1 ring-white/10 transition-transform hover:-translate-y-0.5`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">{b.eyebrow}</div>
            <div className="mt-1 font-display text-3xl font-semibold text-ink-100">{b.title}</div>
            <p className="mt-1 text-sm text-ink-300">{b.body}</p>
          </Link>
        ))}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <RowHeader id="recent-h" title="Continue playing" href="/history" link="History" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{recent.map((r) => tile(r.gameId))}</div>
        </section>
      )}

      <section aria-labelledby="popular-h">
        <RowHeader id="popular-h" title="Popular this week" href="/lobby" link="All games" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{popularIds.map(tile)}</div>
      </section>

      {newIds.length > 0 && (
        <section aria-labelledby="new-h">
          <RowHeader id="new-h" title="New games" href="/lobby?c=new" link="See all new" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{newIds.slice(0, 10).map(tile)}</div>
        </section>
      )}

      <LiveFeed />

      <FeaturedTable />

      {/* Trust and responsible play */}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Why Aurovane">
        {[
          ['Published odds', 'Every game shows its exact RTP and house edge, checked by automated tests against the game code.', '/rules'],
          ['Provably fair', 'Each result is fixed by a seed committed before you play. Verify any round yourself.', '/fairness'],
          ['Play within limits', 'Loss, wager and session limits, reality checks, cool-off and self-exclusion — enforced on the server.', '/responsible-play'],
        ].map(([title, body, href]) => (
          <Link key={title} href={href!} className="surface p-5 hover:border-gold-500/40">
            <h3 className="font-display text-2xl font-semibold text-ink-100">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{body}</p>
          </Link>
        ))}
      </section>
      {player && (
        <p className="text-center text-xs text-ink-400">
          Playing for fun? You have <Chips amount={wallet?.balance ?? 0} /> — set a limit any time on{' '}
          <Link href="/responsible-play" className="text-gold-400 hover:text-gold-300">
            Responsible play
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function RowHeader({ id, title, href, link }: { id: string; title: string; href: string; link: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 id={id} className="font-display text-3xl font-semibold text-ink-100">
        {title}
      </h2>
      <Link href={href} className="text-sm text-gold-400 hover:text-gold-300">
        {link} →
      </Link>
    </div>
  );
}
