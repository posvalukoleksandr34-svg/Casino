'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GameCover } from './game-cover';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Callout, Chips, EmptyState } from '../ui/misc';

export interface LobbyGame {
  id: string;
  name: string;
  tagline: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  statusReason: string | null;
  interactive: boolean;
  categories: string[];
  isNew: boolean;
  addedOn: string;
  rtp: string;
  minStake: number;
  maxStake: number;
}

type Filter = 'all' | 'favorites' | 'new' | string;

/**
 * Lobby browsing: search, categories, favourites and recently played. The game
 * list comes from the server; favourites are saved through /api/favorites.
 */
export function LobbyBrowser({
  games,
  categories,
  signedIn,
  initialFavorites,
  recent,
  initialQuery,
  initialFilter,
}: {
  games: LobbyGame[];
  categories: { id: string; label: string }[];
  signedIn: boolean;
  initialFavorites: string[];
  recent: { gameId: string; lastPlayedAt: string }[];
  initialQuery: string;
  initialFilter: Filter;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [pendingFav, setPendingFav] = useState<string | null>(null);
  const [favError, setFavError] = useState<string | null>(null);

  // Keep the URL shareable without a navigation.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (query) q.set('q', query);
    else q.delete('q');
    if (filter !== 'all') q.set('c', filter);
    else q.delete('c');
    const next = `${window.location.pathname}${q.size ? `?${q}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next);
  }, [query, filter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return games.filter((g) => {
      if (filter === 'favorites' && !favorites.includes(g.id)) return false;
      if (filter === 'new' && !g.isNew) return false;
      if (filter !== 'all' && filter !== 'favorites' && filter !== 'new' && !g.categories.includes(filter)) return false;
      if (!needle) return true;
      const labels = g.categories.map((c) => categories.find((x) => x.id === c)?.label ?? c);
      return [g.name, g.tagline, ...labels].some((t) => t.toLowerCase().includes(needle));
    });
  }, [games, filter, favorites, query, categories]);

  const toggleFavorite = async (id: string) => {
    if (pendingFav) return;
    const was = favorites.includes(id);
    setPendingFav(id);
    setFavError(null);
    setFavorites((f) => (was ? f.filter((x) => x !== id) : [...f, id]));
    try {
      const res = await api<{ favorites: string[] }>(`/api/favorites/${id}`, { method: was ? 'DELETE' : 'PUT' });
      setFavorites(res.favorites);
    } catch (err) {
      setFavorites((f) => (was ? [...f, id] : f.filter((x) => x !== id)));
      setFavError(errorMessage(err));
    } finally {
      setPendingFav(null);
    }
  };

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All games', count: games.length },
    ...(signedIn ? [{ id: 'favorites', label: 'Favourites', count: favorites.filter((f) => games.some((g) => g.id === f)).length }] : []),
    ...(games.some((g) => g.isNew) ? [{ id: 'new', label: 'New', count: games.filter((g) => g.isNew).length }] : []),
    ...categories.map((c) => ({ id: c.id, label: c.label, count: games.filter((g) => g.categories.includes(c.id)).length })),
  ];
  const recentGames = recent.map((r) => ({ ...r, game: games.find((g) => g.id === r.gameId) })).filter((r) => r.game);
  const browsing = !query.trim() && filter === 'all';

  return (
    <div className="space-y-8">
      {signedIn && browsing && recentGames.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            Recently played
          </h2>
          <ul className="flex gap-3 overflow-x-auto pb-1" data-testid="recently-played">
            {recentGames.map(({ game, lastPlayedAt }) => (
              <li key={game!.id} className="shrink-0">
                <Link href={`/games/${game!.id}`} className="surface sheen flex w-56 items-center gap-3 p-2 pr-3 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-gold-500/50">
                  <GameCover id={game!.id} className="h-12 w-16 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-100">{game!.name}</div>
                    <div className="text-xs text-ink-400">{new Date(lastPlayedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-4">
        <div className="relative max-w-md">
          <label htmlFor="lobby-search" className="sr-only">
            Search games
          </label>
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.2 13.2L17 17" strokeLinecap="round" />
          </svg>
          <input
            id="lobby-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 60))}
            placeholder="Search games"
            className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.04] pl-11 pr-4 text-sm text-ink-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] placeholder:text-ink-400 backdrop-blur-md transition-colors hover:border-white/20 focus:border-gold-400/70 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Game categories">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm backdrop-blur-md transition-[background-color,border-color,color]',
                filter === c.id ? 'border-gold-400/60 bg-gold-500/15 text-gold-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]' : 'border-white/10 bg-white/[0.03] text-ink-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-ink-100',
              )}
            >
              {c.label} <span className="num text-ink-400">{c.count}</span>
            </button>
          ))}
        </div>
        {favError && (
          <Callout tone="negative" role="alert" title="Favourites were not updated">
            {favError}
          </Callout>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length} game{visible.length === 1 ? '' : 's'} shown
      </p>

      {visible.length === 0 ? (
        filter === 'favorites' && !query.trim() ? (
          <EmptyState title="No favourites yet" action={<Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Show all games</Button>}>
            Use the star on any game to keep it here.
          </EmptyState>
        ) : (
          <EmptyState
            title={query.trim() ? `No games match “${query.trim()}”` : 'No games in this category'}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear search and filters
              </Button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="lobby-grid">
          {visible.map((g) => {
            const fav = favorites.includes(g.id);
            return (
              <article key={g.id} className="surface group flex flex-col overflow-hidden transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-gold-500/40 hover:shadow-[0_24px_50px_-24px_rgb(0_0_0/0.9),0_0_0_1px_rgb(199_163_91/0.15)]" data-game={g.id}>
                <GameCover id={g.id} className="sheen aspect-[16/10]">
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    {g.isNew && <Badge tone="gold">New</Badge>}
                    {g.status !== 'ACTIVE' && <Badge tone="warning">Paused</Badge>}
                  </div>
                  {signedIn && (
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(g.id)}
                      disabled={pendingFav !== null}
                      aria-pressed={fav}
                      aria-label={fav ? `Remove ${g.name} from favourites` : `Add ${g.name} to favourites`}
                      title={fav ? 'Remove from favourites' : 'Add to favourites'}
                      className={cn(
                        'absolute right-3 top-3 grid size-8 place-items-center rounded-full border backdrop-blur-md transition-colors disabled:opacity-60',
                        fav ? 'border-gold-400/70 bg-gold-500/25 text-gold-100' : 'border-white/20 bg-black/30 text-ink-100 hover:border-gold-400/60',
                      )}
                    >
                      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                        <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.4l-4.6 2.5.9-5.2-3.8-3.7 5.2-.8z" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
                    <h2 className="font-display text-2xl font-semibold leading-none text-ink-100 drop-shadow-[0_2px_6px_rgb(0_0_0/0.8)]">{g.name}</h2>
                    <span className="num shrink-0 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-gold-200 backdrop-blur-md" title="Theoretical return to player">
                      RTP {g.rtp}
                    </span>
                  </div>
                </GameCover>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <p className="text-sm leading-snug text-ink-300">{g.tagline}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                    {g.categories.map((c) => (
                      <Badge key={c}>{categories.find((x) => x.id === c)?.label ?? c}</Badge>
                    ))}
                    <span className="num ml-auto">
                      <Chips amount={g.minStake} suffix={false} />–<Chips amount={g.maxStake} suffix={false} />
                    </span>
                  </div>
                  {g.status !== 'ACTIVE' && g.statusReason && <p className="text-xs text-warning">{g.statusReason}</p>}
                  <div className="mt-auto flex gap-2 pt-1">
                    <Link
                      href={`/games/${g.id}`}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 text-sm font-semibold text-ink-950 shadow-[0_1px_0_rgb(255_255_255/0.45)_inset,0_8px_22px_-12px_rgb(199_163_91/0.8)] transition-[filter] hover:brightness-110"
                    >
                      {g.status === 'ACTIVE' ? 'Play' : 'View'}
                    </Link>
                    <Link href={`/rules/${g.id}`} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 text-sm text-ink-200 backdrop-blur-md transition-colors hover:border-gold-400/50 hover:bg-white/[0.09]">
                      Rules
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
