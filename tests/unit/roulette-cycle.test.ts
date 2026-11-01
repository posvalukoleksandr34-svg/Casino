import { describe, expect, it } from 'vitest';
import {
  BETTING_SECONDS,
  countdownWarning,
  joinTable,
  JOIN_SPECTATE_MS,
  MIN_JOIN_BETTING_MS,
  MIN_RESULT_MS,
  reduceCycle,
  secondsLeft,
  type Cycle,
  type CycleEvent,
} from '@/components/games/roulette-cycle';
import { CHIP_DENOMINATIONS, coverageCounts, coveredNumbers, EMPTY_BOARD, placeChip } from '@/components/games/roulette-board';
import { betWins, RED_NUMBERS, type RouletteBet } from '@/engine/games/roulette';
import { slotAt, slotDay, slotTimes, tableSpinResult, TABLE_BETTING_MS, TABLE_CYCLE_MS, TABLE_EPOCH_MS } from '@/engine/games/roulette/table';
import { HmacRandomStream } from '@/engine/rng/provably-fair';

const run = (s: Cycle, ...events: CycleEvent[]) => events.reduce(reduceCycle, s);
const tick = (now: number, canWager = false): CycleEvent => ({ type: 'TICK', now, canWager });
/** A slot well after the epoch, and its times. */
const T = slotTimes(5000);

describe('table schedule (shared by server and client)', () => {
  it('cycles a 15-second betting window, a spin and a result, back to back', () => {
    expect(BETTING_SECONDS).toBe(15);
    expect(T.closesAt - T.startsAt).toBe(15_000);
    expect(T.endsAt - T.startsAt).toBe(TABLE_CYCLE_MS);
    expect(slotTimes(5001).startsAt).toBe(T.endsAt);
    for (const at of [T.startsAt, T.closesAt - 1, T.closesAt, T.endsAt - 1]) expect(slotAt(at).slot).toBe(5000);
    expect(slotAt(T.endsAt).slot).toBe(5001);
    expect(slotAt(TABLE_EPOCH_MS - 1e9).slot).toBe(0);
    expect(slotDay(5000)).toBe(new Date(T.closesAt).toISOString().slice(0, 10));
  });

  it('derives a table result exactly as a player round draws its pocket', () => {
    const seed = 'ab'.repeat(32);
    for (const slot of [0, 1, 5000, 123_456]) {
      const r = tableSpinResult(seed, slot);
      expect(r).toBe(new HmacRandomStream({ serverSeed: seed, clientSeed: 'aurovane-table', nonce: slot }).nextInt(37));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(36);
    }
  });
});

