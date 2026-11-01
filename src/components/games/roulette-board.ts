/**
 * Client-side roulette betting board: which chips (denominations) lie on
 * which position, in the order they were placed.
 *
 * The board is presentation state. What goes to the server is unchanged:
 * `toBets()` turns it into the existing `RouletteBet[]` payload, whose
 * `amount` per position is the sum of that position's chips. The server
 * validates and settles exactly as before.
 */
import { betWins, POCKETS, positionKey, type RouletteBet } from '@/engine/games/roulette';
import { MINOR_PER_CHIP } from '@/engine/money';

/** Denominations in minor units, with their physical chip colours. */
export const CHIP_DENOMINATIONS = [
  { value: 1 * MINOR_PER_CHIP, color: 'white', label: '1' },
  { value: 5 * MINOR_PER_CHIP, color: 'red', label: '5' },
  { value: 25 * MINOR_PER_CHIP, color: 'green', label: '25' },
  { value: 100 * MINOR_PER_CHIP, color: 'black', label: '100' },
  { value: 500 * MINOR_PER_CHIP, color: 'purple', label: '500' },
  { value: 1000 * MINOR_PER_CHIP, color: 'orange', label: '1k' },
] as const;

export type ChipColor = (typeof CHIP_DENOMINATIONS)[number]['color'];
export const CHIP_VALUES: number[] = CHIP_DENOMINATIONS.map((d) => d.value);

export function chipColor(value: number): ChipColor {
  return CHIP_DENOMINATIONS.find((d) => d.value === value)?.color ?? 'white';
}

export interface BoardPosition {
  /** The bet with amount 0; the amount comes from the chips. */
  template: RouletteBet;
  /** Chip values in placement order (bottom of the stack first). */
  chips: number[];
}

export type Board = ReadonlyMap<string, BoardPosition>;

export const EMPTY_BOARD: Board = new Map();

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function positionTotal(p: BoardPosition | undefined): number {
  return p ? sum(p.chips) : 0;
}

export function boardTotal(board: Board): number {
  let t = 0;
  for (const p of board.values()) t += sum(p.chips);
  return t;
}

export function placeChip(board: Board, template: RouletteBet, value: number): Board {
  const key = positionKey(template);
  const next = new Map(board);
  const existing = board.get(key);
  next.set(key, { template: { ...template, amount: 0 } as RouletteBet, chips: [...(existing?.chips ?? []), value] });
  return next;
}

/** Takes the top chip off a position (the position disappears when empty). */
export function removeTopChip(board: Board, key: string): Board {
  const existing = board.get(key);
  if (!existing) return board;
  const next = new Map(board);
  if (existing.chips.length <= 1) next.delete(key);
  else next.set(key, { ...existing, chips: existing.chips.slice(0, -1) });
  return next;
}

export function removePosition(board: Board, key: string): Board {
  if (!board.has(key)) return board;
  const next = new Map(board);
  next.delete(key);
  return next;
}

/** Doubles every position by repeating its chips (denominations preserved). */
export function doubleBoard(board: Board): Board {
  return new Map([...board].map(([k, p]) => [k, { ...p, chips: [...p.chips, ...p.chips] }]));
}

/** The server payload: one bet per position, amount = sum of its chips. */
export function toBets(board: Board): RouletteBet[] {
  return [...board.values()].map((p) => ({ ...p.template, amount: sum(p.chips) }) as RouletteBet);
}

/** Count of each denomination on a position, largest first. */
export function breakdown(chips: readonly number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const c of chips) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.value - a.value);
}

/**
 * Rebuilds a board from server bets (e.g. after a recovered request when the
 * original chips are not in memory): each amount is split greedily into the
 * largest denominations. Amounts below the smallest chip become one chip of
 * that exact amount, so totals always match.
 */
export function boardFromBets(bets: readonly RouletteBet[]): Board {
  const board = new Map<string, BoardPosition>();
  const desc = [...CHIP_VALUES].sort((a, b) => b - a);
  for (const bet of bets) {
    let rest = bet.amount;
    const chips: number[] = [];
    for (const v of desc) {
      while (rest >= v) {
        chips.push(v);
        rest -= v;
      }
    }
    if (rest > 0) chips.push(rest);
    const key = positionKey(bet);
    const existing = board.get(key);
    board.set(key, { template: { ...bet, amount: 0 } as RouletteBet, chips: [...(existing?.chips ?? []), ...chips.reverse()] });
  }
  return board;
}

/** Undo history of board snapshots, capped. */
export const UNDO_LIMIT = 100;
export function pushUndo(stack: readonly Board[], board: Board): Board[] {
  return [...stack.slice(-(UNDO_LIMIT - 1)), board];
}

// ── Coverage (for the table's hover/focus/tap preview) ──────────────────────

const coverCache = new Map<string, readonly number[]>();

/**
 * The pockets a bet covers, taken from the engine's own `betWins` (the rule
 * that settles real rounds), so the preview can never disagree with payouts.
 */
export function coveredNumbers(bet: RouletteBet): readonly number[] {
  const key = positionKey(bet);
  let numbers = coverCache.get(key);
  if (!numbers) {
    numbers = Object.freeze(Array.from({ length: POCKETS }, (_, n) => n).filter((n) => betWins(bet, n)));
    coverCache.set(key, numbers);
  }
  return numbers;
}

/** For each pocket 0–36, how many of the board's positions cover it. */
export function coverageCounts(board: Board): number[] {
  const counts = new Array<number>(POCKETS).fill(0);
  for (const p of board.values()) for (const n of coveredNumbers(p.template)) counts[n]! += 1;
  return counts;
}

/** Top chips that left the table between two boards (for the lift-off animation). */
export function removedTops(prev: Board, next: Board): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  for (const [key, p] of prev) {
    const left = next.get(key)?.chips.length ?? 0;
    if (left < p.chips.length) out.push({ key, value: p.chips[p.chips.length - 1]! });
  }
  return out;
}
