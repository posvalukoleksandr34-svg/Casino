/**
 * The automatic roulette table, as seen by one player: a pure state machine
 * that follows the server's shared table schedule
 * (src/engine/games/roulette/table.ts).
 *
 *   BETTING_OPEN ─(close)→ BETTING_CLOSED ─┬─ wager:  the player's own bets → their round (server) ─┐
 *        ▲                                 └─ none:   the table's spin for this slot (server) ──────┤
 *        │                                                                                           ▼
 *        │                          RECOVERY ←─(request failed)        SPINNING ─(wheel landed)→ RESULT_REVEAL
 *        └─────────────────────(join the next slot when the result has been shown)───────────────────┘
 *
 * **Every window ends in exactly one spin.** With valid bets, it is the
 * player's own round (sent once through the round API). Without bets, it is
 * the table's spectator spin: a server-generated result that moves no chips.
 * The browser never invents a result: if the table spin cannot be fetched,
 * the window ends without a spin and says so.
 *
 * Times are server-clock milliseconds. Every event is accepted only in its
 * own phase, so a timer or animation callback that fires twice cannot
 * advance the table twice. Re-entering the page joins the current slot.
 */
import { slotAt, slotTimes, TABLE_BETTING_MS } from '@/engine/games/roulette/table';

export const BETTING_SECONDS = TABLE_BETTING_MS / 1000;
/** A betting window is joined only with at least this much time left. */
export const MIN_JOIN_BETTING_MS = 3000;
/** Shortly after a close, a newcomer still watches that slot's spin. */
export const JOIN_SPECTATE_MS = 2500;
/** A result stays on show at least this long. */
export const MIN_RESULT_MS = 3000;
/** Last seconds of a window that sound a warning (only when bets are on the table). */
export const WARNING_SECONDS = 3;

export type Phase = 'BETTING_OPEN' | 'BETTING_CLOSED' | 'SPINNING' | 'RESULT_REVEAL' | 'RECOVERY';

export type CycleSpin = { key: string; kind: 'wager'; roundId: string } | { key: string; kind: 'table'; slot: number; result: number };

export interface Cycle {
  phase: Phase;
  /** The table slot this window belongs to. */
  slot: number;
  /** When betting for `slot` closes (server time). */
  closesAt: number;
  /** BETTING_CLOSED: whether the player's bets are being submitted (else: the table spin). */
  wager: boolean;
  /** SPINNING and RESULT_REVEAL: the spin being shown (null: none could be shown). */
  spin: CycleSpin | null;
  /** RESULT_REVEAL: when the next window is joined. */
  revealUntil: number | null;
  /** Why a window ended without a spin. */
  notice: 'TABLE_UNAVAILABLE' | null;
  hidden: boolean;
}

export type CycleEvent =
  /** Time passes. `canWager`: the player's board is valid, non-empty and may be sent now. */
  | { type: 'TICK'; now: number; canWager: boolean }
  | { type: 'HIDDEN' }
  | { type: 'VISIBLE' }
  /** The server revealed the table spin for this slot (no wager this window). */
  | { type: 'TABLE_RESULT'; slot: number; result: number }
  /** The table spin could not be fetched in time: no spin is shown (never a made-up one). */
  | { type: 'TABLE_FAILED'; slot: number; now: number }
  /** The server returned the round for the player's wager (or a recovered request). */
  | { type: 'ROUND_RECEIVED'; roundId: string }
  /** The wager request failed; the screen decides recovery from useRound's state. */
  | { type: 'REQUEST_FAILED' }
  /** At the moment of sending, the board was no longer valid: nothing was sent. */
  | { type: 'WAGER_SKIPPED' }
  /** An interrupted request is outstanding (e.g. found after a reload). */
  | { type: 'RECOVERY_NEEDED' }
  /** No request is outstanding any more: rejoin the table. */
  | { type: 'RECOVERY_RESOLVED'; now: number }
  /** The wheel has landed on this spin's result. */
  | { type: 'LANDED'; key: string; now: number };

