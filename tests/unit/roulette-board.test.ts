import { describe, expect, it } from 'vitest';
import { normalizeBets, positionKey, rouletteBetSchema, type RouletteBet } from '@/engine/games/roulette';
import { MINOR_PER_CHIP } from '@/engine/money';
import {
  boardFromBets,
  boardTotal,
  breakdown,
  CHIP_DENOMINATIONS,
  chipColor,
  doubleBoard,
  EMPTY_BOARD,
  placeChip,
  positionTotal,
  pushUndo,
  removePosition,
  removeTopChip,
  toBets,
  UNDO_LIMIT,
  type Board,
} from '@/components/games/roulette-board';
import { historyStats, toSpins, type RoundListItem } from '@/components/games/roulette-history-data';

const C = (n: number) => n * MINOR_PER_CHIP;
const red: RouletteBet = { type: 'red', amount: 0 };
const s17: RouletteBet = { type: 'straight', number: 17, amount: 0 };
const dozen2: RouletteBet = { type: 'dozen', index: 2, amount: 0 };

describe('chip denominations', () => {
  it('are the six physical colours, smallest to largest', () => {
    expect(CHIP_DENOMINATIONS.map((d) => [d.value / MINOR_PER_CHIP, d.color])).toEqual([
      [1, 'white'],
      [5, 'red'],
      [25, 'green'],
      [100, 'black'],
      [500, 'purple'],
      [1000, 'orange'],
    ]);
    expect(chipColor(C(25))).toBe('green');
  });
});

describe('roulette board', () => {
  it('stacks chips per position in placement order', () => {
    let b: Board = EMPTY_BOARD;
    b = placeChip(b, red, C(5));
    b = placeChip(b, red, C(25));
    b = placeChip(b, s17, C(1));
    expect(b.get('red')!.chips).toEqual([C(5), C(25)]);
    expect(positionTotal(b.get('red'))).toBe(C(30));
    expect(boardTotal(b)).toBe(C(31));
    expect(EMPTY_BOARD.size).toBe(0); // never mutated
  });

  it('turns the denomination breakdown into the unchanged server payload (amount = sum of chips)', () => {
    let b: Board = EMPTY_BOARD;
    for (const v of [C(1), C(5), C(5), C(25), C(100), C(500), C(1000)]) b = placeChip(b, red, v);
    b = placeChip(b, s17, C(5));
    b = placeChip(b, dozen2, C(25));
    b = placeChip(b, dozen2, C(1));
    const bets = toBets(b);
    expect(bets).toEqual([
      { type: 'red', amount: C(1636) },
      { type: 'straight', number: 17, amount: C(5) },
      { type: 'dozen', index: 2, amount: C(26) },
    ]);
    // The payload passes the server's own schema and is already normalised.
    expect(rouletteBetSchema.safeParse({ bets }).success).toBe(true);
    expect(normalizeBets(bets)).toEqual(bets);
    // Aggregate stake equals the sum of every chip on the table.
    expect(bets.reduce((a, x) => a + x.amount, 0)).toBe(boardTotal(b));
    expect(breakdown(b.get('red')!.chips)).toEqual([
      { value: C(1000), count: 1 },
      { value: C(500), count: 1 },
      { value: C(100), count: 1 },
      { value: C(25), count: 1 },
      { value: C(5), count: 2 },
      { value: C(1), count: 1 },
    ]);
  });

  it('removes the top chip, then the position when empty; remove of an absent key is a no-op', () => {
    let b = placeChip(placeChip(EMPTY_BOARD, red, C(5)), red, C(25));
    b = removeTopChip(b, 'red');
    expect(b.get('red')!.chips).toEqual([C(5)]);
    b = removeTopChip(b, 'red');
    expect(b.has('red')).toBe(false);
    expect(removeTopChip(b, 'red')).toBe(b);
    expect(removePosition(placeChip(b, s17, C(1)), positionKey(s17)).size).toBe(0);
  });

  it('doubles by repeating each stack, preserving denominations', () => {
    const b = placeChip(placeChip(EMPTY_BOARD, red, C(5)), s17, C(25));
    const d = doubleBoard(b);
    expect(d.get('red')!.chips).toEqual([C(5), C(5)]);
    expect(boardTotal(d)).toBe(2 * boardTotal(b));
    expect(b.get('red')!.chips).toEqual([C(5)]);
  });

  it('rebuilds a board from server bets with exactly the same amounts', () => {
    const bets: RouletteBet[] = [
      { type: 'red', amount: C(1636) },
      { type: 'straight', number: 0, amount: 250 }, // 2.50 chips: below the smallest chip
      { type: 'column', index: 3, amount: C(7) },
    ];
    const b = boardFromBets(bets);
    expect(toBets(b)).toEqual(bets);
    expect(b.get('red')!.chips).toEqual([C(1), C(5), C(5), C(25), C(100), C(500), C(1000)]);
    expect(b.get('straight:0')!.chips).toEqual([50, C(1), C(1)]);
  });

  it('keeps a bounded undo history', () => {
    let stack: Board[] = [];
    for (let i = 0; i < UNDO_LIMIT + 20; i++) stack = pushUndo(stack, placeChip(EMPTY_BOARD, red, C(1)));
    expect(stack).toHaveLength(UNDO_LIMIT);
  });
});

describe('results history (from the rounds API)', () => {
  const item = (over: Partial<RoundListItem>): RoundListItem => ({
    id: 'r1',
    gameId: 'roulette',
    status: 'SETTLED',
    stake: 1000,
    payout: 2000,
    startedAt: '2026-11-01T10:00:00.000Z',
    settledAt: '2026-11-01T10:00:00.050Z',
    summary: { result: 3, results: [] },
    ...over,
  });

  it('keeps only settled roulette rounds with a valid result, in API order', () => {
    const spins = toSpins([
      item({ id: 'a', summary: { result: 0, results: [] }, payout: 0 }),
      item({ id: 'b', status: 'OPEN', payout: null }),
      item({ id: 'c', status: 'VOIDED' }),
      item({ id: 'd', gameId: 'dice' }),
      item({ id: 'e', summary: { result: 37 } }),
      item({ id: 'f', summary: null }),
      item({ id: 'g', summary: { result: 32, results: [] } }),
    ]);
    expect(spins.map((s) => [s.id, s.result, s.color, s.net])).toEqual([
      ['a', 0, 'green', -1000],
      ['g', 32, 'red', 1000],
    ]);
  });

  it('counts colour, parity and range without counting zero as either', () => {
    const s = historyStats([0, 1, 2, 19, 36, 36, 0]);
    expect(s).toMatchObject({ count: 7, red: 4, black: 1, green: 2, odd: 2, even: 3, low: 2, high: 3 });
    expect(s.frequent[0]).toEqual({ number: 0, count: 2 });
    expect(s.frequent[1]).toEqual({ number: 36, count: 2 });
  });
});
