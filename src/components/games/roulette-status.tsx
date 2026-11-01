'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { BETTING_MS, BETTING_SECONDS, countdownWarning, secondsLeft, type Cycle } from './roulette-cycle';
import { cycleNow } from './use-roulette-cycle';

const PHASE_LABEL: Record<Cycle['phase'], string> = {
  BETTING_OPEN: 'Place your bets',
  BETTING_CLOSED: 'No more bets',
  SPINNING: 'No more bets — spinning',
  RESULT_REVEAL: 'Result',
  RECOVERY: 'Connection interrupted',
};

/**
 * The table's phase and the betting countdown. Re-renders only itself a few
 * times a second; plays the warning for the last seconds (once per second,
 * only with bets on the table).
 */
export function RouletteStatus({ cycle, hasBets, wagerPending, onWarn, note }: { cycle: Cycle | null; hasBets: boolean; wagerPending: boolean; onWarn: () => void; note?: string | null }) {
  const [now, setNow] = useState(() => cycleNow());
  const open = cycle?.phase === 'BETTING_OPEN';
  useEffect(() => {
    if (!open) return;
    setNow(cycleNow());
    const id = setInterval(() => setNow(cycleNow()), 200);
    return () => clearInterval(id);
  }, [open, cycle?.window, cycle?.closesAt]);

  const secs = cycle ? secondsLeft(cycle, now) : null;
  const prev = useRef<number | null>(null);
  const warn = useRef(onWarn);
  warn.current = onWarn;
  useEffect(() => {
    if (countdownWarning(prev.current, secs, hasBets)) warn.current();
    prev.current = secs;
  }, [secs, hasBets]);

  const leftMs = cycle && open ? (cycle.closesAt !== null ? Math.max(0, cycle.closesAt - now) : (cycle.pausedLeft ?? BETTING_MS)) : 0;
  const fraction = open ? Math.min(1, leftMs / BETTING_MS) : 0;
  const urgent = open && secs !== null && secs <= 3;
  const label = !cycle ? 'Opening the table…' : cycle.phase === 'BETTING_CLOSED' && !cycle.wager ? 'Betting closed' : PHASE_LABEL[cycle.phase];
  const paused = open && cycle?.closesAt === null;

  return (
    <div className="space-y-2" data-testid="roulette-status" data-phase={cycle?.phase ?? 'STARTING'} data-window={cycle?.window ?? 0}>
      <div className="flex items-end justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          <div className={cn('text-[11px] font-semibold uppercase tracking-[0.2em]', open ? 'text-gold-300' : 'text-ink-300')} data-testid="roulette-phase">
            {label}
          </div>
          <div className="mt-0.5 text-xs text-ink-400">
            {open
              ? paused
                ? 'Paused while this tab is hidden'
                : hasBets
                  ? 'Your bets go in automatically when time runs out'
                  : 'Bets close automatically — no chips, no spin for you'
              : cycle?.phase === 'BETTING_CLOSED'
                ? wagerPending
                  ? 'Sending your bets…'
                  : (note ?? 'No bets this round — the next round opens shortly')
                : cycle?.phase === 'SPINNING'
                  ? 'The result is already drawn by the server'
                  : cycle?.phase === 'RESULT_REVEAL'
                    ? 'Next betting round opens shortly'
                    : cycle?.phase === 'RECOVERY'
                      ? 'Your bets are kept until this is resolved'
                      : ''}
          </div>
        </div>
        <div
          role="timer"
          aria-label={open && secs !== null ? `${secs} seconds left to bet` : 'Betting closed'}
          className={cn('num grid size-14 shrink-0 place-items-center rounded-full border-2 text-2xl font-semibold tabular-nums transition-colors duration-300', urgent ? 'border-negative/70 text-[#ff9b93]' : open ? 'border-gold-500/70 text-gold-200' : 'border-ink-600 text-ink-400')}
          data-testid="roulette-countdown"
          data-seconds={secs ?? ''}
        >
          {open && secs !== null ? secs : '–'}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-800" aria-hidden="true">
        <div className={cn('h-full rounded-full transition-[width] duration-200 ease-linear', urgent ? 'bg-negative/80' : 'bg-gold-500')} style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="sr-only">Each betting round lasts {BETTING_SECONDS} seconds.</p>
    </div>
  );
}
