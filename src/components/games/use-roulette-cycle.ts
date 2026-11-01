'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initialCycle, reduceCycle, type Cycle, type CycleEvent } from './roulette-cycle';

/** Monotonic milliseconds (unaffected by wall-clock changes). */
export const cycleNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const TICK_MS = 200;

/**
 * Runs the automatic roulette cycle: one interval ticks the state machine,
 * and page visibility pauses an open betting window. Everything is torn down
 * on unmount. `canWager` is read at the moment betting closes.
 *
 * The cycle starts after mount (not during server rendering), so the
 * countdown always begins when the player actually sees the table.
 */
export function useRouletteCycle(canWager: boolean): [Cycle | null, (e: CycleEvent) => void] {
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const canWagerRef = useRef(canWager);
  canWagerRef.current = canWager;

  const dispatch = useCallback((e: CycleEvent) => setCycle((c) => (c ? reduceCycle(c, e) : c)), []);

  useEffect(() => {
    setCycle(initialCycle(cycleNow(), document.visibilityState === 'hidden'));
    const id = setInterval(() => dispatch({ type: 'TICK', now: cycleNow(), canWager: canWagerRef.current }), TICK_MS);
    const onVisibility = () => dispatch(document.visibilityState === 'hidden' ? { type: 'HIDDEN', now: cycleNow() } : { type: 'VISIBLE', now: cycleNow() });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dispatch]);

  return [cycle, dispatch];
}
