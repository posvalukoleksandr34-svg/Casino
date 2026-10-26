import { describe, expect, it } from 'vitest';
import { crashVariance, GAME_CONTENT, rouletteSd } from '@/content/games';
import { diceRtp, multiplierE4For } from '@/engine/games/dice';
import { payoutTable } from '@/engine/games/roulette';
import { blackjack, insuranceEdge } from '@/engine/games/blackjack';
import { estimateFor } from '@/engine/games/blackjack/estimates';

/** Player-facing tables must match the engine exactly. */
describe('published rules match the engine', () => {
  it('roulette table: every RTP is 97.297%', () => {
    for (const row of GAME_CONTENT.roulette!.payoutTable!.rows) expect(row[4]).toBe('97.297%');
    expect(payoutTable([{ type: 'straight', number: 1, amount: 1 }]).reduce((a, b) => a + b, 0)).toBe(36);
  });

  it('dice table multipliers and RTPs', () => {
    for (const row of GAME_CONTENT.dice!.payoutTable!.rows) {
      const w = Math.round(Number(row[0]!.replace('%', '')) * 100);
      expect(row[2]).toBe(`${(multiplierE4For(w, 100) / 10_000).toFixed(4)}×`);
      expect(row[3]).toBe(`${(diceRtp(w, 100) * 100).toFixed(4)}%`);
    }
  });

  it('blackjack publishes the simulated estimate (as an estimate) and the exact insurance edge', () => {
    const c = GAME_CONTENT.blackjack!;
    const est = estimateFor(blackjack.defaultConfig);
    expect(c.math.join(' ')).toContain(`${(est.houseEdge * 100).toFixed(3)}%`);
    expect(c.math.join(' ')).toContain('estimate');
    expect(c.math.join(' ')).toContain(`${(insuranceEdge(6) * 100).toFixed(2)}%`);
    const t = blackjack.theoretical(blackjack.defaultConfig);
    expect(t.method).toBe('estimate');
    expect(t.ci95![0]).toBeLessThan(t.rtp);
    expect(t.ci95![1]).toBeGreaterThan(t.rtp);
  });

  it('published dispersion figures are derived exactly (independent closed forms)', () => {
    // Var = m²p − (mp)² with gross multiplier m and win probability p.
    expect(rouletteSd('straight')).toBeCloseTo(Math.sqrt(1296 / 37 - (36 / 37) ** 2), 12); // 5.8378
    expect(rouletteSd('red')).toBeCloseTo(Math.sqrt(72 / 37 - (36 / 37) ** 2), 12); // 0.9996
    expect(rouletteSd('dozen')).toBeCloseTo(Math.sqrt(108 / 37 - (36 / 37) ** 2), 12); // 1.4044
    expect(GAME_CONTENT.roulette!.math.join(' ')).toContain('dozens/columns ≈ 1.40');
    expect(crashVariance(2)).toBeCloseTo(4 * 0.495 * 0.505, 12); // 0.9999
    expect(GAME_CONTENT.crash!.math.join(' ')).toContain('1.00 at 2×');
  });

  it('every game with content has rules and maths', () => {
    for (const c of Object.values(GAME_CONTENT)) {
      expect(c.rules.length).toBeGreaterThan(2);
      expect(c.math.length).toBeGreaterThan(1);
    }
  });
});
