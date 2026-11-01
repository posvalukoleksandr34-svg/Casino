'use client';

import { cn } from '@/lib/cn';
import type { TableSpin } from './use-roulette-cycle';

const BG = { red: 'bg-roulette-red', black: 'bg-roulette-black', green: 'bg-roulette-green' } as const;

/**
 * The table's public spin history (spectator spins: server results shown when
 * no wager was placed), newest first. Not a player's history and not a
 * prediction of anything.
 */
export function RouletteTableStrip({ spins, loading }: { spins: TableSpin[] | null; loading: boolean }) {
  const latest = (spins ?? []).slice(0, 20);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">Table</span>
      <ol className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 [scrollbar-width:thin]" aria-label="Latest table spins, newest first (spins without wagers, drawn by the server)" data-testid="roulette-table-strip">
        {spins === null ? (
          loading ? (
            Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton size-7 shrink-0 rounded-full" />)
          ) : (
            <li className="text-xs text-ink-400">Table history unavailable.</li>
          )
        ) : latest.length === 0 ? (
          <li className="text-xs text-ink-400">Table spins will appear here.</li>
        ) : (
          latest.map((s, i) => (
            <li
              key={s.slot}
              data-slot={s.slot}
              data-result={s.result}
              title={`${s.result} ${s.color} · ${new Date(s.closedAt).toLocaleTimeString()} · table spin`}
              aria-label={`${s.result} ${s.color}, ${new Date(s.closedAt).toLocaleTimeString()}`}
              className={cn(
                'num grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold text-ink-100',
                BG[s.color],
                s.color === 'black' ? 'border-ink-500' : 'border-white/15',
                i === 0 && 'ring-2 ring-gold-400/70 ring-offset-1 ring-offset-ink-900',
              )}
            >
              {s.result}
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
