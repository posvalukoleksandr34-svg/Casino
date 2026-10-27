import { describe, expect, it } from 'vitest';
import { crashVariance, GAME_CONTENT, rouletteSd } from '@/content/games';
import { diceRtp, multiplierE4For } from '@/engine/games/dice';
import { payoutTable } from '@/engine/games/roulette';
import { blackjack, insuranceEdge } from '@/engine/games/blackjack';
import { estimateFor } from '@/engine/games/blackjack/estimates';
import { hilo, hiloMultiplierE4, successNumerator } from '@/engine/games/hilo';
import { keno, kenoRowRtp } from '@/engine/games/keno';
import { limboWinProbability } from '@/engine/games/limbo';
import { plinko, plinkoKey, plinkoRtp } from '@/engine/games/plinko';

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

  it('limbo table: win probability from the exact mapping, 99.00% at every target', () => {
    for (const row of GAME_CONTENT.limbo!.payoutTable!.rows) {
      const t = Math.round(Number(row[0]!.replace(/[×,]/g, '')) * 100);
      expect(row[1]).toBe(`${(limboWinProbability(t, 100) * 100).toFixed(4)}%`);
      expect(row[3]).toBe('99.00%');
    }
  });

  it('keno table: every row matches the configured multipliers and exact RTP', () => {
    const rows = GAME_CONTENT.keno!.payoutTable!.rows;
    expect(rows).toHaveLength(10);
    for (const [i, row] of rows.entries()) {
      const n = i + 1;
      const table = keno.defaultConfig.table[String(n)]!;
      const pays = row[1]!.split(', ').map((x) => x.split(' → '));
      expect(pays.map(([k]) => Number(k))).toEqual(table.flatMap((m, k) => (m > 0 ? [k] : [])));
      for (const [k, m] of pays) expect(m).toBe(`${(table[Number(k)]! / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`);
      expect(row[3]).toBe(`${(kenoRowRtp(n, table) * 100).toFixed(3)}%`);
    }
  });

  it('plinko table: half of each symmetric table and its exact RTP', () => {
    const rows = GAME_CONTENT.plinko!.payoutTable!.rows;
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      const r = Number(row[0]);
      const t = plinko.defaultConfig.tables[plinkoKey(r, row[1]!)]!;
      expect(row[2]).toBe(t.slice(0, r / 2 + 1).map((m) => (m / 100).toFixed(2)).join(' · '));
      expect(row[3]).toBe(`${(plinkoRtp(r, t) * 100).toFixed(3)}%`);
    }
  });

  it('hi-lo table: chance and first-guess multiplier for every rank', () => {
    const rows = GAME_CONTENT.hilo!.payoutTable!.rows;
    expect(rows).toHaveLength(13);
    for (const [i, row] of rows.entries()) {
      const r = i + 1;
      const higher = successNumerator(r, 'higher');
      expect(row[2]).toBe(higher ? `${(hiloMultiplierE4(hilo.defaultConfig.houseEdgeBp, [higher]) / 10_000).toFixed(4)}×` : '—');
      const lower = successNumerator(r, 'lower');
      expect(row[3]).toBe(lower ? `${lower}/13 (${((lower / 13) * 100).toFixed(2)}%)` : '—');
    }
  });

  it('every game with content has rules and maths', () => {
    for (const c of Object.values(GAME_CONTENT)) {
      expect(c.rules.length).toBeGreaterThan(2);
      expect(c.math.length).toBeGreaterThan(1);
    }
  });
});
