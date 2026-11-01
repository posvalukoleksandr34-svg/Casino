'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeBet, pocketColor, positionKey } from '@/engine/games/roulette';
import { formatChips } from '@/engine/money';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '../ui/button';
import { Drawer } from '../ui/drawer';
import { HistoryIcon } from '../ui/icons';
import { historyStats, toSpins, type RoundListItem, type RouletteSpin } from './roulette-history-data';

export const STRIP_SIZE = 20;
const PAGE = 50;

const POCKET_BG = { red: 'bg-roulette-red', black: 'bg-roulette-black', green: 'bg-roulette-green' } as const;

/**
 * The signed-in player's own settled spins from `/api/rounds` — the same
 * records as the account history. Nothing is invented or shared between players.
 */
export function useRouletteHistory(enabled: boolean, refreshKey: unknown) {
  const [spins, setSpins] = useState<RouletteSpin[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSpins(null);
      return;
    }
    let cancelled = false;
    api<{ items: RoundListItem[]; nextCursor: string | null }>(`/api/rounds?game=roulette&limit=${PAGE}`)
      .then((r) => {
        if (cancelled) return;
        setSpins(toSpins(r.items));
        setCursor(r.nextCursor);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setSpins((s) => s ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: RoundListItem[]; nextCursor: string | null }>(`/api/rounds?game=roulette&limit=${PAGE}&before=${encodeURIComponent(cursor)}`);
      setSpins((s) => {
        const seen = new Set((s ?? []).map((x) => x.id));
        return [...(s ?? []), ...toSpins(r.items).filter((x) => !seen.has(x.id))];
      });
      setCursor(r.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  return { spins, hasMore: cursor !== null, loadMore, loadingMore, failed };
}

function Pocket({ n, color, size = 'md' }: { n: number; color: RouletteSpin['color']; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'num grid shrink-0 place-items-center rounded-full border font-semibold text-ink-100',
        POCKET_BG[color],
        color === 'black' ? 'border-ink-500' : 'border-white/15',
        size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
      )}
    >
      {n}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });

/** The latest settled results, newest first; each opens its details. */
export function ResultsStrip({ spins, onOpen }: { spins: RouletteSpin[] | null; onOpen: (id: string | null) => void }) {
  const latest = (spins ?? []).slice(0, STRIP_SIZE);
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 [scrollbar-width:thin]" role="list" aria-label={`Your last ${STRIP_SIZE} results, newest first`} data-testid="roulette-history-strip">
        {spins === null ? (
          Array.from({ length: 8 }, (_, i) => <span key={i} className="skeleton size-8 shrink-0 rounded-full" />)
        ) : latest.length === 0 ? (
          <span className="text-xs text-ink-400">Your results will appear here after your first spin.</span>
        ) : (
          latest.map((s, i) => (
            <span role="listitem" key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                aria-label={`${s.result} ${s.color}, ${time(s.at)}, net ${formatChips(s.net, { sign: true })} chips. Show details`}
                title={`${s.result} ${s.color} · ${time(s.at)}`}
                data-result={s.result}
                className={cn('block rounded-full transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400', i === 0 && 'ring-2 ring-gold-400/80 ring-offset-2 ring-offset-ink-900')}
              >
                <Pocket n={s.result} color={s.color} size="sm" />
              </button>
            </span>
          ))
        )}
      </div>
      <Button size="sm" variant="subtle" onClick={() => onOpen(null)} data-testid="roulette-history-open" aria-haspopup="dialog">
        <HistoryIcon className="size-4" />
        History
      </Button>
    </div>
  );
}

