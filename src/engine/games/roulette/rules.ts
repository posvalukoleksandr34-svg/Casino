/**
 * European (single-zero) roulette: 37 pockets, 0–36. Zero is green and loses
 * every outside bet (no "la partage" / "en prison").
 */
export const POCKETS = 37;

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Physical order of pockets on a European wheel, clockwise from zero. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26,
];

export type PocketColor = 'green' | 'red' | 'black';

export function pocketColor(n: number): PocketColor {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export type EvenMoneyType = 'red' | 'black' | 'odd' | 'even' | 'low' | 'high';

export type RouletteBet =
  | { type: 'straight'; number: number; amount: number }
  | { type: EvenMoneyType; amount: number }
  | { type: 'dozen' | 'column'; index: 1 | 2 | 3; amount: number };

export type RouletteBetType = RouletteBet['type'];

/** Payout odds "N to 1" for each bet type. */
export const PAYOUT_ODDS: Record<RouletteBetType, number> = {
  straight: 35,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen: 2,
  column: 2,
};

/** Number of winning pockets for each bet type. */
export const WINNING_POCKETS: Record<RouletteBetType, number> = {
  straight: 1,
  red: 18,
  black: 18,
  odd: 18,
  even: 18,
  low: 18,
  high: 18,
  dozen: 12,
  column: 12,
};

export function betWins(bet: RouletteBet, n: number): boolean {
  if (n < 0 || n > 36 || !Number.isInteger(n)) throw new RangeError(`invalid pocket ${n}`);
  switch (bet.type) {
    case 'straight':
      return bet.number === n;
    case 'red':
      return n !== 0 && RED_NUMBERS.has(n);
    case 'black':
      return n !== 0 && !RED_NUMBERS.has(n);
    case 'odd':
      return n !== 0 && n % 2 === 1;
    case 'even':
      return n !== 0 && n % 2 === 0;
    case 'low':
      return n >= 1 && n <= 18;
    case 'high':
      return n >= 19 && n <= 36;
    case 'dozen':
      return n !== 0 && Math.ceil(n / 12) === bet.index;
    case 'column':
      return n !== 0 && ((n - 1) % 3) + 1 === bet.index;
  }
}

/**
 * Gross return of a winning bet: the stake plus winnings at "N to 1".
 * A losing bet returns 0 (the stake is kept by the house).
 */
export function grossReturn(bet: RouletteBet, n: number): number {
  return betWins(bet, n) ? bet.amount * (PAYOUT_ODDS[bet.type] + 1) : 0;
}

export function describeBet(bet: RouletteBet): string {
  switch (bet.type) {
    case 'straight':
      return `Straight ${bet.number}`;
    case 'dozen':
      return `${['1st', '2nd', '3rd'][bet.index - 1]} dozen`;
    case 'column':
      return `Column ${bet.index}`;
    case 'low':
      return '1–18';
    case 'high':
      return '19–36';
    default:
      return bet.type.charAt(0).toUpperCase() + bet.type.slice(1);
  }
}

/** Key that identifies a betting position (used to merge chips on the same spot). */
export function positionKey(bet: RouletteBet): string {
  switch (bet.type) {
    case 'straight':
      return `straight:${bet.number}`;
    case 'dozen':
    case 'column':
      return `${bet.type}:${bet.index}`;
    default:
      return bet.type;
  }
}
