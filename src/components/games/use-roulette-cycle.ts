'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { joinTable, reduceCycle, type Cycle, type CycleEvent } from './roulette-cycle';

export interface TableSpin {
  slot: number;
  result: number;
  color: 'red' | 'black' | 'green';
  closedAt: string;
  day: string;
  serverSeedHash: string;
}

export interface TableInfo {
  serverNow: string;
  schedule: { epoch: number; bettingMs: number; spinMs: number; resultMs: number; cycleMs: number; clientSeed: string };
  commitments: { day: string; serverSeedHash: string }[];
  recent: TableSpin[];
}

const TICK_MS = 200;

/**
 * The shared table: its schedule, the server clock (the offset is learned
 * from each response, halfway through the request) and the public history of
 * table spins. Retries quietly until the table answers.
 */
export function useRouletteTable() {
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const offset = useRef(0);

  const refresh = useCallback(async () => {
    const t0 = Date.now();
    const res = await api<TableInfo>('/api/roulette/table');
    const t1 = Date.now();
    offset.current = Date.parse(res.serverNow) - (t0 + t1) / 2;
    setInfo(res);
    setFailed(false);
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      refresh().catch(() => {
        if (cancelled) return;
        setFailed(true);
        timer = setTimeout(load, 5000);
      });
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  /** Server time now (ms). */
  const now = useCallback(() => Date.now() + offset.current, []);

  /** Adds a spin the server just revealed (deduplicated by slot, newest first). */
  const remember = useCallback((spin: TableSpin) => {
    setInfo((i) => (i ? { ...i, recent: [spin, ...i.recent.filter((s) => s.slot !== spin.slot)].sort((a, b) => b.slot - a.slot).slice(0, 50) } : i));
  }, []);

  return { info, failed, refresh, now, remember };
}

/**
 * Runs the table cycle for this player: it starts when the table's clock is
 * known, one interval ticks the state machine, and visibility changes are
 * reported. Everything is torn down on unmount. `canWager` is read at the
 * moment betting closes.
 */
export function useRouletteCycle(canWager: boolean, ready: boolean, now: () => number): [Cycle | null, (e: CycleEvent) => void] {
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const canWagerRef = useRef(canWager);
  canWagerRef.current = canWager;

  const dispatch = useCallback((e: CycleEvent) => setCycle((c) => (c ? reduceCycle(c, e) : c)), []);

  useEffect(() => {
    if (!ready) return;
    setCycle((c) => c ?? joinTable(now(), { hidden: document.visibilityState === 'hidden' }));
    // Bets are never sent from a background tab: a window that closes unseen is watched, not wagered.
    const id = setInterval(() => dispatch({ type: 'TICK', now: now(), canWager: canWagerRef.current && document.visibilityState !== 'hidden' }), TICK_MS);
    const onVisibility = () => dispatch(document.visibilityState === 'hidden' ? { type: 'HIDDEN' } : { type: 'VISIBLE' });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, now, dispatch]);

  return [cycle, dispatch];
}
