import { describe, expect, it } from 'vitest';
import {
  BETTING_MS,
  BETTING_SECONDS,
  countdownWarning,
  initialCycle,
  NO_WAGER_PAUSE_MS,
  reduceCycle,
  RESULT_MS,
  RESUME_MIN_MS,
  secondsLeft,
  type Cycle,
  type CycleEvent,
} from '@/components/games/roulette-cycle';
import { CHIP_DENOMINATIONS, coverageCounts, coveredNumbers, EMPTY_BOARD, placeChip } from '@/components/games/roulette-board';
import { betWins, RED_NUMBERS, type RouletteBet } from '@/engine/games/roulette';

const run = (s: Cycle, ...events: CycleEvent[]) => events.reduce(reduceCycle, s);
const tick = (now: number, canWager = false): CycleEvent => ({ type: 'TICK', now, canWager });

describe('automatic roulette cycle', () => {
  it('opens betting immediately with the configured duration', () => {
    expect(BETTING_SECONDS).toBe(15);
    const s = initialCycle(1000);
    expect(s).toMatchObject({ phase: 'BETTING_OPEN', window: 1, closesAt: 1000 + BETTING_MS });
    expect(secondsLeft(s, 1000)).toBe(15);
    expect(secondsLeft(s, 1000 + BETTING_MS - 1)).toBe(1);
    expect(secondsLeft(s, 1000 + BETTING_MS)).toBe(0);
  });

  it('closes at zero; with valid bets it waits for exactly one server round; without, it reopens with no round', () => {
    const s = initialCycle(0);
    expect(reduceCycle(s, tick(BETTING_MS - 1, true))).toBe(s); // not yet
    const closed = reduceCycle(s, tick(BETTING_MS, true));
    expect(closed).toMatchObject({ phase: 'BETTING_CLOSED', wager: true, reopenAt: null });
    // With a wager outstanding, time alone never reopens betting.
    expect(reduceCycle(closed, tick(BETTING_MS * 10, true))).toBe(closed);

    const empty = reduceCycle(s, tick(BETTING_MS, false));
    expect(empty).toMatchObject({ phase: 'BETTING_CLOSED', wager: false, reopenAt: BETTING_MS + NO_WAGER_PAUSE_MS });
    expect(reduceCycle(empty, { type: 'ROUND_RECEIVED', roundId: 'x' })).toBe(empty); // no wager → no round accepted
    const next = reduceCycle(empty, tick(BETTING_MS + NO_WAGER_PAUSE_MS));
    expect(next).toMatchObject({ phase: 'BETTING_OPEN', window: 2, closesAt: BETTING_MS + NO_WAGER_PAUSE_MS + BETTING_MS });
  });

  it('runs a full round: spin → result → next window, and ignores duplicate callbacks', () => {
    let s = run(initialCycle(0), tick(BETTING_MS, true), { type: 'ROUND_RECEIVED', roundId: 'r1' });
    expect(s).toMatchObject({ phase: 'SPINNING', roundId: 'r1' });
    // A second "round received" (e.g. a repeated callback) cannot start another spin.
    expect(reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: 'r2' })).toBe(s);
    // Landing for another round is ignored.
    expect(reduceCycle(s, { type: 'LANDED', roundId: 'other', now: 5 })).toBe(s);
    s = reduceCycle(s, { type: 'LANDED', roundId: 'r1', now: 20_000 });
    expect(s).toMatchObject({ phase: 'RESULT_REVEAL', reopenAt: 20_000 + RESULT_MS });
    // The wheel reporting twice changes nothing.
    expect(reduceCycle(s, { type: 'LANDED', roundId: 'r1', now: 20_100 })).toBe(s);
    expect(reduceCycle(s, tick(20_000 + RESULT_MS - 1))).toBe(s);
    s = reduceCycle(s, tick(20_000 + RESULT_MS));
    expect(s).toMatchObject({ phase: 'BETTING_OPEN', window: 2, roundId: null, wager: false });
  });

  it('never enters two phases at once: each event is accepted only in its own phase', () => {
    const phases: Cycle['phase'][] = [];
    let s = initialCycle(0);
    const events: CycleEvent[] = [
      { type: 'LANDED', roundId: 'r', now: 1 },
      { type: 'REQUEST_FAILED' },
      { type: 'RECOVERY_RESOLVED', now: 1 },
      tick(BETTING_MS, true),
      tick(BETTING_MS, true),
      { type: 'RECOVERY_NEEDED' },
      { type: 'ROUND_RECEIVED', roundId: 'r' },
      { type: 'ROUND_RECEIVED', roundId: 'r' },
      tick(BETTING_MS * 3, true),
      { type: 'LANDED', roundId: 'r', now: BETTING_MS * 3 },
    ];
    for (const e of events) {
      s = reduceCycle(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(['BETTING_OPEN', 'BETTING_OPEN', 'BETTING_OPEN', 'BETTING_CLOSED', 'BETTING_CLOSED', 'BETTING_CLOSED', 'SPINNING', 'SPINNING', 'SPINNING', 'RESULT_REVEAL']);
  });

  it('a failed request goes to recovery; betting reopens only when nothing is outstanding, or a retry delivers the round', () => {
    const failed = run(initialCycle(0), tick(BETTING_MS, true), { type: 'REQUEST_FAILED' });
    expect(failed.phase).toBe('RECOVERY');
    expect(reduceCycle(failed, tick(BETTING_MS * 20, true))).toBe(failed); // time never ends recovery
    expect(reduceCycle(failed, { type: 'ROUND_RECEIVED', roundId: 'r' })).toMatchObject({ phase: 'SPINNING', roundId: 'r' });
    expect(reduceCycle(failed, { type: 'RECOVERY_RESOLVED', now: 99 })).toMatchObject({ phase: 'BETTING_OPEN', window: 2, closesAt: 99 + BETTING_MS });
    // An interrupted request found while betting is open stops the window.
    expect(reduceCycle(initialCycle(0), { type: 'RECOVERY_NEEDED' })).toMatchObject({ phase: 'RECOVERY', closesAt: null });
  });

  it('skips a wager that became invalid at the moment of sending (nothing sent, short pause)', () => {
    const s = run(initialCycle(0), tick(BETTING_MS, true), { type: 'WAGER_SKIPPED', now: BETTING_MS });
    expect(s).toMatchObject({ phase: 'BETTING_CLOSED', wager: false, reopenAt: BETTING_MS + NO_WAGER_PAUSE_MS });
  });

  it('pauses an open window while the page is hidden and resumes with a minimum, unaffected by throttled timers', () => {
    let s = initialCycle(0);
    s = reduceCycle(s, { type: 'HIDDEN', now: BETTING_MS - 2000 });
    expect(s).toMatchObject({ closesAt: null, pausedLeft: 2000, hidden: true });
    // However late the next tick arrives, a paused window does not close.
    expect(reduceCycle(s, tick(BETTING_MS * 100, true)).phase).toBe('BETTING_OPEN');
    expect(secondsLeft(s, 1e9)).toBe(2);
    s = reduceCycle(s, { type: 'VISIBLE', now: 500_000 });
    expect(s).toMatchObject({ hidden: false, closesAt: 500_000 + RESUME_MIN_MS });
    // A window that opens while hidden starts paused with the full duration.
    const result = run(initialCycle(0), tick(BETTING_MS, true), { type: 'ROUND_RECEIVED', roundId: 'r' }, { type: 'LANDED', roundId: 'r', now: 1 }, { type: 'HIDDEN', now: 2 });
    expect(reduceCycle(result, tick(1 + RESULT_MS))).toMatchObject({ phase: 'BETTING_OPEN', closesAt: null, pausedLeft: BETTING_MS });
    // A late tick after the deadline closes once, at that tick — never twice.
    const late = reduceCycle(initialCycle(0), tick(BETTING_MS + 9000, false));
    expect(late).toMatchObject({ phase: 'BETTING_CLOSED', reopenAt: BETTING_MS + 9000 + NO_WAGER_PAUSE_MS });
  });

  it('sounds the countdown warning once per second for the last three seconds, only with bets on the table', () => {
    const heard: number[] = [];
    let prev: number | null = null;
    for (const secs of [15, 5, 4, 3, 3, 3, 2, 2, 1, 1, 0]) {
      if (countdownWarning(prev, secs, true)) heard.push(secs);
      prev = secs;
    }
    expect(heard).toEqual([3, 2, 1]);
    expect(countdownWarning(4, 3, false)).toBe(false);
    expect(countdownWarning(1, null, true)).toBe(false);
  });
});

