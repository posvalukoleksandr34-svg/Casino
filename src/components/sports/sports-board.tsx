'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatChips, mulDivFloor, parseChips } from '@/engine/money';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Callout, EmptyState } from '../ui/misc';

type Code = 'HOME' | 'DRAW' | 'AWAY';

export interface BoardEvent {
  id: string;
  isDemo: boolean;
  competition: { id: string; name: string };
  home: { id: string; name: string };
  away: { id: string; name: string };
  kickoffAt: string;
  status: string;
  score: { home: number; away: number } | null;
  market: { status: string; statusReason: string | null; oddsSource: string; oddsUpdatedAt: string; stale: boolean; selections: { id: number; code: Code; oddsE2: number | null }[] } | null;
  open: boolean;
}

interface SlipItem {
  selectionId: number;
  eventId: string;
  label: string;
  pick: string;
  code: Code;
  oddsE2: number;
  stakeText: string;
}

interface TicketResult {
  id: string;
  eventId: string;
  selectionCode: Code;
  status: string;
  rejectReason: string | null;
  oddsE2: number;
  stake: number;
  potentialReturn: number;
}

const PICK = { HOME: '1', DRAW: 'X', AWAY: '2' } as const;
const odds = (e2: number) => (e2 / 100).toFixed(2);
const pickName = (e: BoardEvent, code: Code) => (code === 'HOME' ? e.home.name : code === 'AWAY' ? e.away.name : 'Draw');
const MIN_STAKE = 10;

