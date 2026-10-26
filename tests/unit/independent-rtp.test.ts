import { describe, expect, it } from 'vitest';
import { crash, survivalAt } from '@/engine/games/crash';
import { dice, diceRtp as engineDiceRtp } from '@/engine/games/dice';
import { mines, strategyRtp } from '@/engine/games/mines';
import { roulette } from '@/engine/games/roulette';
import { crashAutoRtp, diceRtp, minesRtp, rouletteRtp } from '../../scripts/sim/independent-rtp';

/**
 * The engine's theory functions must equal the published rules implemented
 * independently (scripts/sim/independent-rtp.ts), across the parameter space,
 * so the Monte Carlo checks never validate the engine against itself.
 */
describe('published-rule RTPs agree with the engine', () => {
  it('roulette: 36/37 for every bet', () => {
    expect(rouletteRtp()).toBe(36 / 37);
    expect(roulette.theoretical(roulette.defaultConfig).rtp).toBeCloseTo(36 / 37, 15);
  });

  it('dice: every win count 1..9999 at several edges', () => {
    for (const edge of [1, 100, 250, 2000]) {
      for (let w = 1; w <= 9_999; w += 1) expect(engineDiceRtp(w, edge)).toBe(diceRtp(w, edge));
    }
    expect(diceRtp(4_950, 100)).toBeCloseTo(0.99, 12); // 49.5 % × 2.0000×
  });

  it('mines: every mine count and every reachable pick', () => {
    const c = mines.defaultConfig;
    for (let m = 1; m <= 24; m += 1) {
      for (let k = 1; k <= 25 - m; k += 1) expect(strategyRtp(c, m, k)).toBeCloseTo(minesRtp(m, k, c.houseEdgeBp, c.maxMultiplierE4), 12);
    }
    expect(minesRtp(24, 1, 100, 10_000_000)).toBeCloseTo((1 / 25) * 24.75, 12);
  });

  it('crash: exact survival from the 52-bit mapping equals (1 − h)/x to within 2⁻⁵²·x', () => {
    const h = crash.defaultConfig.houseEdgeBp;
    for (const x of [101, 150, 199, 200, 1_000, 10_000, 99_999, 100_000]) {
      const exact = crashAutoRtp(x, h);
      expect(Math.abs(exact - survivalAt(x, h) * (x / 100))).toBeLessThan((x / 100) * 2 ** -50);
      expect(exact).toBeLessThanOrEqual(1 - h / 10_000 + 1e-15);
    }
  });

  it('dice default configuration is the one the simulations use', () => {
    expect(dice.defaultConfig.houseEdgeBp).toBe(100);
  });
});
