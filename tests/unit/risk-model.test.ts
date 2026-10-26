import { describe, expect, it } from 'vitest';
import { crash, survivalAt } from '@/engine/games/crash';
import { diceRtp } from '@/engine/games/dice';
import { mines, strategyRtp } from '@/engine/games/mines';
import { SimulationRandom } from '@/engine/rng/sim-random';
import { chiSquareCritical, chiSquareStatistic } from '@/engine/stats';
import { Alias, defaultScenarios, quantile, simulate, type RunConfig } from '../../scripts/sim/risk-model';

const scenarios = defaultScenarios(20_000);
const rtp = (name: string) => {
  const s = scenarios.find((x) => `${x.game}:${x.name}` === name)!;
  return s.outcomes.reduce((a, o) => a + (o.p * o.payoutE4) / 10_000, 0);
};

describe('risk model inputs come from the engine', () => {
  it('exact scenarios reproduce the analytical RTPs', () => {
    expect(rtp('roulette:straight')).toBeCloseTo(36 / 37, 12);
    expect(rtp('roulette:red')).toBeCloseTo(36 / 37, 12);
    expect(rtp('dice:win chance 49.5%')).toBeCloseTo(diceRtp(4950, 100), 12);
    expect(rtp('dice:win chance 1%')).toBeCloseTo(diceRtp(100, 100), 12);
    expect(rtp('mines:3 mines, 3 picks')).toBeCloseTo(strategyRtp(mines.defaultConfig, 3, 3), 12);
    expect(rtp('crash:auto 2×')).toBeCloseTo(survivalAt(200, crash.defaultConfig.houseEdgeBp) * 2, 12);
    for (const s of scenarios) expect(s.outcomes.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 9);
  });

  it('the blackjack histogram is labelled empirical with its sample size', () => {
    const bj = scenarios.find((s) => s.game === 'blackjack')!;
    expect(bj.source).toBe('empirical (20,000 hands)');
    expect(Math.max(...bj.outcomes.map((o) => o.stakeX))).toBeLessThanOrEqual(8);
  });
});

describe('sampling and statistics', () => {
  it('alias sampling matches its weights (chi-square)', () => {
    const w = [0.5, 0.2, 0.2, 0.1];
    const a = new Alias(w);
    const rng = new SimulationRandom([9, 9, 9, 9]);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 200_000; i += 1) counts[a.sample(rng)]! += 1;
    expect(chiSquareStatistic(counts, w)).toBeLessThan(chiSquareCritical(3, 0.001));
  });

  it('quantiles flag tails the sample cannot resolve', () => {
    const v = Array.from({ length: 1000 }, (_, i) => i);
    expect(quantile(v, 0.5).value).toBeCloseTo(499.5, 6);
    expect(quantile(v, 0.99).reliable).toBe(true);
    expect(quantile(v, 0.999).reliable).toBe(false);
  });
});

describe('simulation', () => {
  const limits = { minStake: 10, maxStake: 100_000, maxPayoutPerRound: 10_000_000 };
  const cfg: RunConfig = {
    days: 5,
    paths: 40,
    roundsPerDay: 2_000,
    stakeMedian: 1_000,
    stakeSigma: 1,
    mix: { roulette: 0.3, dice: 0.25, mines: 0.15, crash: 0.15, blackjack: 0.15 },
    limits: { roulette: limits, dice: limits, mines: limits, crash: limits, blackjack: limits },
    seed: [5, 6, 7, 8],
  };

  it('is reproducible for a given seed', () => {
    const a = simulate(cfg, scenarios);
    const b = simulate(cfg, scenarios);
    expect(a.paths).toEqual(b.paths);
  });

  it('simulated mean P&L agrees with the theoretical expectation', () => {
    const { paths, theoreticalPnl } = simulate({ ...cfg, paths: 200 }, scenarios);
    const pnl = paths.map((p) => p.pnl);
    const mean = pnl.reduce((a, b) => a + b, 0) / pnl.length;
    const sd = Math.sqrt(pnl.reduce((a, b) => a + (b - mean) ** 2, 0) / (pnl.length - 1));
    expect(Math.abs(mean - theoreticalPnl)).toBeLessThan((4 * sd) / Math.sqrt(pnl.length));
  });
});
