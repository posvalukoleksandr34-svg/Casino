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

describe('stake and multiplier bounds', () => {
  it('MAX_STAKE × MAX_MULTIPLIER stays within MAX_AMOUNT', async () => {
    const { MAX_AMOUNT, MAX_MULTIPLIER, MAX_STAKE } = await import('@/engine/money');
    expect(Number.isSafeInteger(MAX_STAKE)).toBe(true);
    expect(MAX_STAKE * MAX_MULTIPLIER).toBeLessThanOrEqual(MAX_AMOUNT);
  });

  it('every game assesses the largest accepted stake under its most extreme valid configuration without leaving the money range', async () => {
    const { MAX_STAKE, MAX_MULTIPLIER, MAX_AMOUNT } = await import('@/engine/money');
    const { dice } = await import('@/engine/games/dice');
    const { mines } = await import('@/engine/games/mines');
    const { crash } = await import('@/engine/games/crash');
    const { roulette } = await import('@/engine/games/roulette');
    const { blackjack } = await import('@/engine/games/blackjack');
    const cases: [string, () => { maxPayout: number }][] = [
      ['dice', () => dice.assess(dice.configSchema.parse({ houseEdgeBp: 1, minWinCount: 1, maxWinCount: 9999 }), { amount: MAX_STAKE, target: 1, direction: 'under' })],
      ['mines', () => mines.assess(mines.configSchema.parse({ houseEdgeBp: 1, minMines: 1, maxMines: 24, maxMultiplierE4: MAX_MULTIPLIER * 10_000 }), { amount: MAX_STAKE, mines: 12 })],
      ['crash', () => crash.assess(crash.configSchema.parse({ houseEdgeBp: 1, growthPerMs: 0.00006, maxMultiplierE2: MAX_MULTIPLIER * 100 }), { amount: MAX_STAKE, autoCashoutE2: MAX_MULTIPLIER * 100 })],
      ['roulette', () => roulette.assess(roulette.configSchema.parse({ maxPositions: 160 }), { bets: Array.from({ length: 160 }, () => ({ type: 'straight' as const, number: 7, amount: MAX_STAKE })) })],
      ['blackjack', () => blackjack.assess(blackjack.defaultConfig, { amount: MAX_STAKE })],
    ];
    for (const [name, run] of cases) {
      const risk = run();
      expect(risk.maxPayout, name).toBeLessThanOrEqual(MAX_AMOUNT);
    }
    // Configuration schemas refuse caps above MAX_MULTIPLIER.
    expect(mines.configSchema.safeParse({ houseEdgeBp: 1, minMines: 1, maxMines: 24, maxMultiplierE4: MAX_MULTIPLIER * 10_000 + 1 }).success).toBe(false);
    expect(crash.configSchema.safeParse({ houseEdgeBp: 1, growthPerMs: 0.00006, maxMultiplierE2: MAX_MULTIPLIER * 100 + 1 }).success).toBe(false);
    // Bet schemas refuse stakes above MAX_STAKE.
    expect(dice.betSchema.safeParse({ amount: MAX_STAKE + 1, target: 5000, direction: 'under' }).success).toBe(false);
    expect(blackjack.betSchema.safeParse({ amount: MAX_STAKE + 1 }).success).toBe(false);
  });
});