describe('automatic roulette cycle', () => {
  it('joins the open window with its countdown; late arrivals watch the spin or wait for the next window', () => {
    const open = joinTable(T.startsAt);
    expect(open).toMatchObject({ phase: 'BETTING_OPEN', slot: 5000, closesAt: T.closesAt });
    expect(secondsLeft(open, T.startsAt)).toBe(15);
    expect(secondsLeft(open, T.closesAt - 1)).toBe(1);
    // Too little betting time left: watch this slot's spin instead.
    expect(joinTable(T.closesAt - MIN_JOIN_BETTING_MS + 1)).toMatchObject({ phase: 'BETTING_CLOSED', wager: false, slot: 5000 });
    expect(joinTable(T.closesAt + JOIN_SPECTATE_MS - 1)).toMatchObject({ phase: 'BETTING_CLOSED', wager: false });
    // Later in the slot: wait for the next window (re-entering restores the current state).
    expect(joinTable(T.closesAt + JOIN_SPECTATE_MS)).toMatchObject({ phase: 'RESULT_REVEAL', spin: null, revealUntil: T.endsAt });
  });

  it('ALWAYS spins: without bets, the window closes into the table spin served for that slot', () => {
    let s = joinTable(T.startsAt);
    s = reduceCycle(s, tick(T.closesAt, false));
    expect(s).toMatchObject({ phase: 'BETTING_CLOSED', wager: false });
    // A result for another slot is not accepted.
    expect(reduceCycle(s, { type: 'TABLE_RESULT', slot: 4999, result: 7 })).toBe(s);
    expect(reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: 'x' })).toBe(s); // no wager → no player round
    s = reduceCycle(s, { type: 'TABLE_RESULT', slot: 5000, result: 17 });
    expect(s).toMatchObject({ phase: 'SPINNING', spin: { kind: 'table', key: 'table:5000', result: 17 } });
    s = reduceCycle(s, { type: 'LANDED', key: 'table:5000', now: T.closesAt + 5000 });
    expect(s).toMatchObject({ phase: 'RESULT_REVEAL', revealUntil: T.endsAt });
    s = reduceCycle(s, tick(T.endsAt));
    expect(s).toMatchObject({ phase: 'BETTING_OPEN', slot: 5001, closesAt: slotTimes(5001).closesAt, spin: null });
  });

  it('with valid bets, the window closes into exactly one player round', () => {
    let s = run(joinTable(T.startsAt), tick(T.closesAt, true));
    expect(s).toMatchObject({ phase: 'BETTING_CLOSED', wager: true });
    expect(reduceCycle(s, { type: 'TABLE_RESULT', slot: 5000, result: 3 })).toBe(s); // not a table spin
    expect(reduceCycle(s, tick(T.endsAt * 2, true))).toBe(s); // waits for the server however long
    s = reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: 'r1' });
    expect(s).toMatchObject({ phase: 'SPINNING', spin: { kind: 'wager', key: 'r1' } });
    expect(reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: 'r2' })).toBe(s); // no second spin
    // A late answer still gets a minimum result display before the next window.
    const late = T.endsAt - 1000;
    s = reduceCycle(s, { type: 'LANDED', key: 'r1', now: late });
    expect(s.revealUntil).toBe(late + MIN_RESULT_MS);
    expect(reduceCycle(s, { type: 'LANDED', key: 'r1', now: late + 10 })).toBe(s);
  });

  it('every window ends in exactly one spin over many cycles', () => {
    let s = joinTable(T.startsAt);
    const spins: string[] = [];
    for (let k = 0; k < 20; k++) {
      const slot = 5000 + k;
      const t = slotTimes(slot);
      expect(s).toMatchObject({ phase: 'BETTING_OPEN', slot });
      const bet = k % 3 === 0;
      s = reduceCycle(s, tick(t.closesAt, bet));
      s = reduceCycle(s, tick(t.closesAt + 100, bet)); // repeated ticks change nothing
      s = bet ? reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: `r${k}` }) : reduceCycle(s, { type: 'TABLE_RESULT', slot, result: k % 37 });
      // Duplicates from retries/reconnects are ignored.
      s = bet ? reduceCycle(s, { type: 'ROUND_RECEIVED', roundId: `dup${k}` }) : reduceCycle(s, { type: 'TABLE_RESULT', slot, result: 0 });
      spins.push(s.spin!.key);
      s = reduceCycle(s, { type: 'LANDED', key: s.spin!.key, now: t.closesAt + 5000 });
      s = reduceCycle(s, tick(t.endsAt));
    }
    expect(spins).toHaveLength(20);
    expect(new Set(spins).size).toBe(20);
  });

  it('never invents a result: a failed table request ends the window without a spin', () => {
    let s = run(joinTable(T.startsAt), tick(T.closesAt, false));
    s = reduceCycle(s, { type: 'TABLE_FAILED', slot: 5000, now: T.closesAt + 6000 });
    expect(s).toMatchObject({ phase: 'RESULT_REVEAL', spin: null, notice: 'TABLE_UNAVAILABLE' });
    expect(reduceCycle(s, tick(s.revealUntil!))).toMatchObject({ phase: 'BETTING_OPEN', slot: 5001, notice: null });
  });

  it('a stale spectator window (long-hidden tab) moves on to the current slot', () => {
    const s = run(joinTable(T.startsAt), { type: 'HIDDEN' }, tick(T.closesAt, false));
    expect(s.hidden).toBe(true);
    const later = slotTimes(5003).startsAt + 1000;
    expect(reduceCycle(s, tick(later))).toMatchObject({ phase: 'BETTING_OPEN', slot: 5003, hidden: true });
  });

  it('never enters two phases at once: each event is accepted only in its own phase', () => {
    const phases: Cycle['phase'][] = [];
    let s = joinTable(T.startsAt);
    const events: CycleEvent[] = [
      { type: 'LANDED', key: 'r', now: 1 },
      { type: 'REQUEST_FAILED' },
      { type: 'RECOVERY_RESOLVED', now: 1 },
      { type: 'TABLE_RESULT', slot: 5000, result: 1 },
      tick(T.closesAt, true),
      tick(T.closesAt, true),
      { type: 'RECOVERY_NEEDED' },
      { type: 'ROUND_RECEIVED', roundId: 'r' },
      { type: 'ROUND_RECEIVED', roundId: 'r' },
      tick(T.endsAt * 3, true),
      { type: 'LANDED', key: 'r', now: T.closesAt + 5000 },
    ];
    for (const e of events) {
      s = reduceCycle(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(['BETTING_OPEN', 'BETTING_OPEN', 'BETTING_OPEN', 'BETTING_OPEN', 'BETTING_CLOSED', 'BETTING_CLOSED', 'BETTING_CLOSED', 'SPINNING', 'SPINNING', 'SPINNING', 'RESULT_REVEAL']);
  });

  it('a failed wager request goes to recovery; time never ends it; a retry delivers the round, or the table is rejoined', () => {
    const failed = run(joinTable(T.startsAt), tick(T.closesAt, true), { type: 'REQUEST_FAILED' });
    expect(failed.phase).toBe('RECOVERY');
    expect(reduceCycle(failed, tick(T.endsAt * 5, true))).toBe(failed);
    expect(reduceCycle(failed, { type: 'TABLE_RESULT', slot: 5000, result: 3 })).toBe(failed);
    expect(reduceCycle(failed, { type: 'ROUND_RECEIVED', roundId: 'r' })).toMatchObject({ phase: 'SPINNING', spin: { kind: 'wager' } });
    const now = slotTimes(5002).startsAt + 1000;
    expect(reduceCycle(failed, { type: 'RECOVERY_RESOLVED', now })).toMatchObject({ phase: 'BETTING_OPEN', slot: 5002 });
    // An interrupted request found while betting is open stops the window.
    expect(reduceCycle(joinTable(T.startsAt), { type: 'RECOVERY_NEEDED' })).toMatchObject({ phase: 'RECOVERY' });
  });

  it('a wager that became invalid at the moment of sending falls back to watching the table spin', () => {
    const s = run(joinTable(T.startsAt), tick(T.closesAt, true), { type: 'WAGER_SKIPPED' });
    expect(s).toMatchObject({ phase: 'BETTING_CLOSED', wager: false });
    expect(reduceCycle(s, { type: 'TABLE_RESULT', slot: 5000, result: 9 }).phase).toBe('SPINNING');
  });

  it('a late tick closes the window once, at that tick', () => {
    const s = reduceCycle(joinTable(T.startsAt), tick(T.closesAt + 9000, false));
    expect(s).toMatchObject({ phase: 'BETTING_CLOSED', wager: false });
    expect(T.closesAt - T.startsAt).toBe(TABLE_BETTING_MS);
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
