import { describe, expect, it } from 'vitest';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import {
  betWins,
  grossReturn,
  normalizeBets,
  payoutTable,
  pocketColor,
  POCKETS,
  RED_NUMBERS,
  roulette,
  rouletteBetSchema,
  rouletteRisk,
  WHEEL_ORDER,
  WINNING_POCKETS,
  type RouletteBet,
} from '@/engine/games/roulette';

const ALL_SINGLE_BETS: RouletteBet[] = [
  ...Array.from({ length: 37 }, (_, n) => ({ type: 'straight' as const, number: n, amount: 100 })),
  ...(['red', 'black', 'odd', 'even', 'low', 'high'] as const).map((type) => ({ type, amount: 100 })),
  ...([1, 2, 3] as const).flatMap((index) => [
    { type: 'dozen' as const, index, amount: 100 },
    { type: 'column' as const, index, amount: 100 },
  ]),
];

describe('European roulette rules', () => {
  it('has 18 red, 18 black and one green pocket; wheel contains each pocket once', () => {
    expect(RED_NUMBERS.size).toBe(18);
    const colors = Array.from({ length: POCKETS }, (_, n) => pocketColor(n));
    expect(colors.filter((c) => c === 'black')).toHaveLength(18);
    expect(colors.filter((c) => c === 'green')).toHaveLength(1);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });

  it('each bet type wins on the documented number of pockets', () => {
    for (const bet of ALL_SINGLE_BETS) {
      const wins = Array.from({ length: POCKETS }, (_, n) => betWins(bet, n)).filter(Boolean).length;
      expect(wins, JSON.stringify(bet)).toBe(WINNING_POCKETS[bet.type]);
    }
  });

  it('zero loses every outside bet', () => {
    for (const bet of ALL_SINGLE_BETS.filter((b) => b.type !== 'straight')) {
      expect(betWins(bet, 0)).toBe(false);
    }
    expect(betWins({ type: 'straight', number: 0, amount: 1 }, 0)).toBe(true);
  });

  it('dozens and columns map correctly', () => {
    expect(betWins({ type: 'dozen', index: 1, amount: 1 }, 12)).toBe(true);
    expect(betWins({ type: 'dozen', index: 2, amount: 1 }, 13)).toBe(true);
    expect(betWins({ type: 'dozen', index: 3, amount: 1 }, 36)).toBe(true);
    expect(betWins({ type: 'column', index: 1, amount: 1 }, 34)).toBe(true);
    expect(betWins({ type: 'column', index: 2, amount: 1 }, 35)).toBe(true);
    expect(betWins({ type: 'column', index: 3, amount: 1 }, 36)).toBe(true);
    expect(betWins({ type: 'column', index: 3, amount: 1 }, 34)).toBe(false);
  });

  it('every bet type has RTP exactly 36/37 (exact integer arithmetic)', () => {
    for (const bet of ALL_SINGLE_BETS) {
      const totalOverPockets = payoutTable([bet]).reduce((a, b) => a + b, 0);
      // Σ_n gross(n) = 36 · stake  ⇒  E[gross] / stake = 36/37 exactly.
      expect(totalOverPockets, JSON.stringify(bet)).toBe(36 * bet.amount);
    }
  });

  it('gross return includes the returned stake (no double counting)', () => {
    expect(grossReturn({ type: 'straight', number: 7, amount: 100 }, 7)).toBe(3600);
    expect(grossReturn({ type: 'red', amount: 100 }, 1)).toBe(200);
    expect(grossReturn({ type: 'dozen', index: 1, amount: 100 }, 5)).toBe(300);
    expect(grossReturn({ type: 'red', amount: 100 }, 2)).toBe(0);
  });

  it('combined bets: exact payout table, max liability, mean and variance', () => {
    const bets: RouletteBet[] = [
      { type: 'straight', number: 17, amount: 100 },
      { type: 'red', amount: 100 },
      { type: 'odd', amount: 100 },
    ];
    const table = payoutTable(bets);
    expect(table[17]).toBe(3600 + 200); // 17 is black and odd
    expect(table[1]).toBe(400); // red + odd
    expect(table[2]).toBe(0); // black, even
    expect(table[0]).toBe(0);
    const risk = rouletteRisk(bets);
    expect(risk.stake).toBe(300);
    expect(risk.maxPayout).toBe(3800);
    expect(risk.expectedPayout).toBeCloseTo((300 * 36) / 37, 9);
    const mean = table.reduce((a, b) => a + b, 0) / 37;
    const variance = table.reduce((a, p) => a + (p - mean) ** 2, 0) / 37;
    expect(risk.payoutVariance).toBeCloseTo(variance, 6);
  });

  it('red + black is not a hedge on zero: both lose', () => {
    const table = payoutTable([
      { type: 'red', amount: 100 },
      { type: 'black', amount: 100 },
    ]);
    expect(table[0]).toBe(0);
    expect(table.slice(1).every((p) => p === 200)).toBe(true);
  });

  it('normalizes duplicate positions', () => {
    const merged = normalizeBets([
      { type: 'red', amount: 100 },
      { type: 'red', amount: 50 },
      { type: 'straight', number: 3, amount: 10 },
      { type: 'straight', number: 3, amount: 5 },
      { type: 'dozen', index: 2, amount: 7 },
    ]);
    expect(merged).toEqual([
      { type: 'red', amount: 150 },
      { type: 'straight', number: 3, amount: 15 },
      { type: 'dozen', index: 2, amount: 7 },
    ]);
  });

  it('start() settles using the provably fair stream', () => {
    const input = { bets: [{ type: 'straight' as const, number: 5, amount: 100 }, { type: 'even' as const, amount: 50 }] };
    const fairness = { serverSeed: 'f'.repeat(64), clientSeed: 'client', nonce: 11 };
    const expectedPocket = new HmacRandomStream(fairness).nextInt(37);
    const result = roulette.start(roulette.defaultConfig, input, new HmacRandomStream(fairness));
    expect(result.status).toBe('SETTLED');
    expect(result.state.result).toBe(expectedPocket);
    expect(result.payout).toBe(payoutTable(input.bets)[expectedPocket]);
    expect(result.risk.stake).toBe(150);
  });

  it('validates bet payloads', () => {
    const ok = rouletteBetSchema.safeParse({ bets: [{ type: 'straight', number: 36, amount: 1 }] });
    expect(ok.success).toBe(true);
    for (const bad of [
      { bets: [] },
      { bets: [{ type: 'straight', number: 37, amount: 1 }] },
      { bets: [{ type: 'straight', number: 1, amount: 0 }] },
      { bets: [{ type: 'straight', number: 1, amount: 1.5 }] },
      { bets: [{ type: 'red', amount: -5 }] },
      { bets: [{ type: 'dozen', index: 4, amount: 1 }] },
      { bets: [{ type: 'split', amount: 1 }] },
      { bets: [{ type: 'red', amount: 1, payout: 999 }] },
    ]) {
      expect(rouletteBetSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('enforces the configured position limit after merging', () => {
    const bets = Array.from({ length: 5 }, (_, n) => ({ type: 'straight' as const, number: n, amount: 1 }));
    expect(() => roulette.assess({ maxPositions: 4 }, { bets })).toThrow(/At most 4/);
    expect(roulette.assess({ maxPositions: 5 }, { bets }).stake).toBe(5);
  });
});
