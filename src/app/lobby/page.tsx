import { LobbyBrowser, type LobbyGame } from '@/components/lobby/lobby-browser';
import { PageHeader } from '@/components/ui/misc';
import { currentSession } from '@/server/auth/current';
import { GAME_CATEGORIES } from '@/server/games/catalog';
import { listFavorites, recentlyPlayed } from '@/server/games/favorites';
import { listGames } from '@/server/games/lobby';
import { rtpText } from '@/lib/format';

export const metadata = { title: 'Game lobby' };

export default async function LobbyPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const [all, session, sp] = await Promise.all([listGames(), currentSession(), searchParams]);
  const [favorites, recent] = session ? await Promise.all([listFavorites(session.userId), recentlyPlayed(session.userId)]) : [[], []];
  const games: LobbyGame[] = all.map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    status: g.status,
    statusReason: g.statusReason,
    interactive: g.interactive,
    categories: g.categories,
    isNew: g.isNew,
    addedOn: g.addedOn,
    rtp: rtpText(g.theoretical),
    minStake: g.limits.minStake,
    maxStake: g.limits.maxStake,
  }));
  const categories = Object.entries(GAME_CATEGORIES).map(([id, label]) => ({ id, label }));
  const filters = new Set(['all', 'new', ...(session ? ['favorites'] : []), ...categories.map((c) => c.id)]);
  return (
    <>
      <PageHeader
        eyebrow="Lobby"
        title="Choose your table"
        subtitle="Every game shows its theoretical return to player (RTP) and table limits. RTP describes the long-run average; individual sessions can differ greatly."
      />
      <LobbyBrowser
        games={games}
        categories={categories}
        signedIn={Boolean(session)}
        initialFavorites={favorites}
        recent={recent}
        initialQuery={(sp.q ?? '').slice(0, 60)}
        initialFilter={sp.c && filters.has(sp.c) ? sp.c : 'all'}
      />
    </>
  );
}
