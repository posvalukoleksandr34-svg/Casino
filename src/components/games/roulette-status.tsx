'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { BETTING_SECONDS, countdownWarning, secondsLeft, type Cycle } from './roulette-cycle';
import { TABLE_BETTING_MS } from '@/engine/games/roulette/table';

/**
 * The table's phase and the large betting countdown. Re-renders only itself
 * a few times a second; plays the warning for the last seconds (once per
 * second, only with bets on the table).
 */
export function RouletteStatus({
  cycle,
  now,
  hasBets,
  wagerPending,
  onWarn,
  note,
  connecting,
  failure,
}: {
  cycle: Cycle | null;
  now: () => number;
  hasBets: boolean;
  wagerPending: boolean;
  onWarn: () => void;
  note?: string | null;
  connecting: boolean;
  failure?: string | null;
}) {
  const [t, setT] = useState(() => now());
  const open = cycle?.phase === 'BETTING_OPEN';
  useEffect(() => {
    if (!open) return;
    setT(now());
    const id = setInterval(() => setT(now()), 200);
    return () => clearInterval(id);
  }, [open, cycle?.slot, now]);

  const secs = cycle ? secondsLeft(cycle, t) : null;
  const prev = useRef<number | null>(null);
  const warn = useRef(onWarn);
  warn.current = onWarn;
  useEffect(() => {
    if (countdownWarning(prev.current, secs, hasBets)) warn.current();
    prev.current = secs;
  }, [secs, hasBets]);

  const leftMs = cycle && open ? Math.max(0, cycle.closesAt - t) : 0;
  const fraction = open ? Math.min(1, leftMs / TABLE_BETTING_MS) : 0;
  const urgent = open && secs !== null && secs <= 3;
  const tableSpin = cycle?.spin?.kind === 'table';

  let label: string;
  let detail: string;
  if (!cycle) {
    label = connecting ? 'Connecting to the table…' : 'Table unavailable';
    detail = connecting ? '' : failure ? `${failure} Retrying in a moment.` : 'Retrying in a moment';
  } else
    switch (cycle.phase) {
      case 'BETTING_OPEN':
        label = 'Place your bets';
        detail = hasBets ? 'Your bets go in automatically when time runs out' : 'No chips, no wager — the wheel spins anyway';
        break;
      case 'BETTING_CLOSED':
        label = 'No more bets';
        detail = cycle.wager ? (wagerPending ? 'Sending your bets…' : 'Your bets are in') : (note ?? 'No bets from you this round — watching the table spin');
        break;
      case 'SPINNING':
        label = 'No more bets — spinning';
        detail = tableSpin ? 'Table spin: the result was drawn by the server; nothing is wagered' : 'Your spin: the result was drawn by the server';
        break;
      case 'RESULT_REVEAL':
        label = cycle.notice === 'TABLE_UNAVAILABLE' ? 'No spin this round' : cycle.spin ? 'Result' : 'Next round shortly';
        detail = cycle.notice === 'TABLE_UNAVAILABLE' ? 'The table result could not be loaded — nothing was made up. Next round shortly.' : 'Next betting round opens automatically';
        break;
      case 'RECOVERY':
        label = 'Connection interrupted';
        detail = 'Your bets are kept until this is resolved';
        break;
    }

  return (
    <div className="flex items-center gap-4" data-testid="roulette-status" data-phase={cycle?.phase ?? 'STARTING'} data-slot={cycle?.slot ?? ''} data-spin={cycle?.spin?.kind ?? ''}>
      <div
        role="timer"
        aria-label={open && secs !== null ? `${secs} seconds left to bet` : 'Betting closed'}
        className={cn(
          'relative grid size-20 shrink-0 place-items-center rounded-full sm:size-24',
          'bg-[radial-gradient(circle_at_35%_30%,#2a2c33,#0b0c0f_70%)] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)]',
        )}
        data-testid="roulette-countdown"
        data-seconds={secs ?? ''}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={urgent ? '#e06a62' : '#d9bb76'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(fraction * 2 * Math.PI * 45).toFixed(2)} 1000`}
            className="transition-[stroke-dasharray] duration-200 ease-linear"
          />
        </svg>
        <span className={cn('num relative text-3xl font-bold tabular-nums sm:text-4xl', urgent ? 'text-[#ff9b93]' : open ? 'text-gold-100' : 'text-ink-400')}>{open && secs !== null ? secs : '–'}</span>
      </div>
      <div className="min-w-0" aria-live="polite" aria-atomic="true">
        <div className={cn('font-display text-2xl font-semibold leading-tight sm:text-3xl', open ? 'text-gold-200' : 'text-ink-100')} data-testid="roulette-phase">
          {label}
        </div>
        <div className="mt-1 text-sm text-ink-300">{detail}</div>
      </div>
      <p className="sr-only">Each betting round lasts {BETTING_SECONDS} seconds; the wheel spins after every round.</p>
    </div>
  );
}
