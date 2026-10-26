import { describe, expect, it } from 'vitest';
import { formatChips, MAX_AMOUNT, MoneyError, mulDivFloor, parseChips, sumMinor } from '@/engine/money';

describe('money', () => {
  it('parses chip strings exactly without floating point', () => {
    expect(parseChips('0.1')).toBe(10);
    expect(parseChips('0.10')).toBe(10);
    expect(parseChips('12')).toBe(1200);
    expect(parseChips('1,234.56')).toBe(123456);
    expect(parseChips('0.29')).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(() => parseChips('1.234')).toThrow(MoneyError);
    expect(() => parseChips('-1')).toThrow(MoneyError);
    expect(() => parseChips('abc')).toThrow(MoneyError);
  });

  it('formats minor units', () => {
    expect(formatChips(0)).toBe('0.00');
    expect(formatChips(5)).toBe('0.05');
    expect(formatChips(123456789)).toBe('1,234,567.89');
    expect(formatChips(-150)).toBe('-1.50');
    expect(formatChips(150, { sign: true })).toBe('+1.50');
  });

  it('round-trips format/parse', () => {
    for (const v of [0, 1, 99, 100, 101, 123456, 9_999_999_999]) {
      expect(parseChips(formatChips(v))).toBe(v);
    }
  });

  it('mulDivFloor is exact for large values and always rounds down', () => {
    expect(mulDivFloor(101, 19800, 10000)).toBe(199); // 199.98 -> 199
    expect(mulDivFloor(1, 9999, 10000)).toBe(0);
    // The intermediate product (~9e17) is far beyond 2^53; BigInt keeps it exact.
    const big = 90_071_992_547_409;
    expect(mulDivFloor(big, 10001, 10000)).toBe(Number((BigInt(big) * 10001n) / 10000n));
    expect(() => mulDivFloor(MAX_AMOUNT, 2, 1)).toThrow(MoneyError);
    expect(() => mulDivFloor(1.5, 1, 1)).toThrow(MoneyError);
    expect(() => mulDivFloor(-1, 1, 1)).toThrow(MoneyError);
  });

  it('sums exactly and rejects non-integers', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([0.1, 0.2])).toThrow(MoneyError);
  });
});
