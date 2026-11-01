/**
 * The automatic roulette table cycle, as a pure state machine.
 *
 *   BETTING_OPEN ──(time up, valid bets)──▶ BETTING_CLOSED (wager) ──(server round)──▶ SPINNING
 *        ▲   │                                   │                                     │
 *        │   └──(time up, no valid bets)──▶ BETTING_CLOSED (no wager, short pause) ─┐  │(wheel landed)
 *        │                                       │(request failed)                  │  ▼
 *        ├──────────────(pause over)─────────────┼──────────────────────────────────┘ RESULT_REVEAL
 *        │                                       ▼                                     │
 *        ├──(no round outstanding)────────── RECOVERY ──(retried: server round)──▶ SPINNING
 *        └──────────────────────────(result shown long enough)─────────────────────────┘
 *
 * Only automatic *timing* lives here: the cycle never wagers on its own. A
 * wager is submitted (by the screen, once per betting window) only when the
 * player's own board is valid and non-empty when betting closes; an empty
 * board closes without any request. Outcomes always come from the server.
 *
 * Times are absolute timestamps (ms), so a late or throttled timer can never
 * add time or skip a phase; it only notices the deadline later. While the
 * page is hidden, an open betting window pauses (and resumes with at least
 * a few seconds) so that bets never close unseen.
 */

/** Length of each betting window. */
export const BETTING_SECONDS = 15;
export const BETTING_MS = BETTING_SECONDS * 1000;
/** Pause after a window closes without a wager, before the next one opens. */
export const NO_WAGER_PAUSE_MS = 2500;
/** How long a settled result stays on show before betting reopens. */
export const RESULT_MS = 5000;
/** Minimum time left when a paused window resumes after the page was hidden. */
export const RESUME_MIN_MS = 5000;
/** Last seconds of a window that sound a warning (only when bets are on the table). */
export const WARNING_SECONDS = 3;

export type Phase = 'BETTING_OPEN' | 'BETTING_CLOSED' | 'SPINNING' | 'RESULT_REVEAL' | 'RECOVERY';

export interface Cycle {
  phase: Phase;
  /** Number of the current or last betting window (1, 2, …). */
  window: number;
  /** BETTING_OPEN: when betting closes (null while paused). */
  closesAt: number | null;
  /** BETTING_OPEN while the page is hidden: time left when it was paused. */
  pausedLeft: number | null;
  /** BETTING_CLOSED without a wager, and RESULT_REVEAL: when betting reopens. */
  reopenAt: number | null;
  /** BETTING_CLOSED: whether this window's bets are being submitted. */
  wager: boolean;
  /** SPINNING and RESULT_REVEAL: the server round being shown. */
  roundId: string | null;
  /** Whether the page is hidden. */
  hidden: boolean;
}

export type CycleEvent =
  /** Time passes. `canWager`: the player's board is valid, non-empty and allowed to be sent. */
  | { type: 'TICK'; now: number; canWager: boolean }
  | { type: 'HIDDEN'; now: number }
  | { type: 'VISIBLE'; now: number }
  /** The server returned the round for this window's wager (or for a recovered request). */
  | { type: 'ROUND_RECEIVED'; roundId: string }
  /** The wager request failed; the screen decides recovery from useRound's state. */
  | { type: 'REQUEST_FAILED' }
  /** At the moment of sending, the board was no longer valid: nothing was sent. */
  | { type: 'WAGER_SKIPPED'; now: number }
  /** An interrupted request is outstanding (e.g. found after a reload). */
  | { type: 'RECOVERY_NEEDED' }
  /** No request is outstanding any more (definitive error or discarded): reopen betting. */
  | { type: 'RECOVERY_RESOLVED'; now: number }
  /** The wheel has landed on this round's result. */
  | { type: 'LANDED'; roundId: string; now: number };

function open(s: Cycle, now: number): Cycle {
  return {
    ...s,
    phase: 'BETTING_OPEN',
    window: s.window + 1,
    closesAt: s.hidden ? null : now + BETTING_MS,
    pausedLeft: s.hidden ? BETTING_MS : null,
    reopenAt: null,
    wager: false,
    roundId: null,
  };
}

/** The cycle as the player enters: betting is open at once. */
export function initialCycle(now: number, hidden = false): Cycle {
  return open({ phase: 'BETTING_OPEN', window: 0, closesAt: null, pausedLeft: null, reopenAt: null, wager: false, roundId: null, hidden }, now);
}

/**
 * Applies an event. Events that do not fit the current phase are ignored and
 * the same object is returned, so a timer or animation callback that fires
 * twice cannot advance the cycle twice.
 */
export function reduceCycle(s: Cycle, e: CycleEvent): Cycle {
  switch (e.type) {
    case 'TICK':
      if (s.phase === 'BETTING_OPEN' && s.closesAt !== null && e.now >= s.closesAt) {
        return { ...s, phase: 'BETTING_CLOSED', closesAt: null, wager: e.canWager, reopenAt: e.canWager ? null : e.now + NO_WAGER_PAUSE_MS };
      }
      if ((s.phase === 'RESULT_REVEAL' || (s.phase === 'BETTING_CLOSED' && !s.wager)) && s.reopenAt !== null && e.now >= s.reopenAt) return open(s, e.now);
      return s;
    case 'HIDDEN':
      if (s.hidden) return s;
      if (s.phase === 'BETTING_OPEN' && s.closesAt !== null) return { ...s, hidden: true, closesAt: null, pausedLeft: Math.max(0, s.closesAt - e.now) };
      return { ...s, hidden: true };
    case 'VISIBLE':
      if (!s.hidden) return s;
      if (s.phase === 'BETTING_OPEN' && s.pausedLeft !== null) return { ...s, hidden: false, pausedLeft: null, closesAt: e.now + Math.max(RESUME_MIN_MS, s.pausedLeft) };
      return { ...s, hidden: false };
    case 'ROUND_RECEIVED':
      if ((s.phase === 'BETTING_CLOSED' && s.wager) || s.phase === 'RECOVERY') return { ...s, phase: 'SPINNING', roundId: e.roundId, wager: false, reopenAt: null };
      return s;
    case 'REQUEST_FAILED':
      if (s.phase === 'BETTING_CLOSED' && s.wager) return { ...s, phase: 'RECOVERY', wager: false };
      return s;
    case 'WAGER_SKIPPED':
      if (s.phase === 'BETTING_CLOSED' && s.wager) return { ...s, wager: false, reopenAt: e.now + NO_WAGER_PAUSE_MS };
      return s;
    case 'RECOVERY_NEEDED':
      if (s.phase === 'BETTING_OPEN' || (s.phase === 'BETTING_CLOSED' && !s.wager)) return { ...s, phase: 'RECOVERY', closesAt: null, pausedLeft: null, reopenAt: null };
      return s;
    case 'RECOVERY_RESOLVED':
      if (s.phase === 'RECOVERY') return open(s, e.now);
      return s;
    case 'LANDED':
      if (s.phase === 'SPINNING' && s.roundId === e.roundId) return { ...s, phase: 'RESULT_REVEAL', reopenAt: e.now + RESULT_MS };
      return s;
  }
}

/** Whole seconds left in an open window (what the countdown shows). */
export function secondsLeft(s: Cycle, now: number): number | null {
  if (s.phase !== 'BETTING_OPEN') return null;
  const left = s.closesAt !== null ? s.closesAt - now : s.pausedLeft;
  return left === null ? null : Math.max(0, Math.ceil(left / 1000));
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