/** Joins the table at `now`: betting if enough of the window is left, else this slot's spin, else the next slot. */
export function joinTable(now: number, prev?: Pick<Cycle, 'hidden'>): Cycle {
  const t = slotAt(now);
  const base = { slot: t.slot, closesAt: t.closesAt, wager: false, spin: null, notice: null, hidden: prev?.hidden ?? false } as const;
  if (now < t.closesAt - MIN_JOIN_BETTING_MS) return { ...base, phase: 'BETTING_OPEN', revealUntil: null };
  if (now < t.closesAt + JOIN_SPECTATE_MS) return { ...base, phase: 'BETTING_CLOSED', revealUntil: null };
  return { ...base, phase: 'RESULT_REVEAL', revealUntil: t.endsAt };
}

/**
 * Applies an event. Events that do not fit the current phase are ignored and
 * the same object is returned.
 */
export function reduceCycle(s: Cycle, e: CycleEvent): Cycle {
  switch (e.type) {
    case 'TICK': {
      if (s.phase === 'BETTING_OPEN' && e.now >= s.closesAt) return { ...s, phase: 'BETTING_CLOSED', wager: e.canWager };
      // A spectator window whose spin never arrived (e.g. a long-hidden tab): move on.
      if (s.phase === 'BETTING_CLOSED' && !s.wager && e.now >= slotTimes(s.slot).endsAt) return joinTable(e.now, s);
      if (s.phase === 'RESULT_REVEAL' && s.revealUntil !== null && e.now >= s.revealUntil) return joinTable(e.now, s);
      return s;
    }
    case 'HIDDEN':
      return s.hidden ? s : { ...s, hidden: true };
    case 'VISIBLE':
      return s.hidden ? { ...s, hidden: false } : s;
    case 'TABLE_RESULT':
      if (s.phase === 'BETTING_CLOSED' && !s.wager && s.slot === e.slot) {
        return { ...s, phase: 'SPINNING', spin: { key: `table:${e.slot}`, kind: 'table', slot: e.slot, result: e.result } };
      }
      return s;
    case 'TABLE_FAILED':
      if (s.phase === 'BETTING_CLOSED' && !s.wager && s.slot === e.slot) {
        return { ...s, phase: 'RESULT_REVEAL', spin: null, notice: 'TABLE_UNAVAILABLE', revealUntil: Math.max(e.now + MIN_RESULT_MS, slotTimes(s.slot).endsAt) };
      }
      return s;
    case 'ROUND_RECEIVED':
      if ((s.phase === 'BETTING_CLOSED' && s.wager) || s.phase === 'RECOVERY') return { ...s, phase: 'SPINNING', wager: false, spin: { key: e.roundId, kind: 'wager', roundId: e.roundId } };
      return s;
    case 'REQUEST_FAILED':
      if (s.phase === 'BETTING_CLOSED' && s.wager) return { ...s, phase: 'RECOVERY', wager: false };
      return s;
    case 'WAGER_SKIPPED':
      if (s.phase === 'BETTING_CLOSED' && s.wager) return { ...s, wager: false };
      return s;
    case 'RECOVERY_NEEDED':
      if (s.phase === 'BETTING_OPEN' || (s.phase === 'BETTING_CLOSED' && !s.wager)) return { ...s, phase: 'RECOVERY', wager: false };
      return s;
    case 'RECOVERY_RESOLVED':
      return s.phase === 'RECOVERY' ? joinTable(e.now, s) : s;
    case 'LANDED':
      if (s.phase === 'SPINNING' && s.spin?.key === e.key) return { ...s, phase: 'RESULT_REVEAL', revealUntil: Math.max(e.now + MIN_RESULT_MS, slotTimes(s.slot).endsAt) };
      return s;
  }
}

/** Whole seconds left in an open window (what the countdown shows). */
export function secondsLeft(s: Cycle, now: number): number | null {
  if (s.phase !== 'BETTING_OPEN') return null;
  return Math.max(0, Math.ceil((s.closesAt - now) / 1000));
}

/**
 * Whether the countdown warning sounds when the display changes from
 * `prev` to `next` seconds: once per second for the last few seconds, and
 * only when the player has bets on the table.
 */
export function countdownWarning(prev: number | null, next: number | null, hasBets: boolean): boolean {
  return hasBets && next !== null && next !== prev && next >= 1 && next <= WARNING_SECONDS;
}

/** Whether chips may be placed, removed or changed. */
export const bettingOpen = (s: Cycle) => s.phase === 'BETTING_OPEN';