function stakeOf(text: string): number | null {
  try {
    const v = parseChips(text);
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function SportsBoard({
  mode,
  initialUpcoming,
  initialRecent,
  initialFavorites,
}: {
  mode: 'demo' | 'live';
  initialUpcoming: BoardEvent[];
  initialRecent: BoardEvent[];
  initialFavorites: { teams: string[]; competitions: string[] } | null;
}) {
  const { user, balance, setBalance } = useSession();
  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const [recent, setRecent] = useState(initialRecent);
  const [favorites, setFavorites] = useState(initialFavorites ?? { teams: [], competitions: [] });
  const [filter, setFilter] = useState<'all' | 'favorites' | string>('all');
  const [slip, setSlip] = useState<SlipItem[]>([]);
  const [acceptChanges, setAcceptChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TicketResult[] | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const pendingKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ upcoming: BoardEvent[]; recent: BoardEvent[] }>('/api/sports/events');
      setUpcoming(res.upcoming);
      setRecent(res.recent);
      setRefreshError(false);
      // Keep slip prices in step with the server so a change is visible before placing.
      setSlip((s) =>
        s.map((item) => {
          const ev = res.upcoming.find((e) => e.id === item.eventId);
          const sel = ev?.market?.selections.find((x) => x.id === item.selectionId);
          return sel?.oddsE2 ? { ...item, oddsE2: sel.oddsE2 } : item;
        }),
      );
    } catch {
      setRefreshError(true);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const competitions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of upcoming) m.set(e.competition.id, e.competition.name);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [upcoming]);

  const visible = upcoming.filter((e) =>
    filter === 'all' ? true : filter === 'favorites' ? favorites.teams.includes(e.home.id) || favorites.teams.includes(e.away.id) || favorites.competitions.includes(e.competition.id) : e.competition.id === filter,
  );
  const byDay = useMemo(() => {
    const groups = new Map<string, BoardEvent[]>();
    for (const e of visible) {
      const day = new Date(e.kickoffAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      groups.set(day, [...(groups.get(day) ?? []), e]);
    }
    return [...groups.entries()];
  }, [visible]);

  const toggle = (e: BoardEvent, sel: { id: number; code: Code; oddsE2: number | null }) => {
    setResults(null);
    setError(null);
    pendingKey.current = null;
    setSlip((s) => {
      if (s.some((x) => x.selectionId === sel.id)) return s.filter((x) => x.selectionId !== sel.id);
      if (s.length >= 10 || !sel.oddsE2) return s;
      return [...s, { selectionId: sel.id, eventId: e.id, label: `${e.home.name} v ${e.away.name}`, pick: pickName(e, sel.code), code: sel.code, oddsE2: sel.oddsE2, stakeText: '10.00' }];
    });
  };

  const toggleFavorite = async (kind: 'team' | 'competition', id: string) => {
    const on = !(kind === 'team' ? favorites.teams : favorites.competitions).includes(id);
    try {
      const res = await api<{ favorites: { teams: string[]; competitions: string[] } }>(`/api/sports/favorites/${kind}/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' });
      setFavorites(res.favorites);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const stakes = slip.map((s) => stakeOf(s.stakeText));
  const totalStake = stakes.reduce<number>((a, v) => a + (v ?? 0), 0);
  const totalReturn = slip.reduce((a, s, i) => a + (stakes[i] ? mulDivFloor(stakes[i]!, s.oddsE2, 100) : 0), 0);
  const invalid = stakes.some((v) => v === null || v < MIN_STAKE);
  const problem = !user ? 'Sign in to place predictions' : slip.length === 0 ? 'Add a selection' : invalid ? 'Enter a stake of at least 0.10 for each pick' : totalStake > balance ? 'Total stake exceeds your balance' : null;

  const place = async () => {
    setBusy(true);
    setError(null);
    pendingKey.current ??= newIdempotencyKey();
    try {
      const res = await api<{ tickets: TicketResult[]; balance: number }>('/api/sports/tickets', {
        method: 'POST',
        idempotencyKey: pendingKey.current,
        retries: 3,
        body: { selections: slip.map((s, i) => ({ selectionId: s.selectionId, stake: stakes[i], oddsE2: s.oddsE2 })), acceptOddsChanges: acceptChanges },
      });
      pendingKey.current = null;
      setBalance(res.balance);
      setResults(res.tickets);
      const accepted = new Set(res.tickets.filter((t) => t.status === 'ACCEPTED').map((t) => `${t.eventId}:${t.selectionCode}`));
      setSlip((s) => s.filter((x) => !accepted.has(`${x.eventId}:${x.code}`)));
      void refresh();
    } catch (err) {
      // Network failures keep the key so a retry cannot place twice; definitive answers release it.
      if (!(err instanceof ApiError && err.code === 'NETWORK_ERROR')) pendingKey.current = null;
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filter events">
          {[{ id: 'all', name: 'All events' }, ...(user ? [{ id: 'favorites', name: 'My teams' }] : []), ...competitions].map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={cn('rounded-full border px-3.5 py-1.5 text-sm', filter === c.id ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500')}
            >
              {c.name}
            </button>
          ))}
        </div>
        {refreshError && <Callout tone="warning">Could not refresh events. Prices shown may be out of date; the server always checks the current price.</Callout>}
        {byDay.length === 0 ? (
          filter === 'favorites' ? (
            <EmptyState title="No events for your teams">Use the star next to a team or competition to follow it.</EmptyState>
          ) : (
            <EmptyState title="No upcoming events">{mode === 'demo' ? 'New demo fixtures are scheduled every 20 minutes.' : 'The data provider has no upcoming fixtures in the configured competitions.'}</EmptyState>
          )
        ) : (
          byDay.map(([day, events]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">{day}</h2>
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} id={`event-${e.id}`} className="surface px-4 py-3" data-event={e.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
                      <span className="flex items-center gap-2">
                        <span className="num text-ink-200">{new Date(e.kickoffAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{e.competition.name}</span>
                        {user && (
                          <FavStar on={favorites.competitions.includes(e.competition.id)} label={e.competition.name} onClick={() => void toggleFavorite('competition', e.competition.id)} />
                        )}
                        {e.isDemo && <Badge tone="info">Demo</Badge>}
                      </span>
                      <span className="flex items-center gap-2">
                        {!e.open && <Badge tone="warning">{e.market?.stale ? 'Odds out of date' : e.market?.status === 'SUSPENDED' ? 'Suspended' : e.status === 'LIVE' ? 'Started' : 'Closed'}</Badge>}
                        <Link href={`/sports/events/${e.id}`} className="text-gold-400 hover:text-gold-300">
                          Details
                        </Link>
                      </span>
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 text-sm font-medium text-ink-100">
                        <div className="flex items-center gap-1.5">
                          {user && <FavStar on={favorites.teams.includes(e.home.id)} label={e.home.name} onClick={() => void toggleFavorite('team', e.home.id)} />}
                          <span className="truncate">{e.home.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {user && <FavStar on={favorites.teams.includes(e.away.id)} label={e.away.name} onClick={() => void toggleFavorite('team', e.away.id)} />}
                          <span className="truncate">{e.away.name}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 sm:w-64" role="group" aria-label={`Odds for ${e.home.name} v ${e.away.name}`}>
                        {(e.market?.selections ?? []).map((s) => {
                          const inSlip = slip.some((x) => x.selectionId === s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={!e.open || !s.oddsE2 || (!inSlip && slip.length >= 10)}
                              aria-pressed={inSlip}
                              aria-label={`${pickName(e, s.code)} at ${s.oddsE2 ? odds(s.oddsE2) : 'no price'}`}
                              onClick={() => toggle(e, s)}
                              data-selection={s.id}
                              className={cn(
                                'flex h-11 flex-col items-center justify-center rounded-lg border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                inSlip ? 'border-gold-400 bg-gold-800/40 text-gold-100' : 'border-ink-600 bg-ink-850 text-ink-200 hover:border-gold-600',
                              )}
                            >
                              <span className="text-[10px] text-ink-400">{PICK[s.code]}</span>
                              <span className="num font-semibold">{s.oddsE2 ? odds(s.oddsE2) : '—'}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            Recent results
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-ink-400">No finished events yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700">
              {recent.map((e) => (
                <li key={e.id}>
                  <Link href={`/sports/events/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-ink-850/60">
                    <span className="min-w-0 truncate text-ink-200">
                      {e.home.name} v {e.away.name}
                    </span>
                    <span className="num shrink-0 font-semibold text-ink-100">{e.score ? `${e.score.home} – ${e.score.away}` : e.status === 'CANCELLED' ? 'void' : '—'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className={cn(slip.length > 0 || results ? 'order-first' : 'order-last', 'lg:order-none')}>
        <Card className="lg:sticky lg:top-20">
          <CardHeader title={`Prediction slip${slip.length ? ` (${slip.length})` : ''}`} subtitle="Single predictions, virtual chips only. Each pick is settled on its own." />
          <CardBody className="space-y-4">
            {slip.length === 0 && !results && <p className="text-sm text-ink-400">Choose a price (1, X or 2) to add a prediction. Up to 10 picks per slip.</p>}
            {slip.map((s, i) => (
              <div key={s.selectionId} className="rounded-xl border border-ink-700 bg-ink-900/70 p-3 text-sm" data-testid="slip-item">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-ink-100">{s.label}</div>
                    <div className="text-xs text-ink-400">
                      {PICK[s.code]} · {s.pick} @ <span className="num text-gold-300">{odds(s.oddsE2)}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setSlip((x) => x.filter((y) => y.selectionId !== s.selectionId))} className="text-xs text-ink-400 hover:text-ink-200" aria-label={`Remove ${s.label} from the slip`}>
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="sr-only" htmlFor={`stake-${s.selectionId}`}>
                    Stake for {s.label}
                  </label>
                  <input
                    id={`stake-${s.selectionId}`}
                    inputMode="decimal"
                    value={s.stakeText}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, '');
                      pendingKey.current = null;
                      setSlip((x) => x.map((y) => (y.selectionId === s.selectionId ? { ...y, stakeText: v } : y)));
                    }}
                    className={cn('num h-9 w-28 rounded-lg border bg-ink-900 px-2 text-ink-100 outline-none', stakes[i] && stakes[i]! >= MIN_STAKE ? 'border-ink-600 focus:border-gold-500' : 'border-negative/60')}
                  />
                  <span className="text-xs text-ink-400">returns</span>
                  <span className="num ml-auto font-semibold text-ink-100">{stakes[i] ? formatChips(mulDivFloor(stakes[i]!, s.oddsE2, 100)) : '—'}</span>
                </div>
              </div>
            ))}
            {slip.length > 0 && (
              <>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Total stake</span>
                    <span className="num text-ink-100">{formatChips(totalStake)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Potential return if every pick wins</span>
                    <span className="num font-semibold text-ink-100">{formatChips(totalReturn)}</span>
                  </div>
                  <p className="text-xs text-ink-400">Returns include the stake. Picks on the same event cannot all win.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-300">
                  <input type="checkbox" checked={acceptChanges} onChange={(e) => setAcceptChanges(e.target.checked)} className="accent-[var(--color-gold-500)]" />
                  Accept the current price if odds change
                </label>
              </>
            )}
            <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(problem)} onClick={() => void place()} data-testid="slip-place">
              {problem ?? `Place ${slip.length} prediction${slip.length === 1 ? '' : 's'}`}
            </Button>
            {error && (
              <Callout tone="negative" role="alert">
                {error}
              </Callout>
            )}
            {results && (
              <div className="space-y-2" role="status" aria-live="polite" data-testid="slip-results">
                {results.map((t) => {
                  const ev = upcoming.find((e) => e.id === t.eventId);
                  return (
                    <div key={t.id} className={cn('rounded-lg border px-3 py-2 text-xs', t.status === 'ACCEPTED' ? 'border-positive/40 text-ink-200' : 'border-warning/40 text-ink-200')}>
                      <div className="font-semibold">{t.status === 'ACCEPTED' ? 'Accepted' : 'Not placed'}</div>
                      <div>
                        {ev ? `${ev.home.name} v ${ev.away.name} · ` : ''}
                        {PICK[t.selectionCode]} @ {odds(t.oddsE2)} · stake {formatChips(t.stake)}
                        {t.status === 'ACCEPTED' ? ` · returns ${formatChips(t.potentialReturn)} if it wins` : ''}
                      </div>
                      {t.rejectReason && <div className="text-warning">{t.rejectReason}. No chips were taken.</div>}
                    </div>
                  );
                })}
                <Link href="/sports/tickets" className="text-sm text-gold-400">
                  View my predictions →
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function FavStar({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={on ? `Unfollow ${label}` : `Follow ${label}`} className={cn('shrink-0', on ? 'text-gold-300' : 'text-ink-400 hover:text-ink-200')}>
      <svg viewBox="0 0 20 20" className="size-3.5" aria-hidden="true">
        <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.4l-4.6 2.5.9-5.2-3.8-3.7 5.2-.8z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