describe('table coverage preview (from the engine rule betWins)', () => {
  const nums = (bet: RouletteBet) => [...coveredNumbers(bet)];
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  it('columns cover their 12 numbers', () => {
    expect(nums({ type: 'column', index: 3, amount: 0 })).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
    expect(nums({ type: 'column', index: 2, amount: 0 })).toEqual([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]);
    expect(nums({ type: 'column', index: 1, amount: 0 })).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
  });

  it('dozens, colours, parity, low and high cover exactly their numbers (zero never)', () => {
    expect(nums({ type: 'dozen', index: 1, amount: 0 })).toEqual(range(1, 12));
    expect(nums({ type: 'dozen', index: 2, amount: 0 })).toEqual(range(13, 24));
    expect(nums({ type: 'dozen', index: 3, amount: 0 })).toEqual(range(25, 36));
    expect(nums({ type: 'red', amount: 0 })).toEqual([...RED_NUMBERS].sort((a, b) => a - b));
    expect(nums({ type: 'black', amount: 0 })).toEqual(range(1, 36).filter((n) => !RED_NUMBERS.has(n)));
    expect(nums({ type: 'odd', amount: 0 })).toEqual(range(1, 36).filter((n) => n % 2 === 1));
    expect(nums({ type: 'even', amount: 0 })).toEqual(range(1, 36).filter((n) => n % 2 === 0));
    expect(nums({ type: 'low', amount: 0 })).toEqual(range(1, 18));
    expect(nums({ type: 'high', amount: 0 })).toEqual(range(19, 36));
  });

  it('a straight bet covers exactly one number, and every preview agrees with settlement', () => {
    for (let n = 0; n <= 36; n++) expect(nums({ type: 'straight', number: n, amount: 0 })).toEqual([n]);
    const all: RouletteBet[] = [
      { type: 'red', amount: 0 },
      { type: 'column', index: 1, amount: 0 },
      { type: 'dozen', index: 3, amount: 0 },
      { type: 'straight', number: 0, amount: 0 },
    ];
    for (const bet of all) for (let n = 0; n <= 36; n++) expect(coveredNumbers(bet).includes(n)).toBe(betWins(bet, n));
  });

  it('counts combined coverage of active bets per number', () => {
    let b = placeChip(EMPTY_BOARD, { type: 'red', amount: 0 }, CHIP_DENOMINATIONS[0].value);
    b = placeChip(b, { type: 'dozen', index: 1, amount: 0 }, CHIP_DENOMINATIONS[0].value);
    b = placeChip(b, { type: 'straight', number: 3, amount: 0 }, CHIP_DENOMINATIONS[0].value);
    const c = coverageCounts(b);
    expect(c[3]).toBe(3); // red, 1st dozen, straight 3
    expect(c[1]).toBe(2); // red, 1st dozen
    expect(c[2]).toBe(1); // 1st dozen only
    expect(c[19]).toBe(1); // red only
    expect(c[0]).toBe(0);
  });
});
