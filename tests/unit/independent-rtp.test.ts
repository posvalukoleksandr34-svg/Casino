import { describe, expect, it } from 'vitest';
import { crash, survivalAt } from '@/engine/games/crash';
import { dice, diceRtp as engineDiceRtp } from '@/engine/games/dice';
import { mines, strategyRtp } from '@/engine/games/mines';
import { hilo, hiloStrategyRtp } from '@/engine/games/hilo';
import { keno, kenoRowRtp } from '@/engine/games/keno';
import { limboWinProbability } from '@/engine/games/limbo';
import { plinko, PLINKO_RISKS, PLINKO_ROWS, plinkoKey, plinkoRtp as enginePlinkoRtp } from '@/engine/games/plinko';
import { roulette } from '@/engine/games/roulette';
import { crashAutoRtp, diceRtp, hiloRtp, kenoRtp, limboRtp, minesRtp, plinkoRtp, rouletteRtp } from '../../scripts/sim/independent-rtp';

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

  it('limbo: every target 1.01×–100.00× and a sample above', () => {
    for (let t = 101; t <= 10_000; t += 1) expect(limboWinProbability(t, 100) * (t / 100)).toBeCloseTo(limboRtp(t, 100), 13);
    for (const t of [50_000, 1_000_000]) expect(limboWinProbability(t, 100) * (t / 100)).toBeCloseTo(limboRtp(t, 100), 13);
  });

  it('keno: every pick count', () => {
    for (let n = 1; n <= 10; n += 1) {
      const row = keno.defaultConfig.table[String(n)]!;
      expect(kenoRowRtp(n, row)).toBeCloseTo(kenoRtp(n, row), 14);
    }
  });

  it('plinko: every rows × risk table', () => {
    for (const r of PLINKO_ROWS) {
      for (const k of PLINKO_RISKS) {
        const t = plinko.defaultConfig.tables[plinkoKey(r, k)]!;
        expect(enginePlinkoRtp(r, t)).toBeCloseTo(plinkoRtp(r, t), 14);
      }
    }
  });

  it('hi-lo: likelier-side strategies cashing out after 1–6 guesses, default and low caps', () => {
    for (const cap of [hilo.defaultConfig.maxMultiplierE4, 30_000]) {
      const c = { ...hilo.defaultConfig, maxMultiplierE4: cap };
      for (let k = 1; k <= 6; k += 1) expect(hiloStrategyRtp(c, k)).toBeCloseTo(hiloRtp(k, c.houseEdgeBp, cap), 14);
    }
  });

  it('dice default configuration is the one the simulations use', () => {
    expect(dice.defaultConfig.houseEdgeBp).toBe(100);
  });
});
