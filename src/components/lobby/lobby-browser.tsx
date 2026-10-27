'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GameGlyph } from '../games/game-glyph';
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
                <Link href={`/games/${game!.id}`} className="surface flex w-52 items-center gap-3 px-3 py-2.5 hover:border-gold-600">
                  <GameGlyph id={game!.id} className="size-10" />
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
          <input
            id="lobby-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 60))}
            placeholder="Search games"
            className="h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-4 text-sm text-ink-100 placeholder:text-ink-400 focus:border-gold-500 focus:outline-none"
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
                'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                filter === c.id ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500',
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
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="lobby-grid">
          {visible.map((g) => {
            const fav = favorites.includes(g.id);
            return (
              <article key={g.id} className="surface flex flex-col overflow-hidden" data-game={g.id}>
                <div className="relative flex items-center justify-center border-b border-ink-700/70 bg-[radial-gradient(circle_at_50%_30%,rgb(199_163_91/0.12),transparent_65%)] py-8">
                  <GameGlyph id={g.id} className="size-24" />
                  <div className="absolute left-4 top-4 flex gap-1.5">{g.isNew && <Badge tone="gold">New</Badge>}</div>
                  <div className="absolute right-4 top-4 flex items-center gap-2">
                    {g.status === 'ACTIVE' ? <Badge tone="positive">Open</Badge> : <Badge tone="warning">Paused</Badge>}
                    {signedIn && (
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(g.id)}
                        disabled={pendingFav !== null}
                        aria-pressed={fav}
                        aria-label={fav ? `Remove ${g.name} from favourites` : `Add ${g.name} to favourites`}
                        title={fav ? 'Remove from favourites' : 'Add to favourites'}
                        className={cn('grid size-8 place-items-center rounded-full border transition-colors disabled:opacity-60', fav ? 'border-gold-500 bg-gold-800/40 text-gold-200' : 'border-ink-600 text-ink-300 hover:border-gold-600')}
                      >
                        <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                          <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.4l-4.6 2.5.9-5.2-3.8-3.7 5.2-.8z" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="font-display text-3xl font-semibold text-ink-100">{g.name}</h2>
                  <p className="mt-1 text-sm text-ink-400">{g.tagline}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.categories.map((c) => (
                      <Badge key={c}>{categories.find((x) => x.id === c)?.label ?? c}</Badge>
                    ))}
                  </div>
                  <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                    <div className="surface-raised px-2 py-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-ink-400">RTP</dt>
                      <dd className="num mt-1 text-sm font-semibold text-gold-300">{g.rtp}</dd>
                    </div>
                    <div className="surface-raised px-2 py-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-ink-400">Min</dt>
                      <dd className="mt-1 text-sm font-semibold">
                        <Chips amount={g.minStake} suffix={false} />
                      </dd>
                    </div>
                    <div className="surface-raised px-2 py-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-ink-400">Max</dt>
                      <dd className="mt-1 text-sm font-semibold">
                        <Chips amount={g.maxStake} suffix={false} />
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
            );
          })}
        </div>
      )}
    </div>
  );
}
