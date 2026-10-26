/**
 * Money primitives. All amounts are integers in *minor units*
 * (1 chip = 100 minor units). JavaScript numbers are exact for integers up to
 * 2^53 - 1; every amount entering or leaving this module is checked against
 * that bound, and multiplications use BigInt so intermediate products can
 * never lose precision.
 */

export const MINOR_PER_CHIP = 100;
export const CURRENCY_CODE = 'CHIP';

/** Upper bound for any single amount handled by the platform (1e14 minor units). */
export const MAX_AMOUNT = 100_000_000_000_000;

/**
 * Largest gross multiplier any valid game configuration can produce (Mines
 * and Crash caps, schema maximum 100,000×; Dice ≤ 9,999×; Roulette 36×;
 * Blackjack 16× + insurance). Configuration schemas must not exceed it.
 */
export const MAX_MULTIPLIER = 100_000;

/**
 * Upper bound for a single stake accepted by any bet schema (10,000,000 chips).
 * Chosen so that MAX_STAKE × MAX_MULTIPLIER ≤ MAX_AMOUNT: no payout, exposure
 * or risk computation for a schema-valid bet can leave the exact integer range.
 * Table limits (risk_limits) are far lower and are enforced separately.
 */
export const MAX_STAKE = MAX_AMOUNT / MAX_MULTIPLIER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Asserts `value` is a safe integer within ±MAX_AMOUNT and returns it. */
export function minor(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units, got ${value}`);
  }
  if (Math.abs(value) > MAX_AMOUNT) {
    throw new MoneyError(`${label} exceeds the maximum supported amount`);
  }
  return value;
}

export function nonNegativeMinor(value: number, label = 'amount'): number {
  minor(value, label);
  if (value < 0) throw new MoneyError(`${label} must not be negative`);
  return value;
}

export function positiveMinor(value: number, label = 'amount'): number {
  minor(value, label);
  if (value <= 0) throw new MoneyError(`${label} must be positive`);
  return value;
}

/** Exact sum of minor-unit amounts. */
export function sumMinor(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(minor(v));
  return fromBigInt(total);
}

/**
 * floor(amount * numerator / denominator) computed exactly with BigInt.
 * Used for every multiplier-based payout so rounding is always toward the
 * house by strictly less than one minor unit, and never double-counted.
 */
export function mulDivFloor(amount: number, numerator: number | bigint, denominator: number | bigint): number {
  const a = BigInt(nonNegativeMinor(amount));
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d <= 0n) throw new MoneyError('denominator must be positive');
  if (n < 0n) throw new MoneyError('numerator must not be negative');
  return fromBigInt((a * n) / d);
}

export function fromBigInt(value: bigint): number {
  if (value > BigInt(MAX_AMOUNT) || value < -BigInt(MAX_AMOUNT)) {
    throw new MoneyError('amount exceeds the maximum supported amount');
  }
  return Number(value);
}

/** Formats minor units as a chip string, e.g. 123456 -> "1,234.56". */
export function formatChips(amount: number, opts: { sign?: boolean } = {}): string {
  const v = minor(amount);
  const negative = v < 0;
  const abs = Math.abs(v);
  const whole = Math.floor(abs / MINOR_PER_CHIP);
  const frac = abs % MINOR_PER_CHIP;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${wholeStr}.${frac.toString().padStart(2, '0')}`;
  if (negative) return `-${body}`;
  return opts.sign && v > 0 ? `+${body}` : body;
}

/**
 * Parses a decimal chip string ("12", "12.3", "12.34") into minor units
 * without floating-point arithmetic. Rejects more than two decimals.
 */
export function parseChips(input: string): number {
  const s = input.trim().replace(/,/g, '');
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) throw new MoneyError(`invalid chip amount: "${input}"`);
  const whole = BigInt(match[1] ?? '0');
  const frac = BigInt((match[2] ?? '').padEnd(2, '0'));
  return fromBigInt(whole * BigInt(MINOR_PER_CHIP) + frac);
}