function StatBar({ label, parts }: { label: string; parts: { name: string; value: number; className: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</div>
      <div className="flex h-2 overflow-hidden rounded-full bg-ink-800" aria-hidden="true">
        {parts.map((p) => (total > 0 && p.value > 0 ? <span key={p.name} className={cn('h-full border-r-2 border-ink-900 last:border-r-0', p.className)} style={{ width: `${(p.value / total) * 100}%` }} /> : null))}
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-4 text-xs">
        {parts.map((p) => (
          <div key={p.name} className="flex gap-1">
            <dt className="text-ink-400">{p.name}</dt>
            <dd className="num text-ink-200">
              {p.value}
              {total > 0 && <span className="text-ink-400"> ({Math.round((p.value / total) * 100)}%)</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Descriptive counts over the loaded spins — explicitly not a prediction. */
export function HistoryStatsPanel({ spins }: { spins: RouletteSpin[] }) {
  const s = historyStats(spins.map((x) => x.result));
  if (s.count === 0) return null;
  return (
    <section aria-label="Statistics of your past results" className="space-y-3 rounded-xl border border-ink-700 bg-ink-850/60 p-4" data-testid="roulette-stats">
      <p className="text-xs text-ink-300">
        <span className="font-semibold text-ink-100">Historical only.</span> Counts over your last {s.count} spin{s.count === 1 ? '' : 's'}. Every spin is independent: past results do not make any number more or less likely.
      </p>
      <StatBar
        label="Colour"
        parts={[
          { name: 'Red', value: s.red, className: 'bg-roulette-red' },
          { name: 'Black', value: s.black, className: 'bg-ink-500' },
          { name: 'Zero', value: s.green, className: 'bg-roulette-green' },
        ]}
      />
      <StatBar
        label="Odd / even (zero excluded)"
        parts={[
          { name: 'Odd', value: s.odd, className: 'bg-gold-600' },
          { name: 'Even', value: s.even, className: 'bg-ink-400' },
        ]}
      />
      <StatBar
        label="Low / high (zero excluded)"
        parts={[
          { name: '1–18', value: s.low, className: 'bg-gold-600' },
          { name: '19–36', value: s.high, className: 'bg-ink-400' },
        ]}
      />
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Most frequent in this sample</div>
        <ul className="flex flex-wrap gap-2 text-xs">
          {s.frequent.map((f) => (
            <li key={f.number} className="flex items-center gap-1.5 text-ink-300">
              <Pocket n={f.number} color={pocketColor(f.number)} size="sm" />×{f.count}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The history drawer: every loaded spin with its details and a verification link. */
export function HistoryDrawer({
  open,
  onClose,
  spins,
  selected,
  hasMore,
  loadMore,
  loadingMore,
  failed,
}: {
  open: boolean;
  onClose: () => void;
  spins: RouletteSpin[] | null;
  selected: string | null;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  failed: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(selected);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!open) return;
    setExpanded(selected);
    if (selected) {
      // After the drawer renders: bring the chosen spin into view and focus it.
      requestAnimationFrame(() => {
        const el = list.current?.querySelector<HTMLElement>(`[data-spin="${selected}"] button`);
        el?.scrollIntoView({ block: 'center' });
        el?.focus();
      });
    }
  }, [open, selected]);

  return (
    <Drawer open={open} onClose={onClose} title="Your roulette history" subtitle="Your own settled spins, newest first." testId="roulette-history-drawer">
      {spins === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      ) : spins.length === 0 ? (
        <p className="text-ink-400">{failed ? 'Your history could not be loaded. Try again later.' : 'No settled spins yet.'}</p>
      ) : (
        <div className="space-y-5">
          <HistoryStatsPanel spins={spins} />
          <ol ref={list} className="divide-y divide-ink-800" aria-label="Spins">
            {spins.map((s) => {
              const isOpen = expanded === s.id;
              return (
                <li key={s.id} data-spin={s.id} className={cn('py-1', isOpen && 'rounded-lg bg-ink-850/70')}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-ink-850 focus-visible:outline-2 focus-visible:outline-gold-400"
                  >
                    <Pocket n={s.result} color={s.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block capitalize text-ink-100">
                        {s.result} {s.color}
                      </span>
                      <span className="block text-xs text-ink-400">{dateTime(s.at)}</span>
                    </span>
                    <span className="text-right">
                      <span className="num block text-xs text-ink-400">stake {formatChips(s.stake)}</span>
                      <span className={cn('num block font-semibold', s.net > 0 ? 'text-positive' : s.net < 0 ? 'text-ink-300' : 'text-ink-200')}>{formatChips(s.net, { sign: true })}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 px-2 pb-3 pt-1 text-xs" data-testid="roulette-history-details">
                      <dl className="grid grid-cols-3 gap-2">
                        <div>
                          <dt className="text-ink-400">Stake</dt>
                          <dd className="num text-ink-100">{formatChips(s.stake)}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-400">Payout</dt>
                          <dd className="num text-ink-100">{formatChips(s.payout)}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-400">Net</dt>
                          <dd className={cn('num', s.net > 0 ? 'text-positive' : 'text-ink-100')}>{formatChips(s.net, { sign: true })}</dd>
                        </div>
                      </dl>
                      {s.results.length > 0 && (
                        <ul className="space-y-0.5">
                          {s.results.map((r) => (
                            <li key={positionKey(r.bet)} className="flex justify-between gap-3">
                              <span className={r.won ? 'text-positive' : 'text-ink-400'}>
                                {describeBet(r.bet)} · {formatChips(r.bet.amount)}
                              </span>
                              <span className={cn('num', r.won ? 'text-positive' : 'text-ink-400')}>{r.won ? `+${formatChips(r.payout)}` : 'lost'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Link href={`/history/${s.id}`} className="inline-block font-medium text-gold-300 underline-offset-2 hover:underline">
                        Verify this round →
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {hasMore && (
            <Button size="sm" variant="subtle" block loading={loadingMore} onClick={loadMore}>
              Load older spins
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}
