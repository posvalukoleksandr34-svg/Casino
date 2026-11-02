'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';

interface Snapshot {
  at: string;
  online: number;
  wins: { gameId: string; game: string; player: string; multiplierE2: number; payout: number; at: string }[];
  table: { slot: number; result: number; color: string } | null;
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/**
 * Live strip: players online, recent notable wins and the latest roulette
 * table result, pushed by the server (server-sent events). Falls back to a
 * one-off snapshot when streaming is unavailable. Display only.
 */
export function LiveFeed({ className }: { className?: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    const fallback = () =>
      fetch('/api/live?once=1')
        .then((r) => (r.ok ? r.json() : null))
        .then((s: Snapshot | null) => !cancelled && s && setSnap(s))
        .catch(() => {});
    if (typeof EventSource === 'undefined') {
      void fallback();
    } else {
      es = new EventSource('/api/live');
      es.addEventListener('snapshot', (e) => {
        setConnected(true);
        try {
          setSnap(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
        } catch {
          /* ignore a malformed event */
        }
      });
      es.onerror = () => {
        setConnected(false);
        if (!snap) void fallback();
      };
    }
    return () => {
      cancelled = true;
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section aria-labelledby="live-h" className={cn('surface overflow-hidden', className)} data-testid="live-feed">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        <h2 id="live-h" className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <span className="relative flex size-2" aria-hidden="true">
            <span className={cn('absolute inline-flex size-full rounded-full motion-reduce:hidden', connected && 'animate-ping bg-positive/60')} />
            <span className={cn('relative inline-flex size-2 rounded-full', connected ? 'bg-positive' : 'bg-ink-500')} />
          </span>
          Live
        </h2>
        <div className="flex items-center gap-4 text-xs text-ink-300">
          <span data-testid="live-online">
            <span className="num font-semibold text-ink-100">{snap ? snap.online.toLocaleString('en-US') : '—'}</span> online
          </span>
          {snap?.table && (
            <Link href="/games/roulette" className="flex items-center gap-1.5 hover:text-ink-100" data-testid="live-table">
              Table
              <span className={cn('num grid size-6 place-items-center rounded-full text-[11px] font-bold text-white', snap.table.color === 'red' ? 'bg-roulette-red' : snap.table.color === 'green' ? 'bg-roulette-green' : 'bg-roulette-black ring-1 ring-white/20')}>
                {snap.table.result}
              </span>
            </Link>
          )}
        </div>
      </div>
      <div className="px-5 py-3">
        {!snap ? (
          <p className="text-sm text-ink-400">Connecting…</p>
        ) : snap.wins.length === 0 ? (
          <p className="text-sm text-ink-400">No big wins in the last 24 hours yet.</p>
        ) : (
          <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="Recent big wins" data-testid="live-wins">
            {snap.wins.map((w, i) => (
              <li key={`${w.at}-${i}`} className="min-w-[11rem] shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-400">
                  <Link href={`/games/${w.gameId}`} className="truncate hover:text-gold-300">
                    {w.game}
                  </Link>
                  <span>{ago(w.at)}</span>
                </div>
                <div className="num mt-0.5 text-lg font-semibold text-gold-200">{(w.multiplierE2 / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}×</div>
                <div className="truncate text-xs text-ink-300">
                  {w.player} · <span className="num">{formatChips(w.payout)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
