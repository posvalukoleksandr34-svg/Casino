/**
 * Monte Carlo checks for the games whose RTP is known exactly: each scenario
 * runs the production engine with a seeded simulation PRNG and compares the
 * realised RTP with the analytical value. Results are SIMULATED.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crash, survivalAt, timeToReach, type CrashState } from '../../src/engine/games/crash';
import { dice, diceRtp } from '../../src/engine/games/dice';
import { mines, strategyRtp, type MinesState } from '../../src/engine/games/mines';
import { roulette } from '../../src/engine/games/roulette';
import { RunningStats } from '../../src/engine/stats';
import { SimulationRandom } from '../../src/engine/rng/sim-random';
import type { RandomSource } from '../../src/engine/rng/provably-fair';

interface Scenario {
  name: string;
  /** Exact theoretical RTP for this scenario. */
  rtp: number;
  /** Plays one round with a stake of 100 minor units and returns the payout. */
  play(rng: RandomSource): number;
}

const STAKE = 10_000;

function scenarios(game: string): Scenario[] {
  switch (game) {
    case 'roulette': {
      const c = roulette.defaultConfig;
      return [
        { name: 'straight 17', rtp: 36 / 37, play: (r) => roulette.start(c, { bets: [{ type: 'straight', number: 17, amount: STAKE }] }, r).payout },
        { name: 'red', rtp: 36 / 37, play: (r) => roulette.start(c, { bets: [{ type: 'red', amount: STAKE }] }, r).payout },
        { name: 'dozen 2', rtp: 36 / 37, play: (r) => roulette.start(c, { bets: [{ type: 'dozen', index: 2, amount: STAKE }] }, r).payout },
      ];
    }
    case 'dice': {
      const c = dice.defaultConfig;
      return [100, 4950, 9000, 9800].map((w) => ({
        name: `win chance ${(w / 100).toFixed(2)}%`,
        rtp: diceRtp(w, c.houseEdgeBp),
        play: (r: RandomSource) => dice.start(c, { amount: STAKE, target: w, direction: 'under' }, r).payout,
      }));
    }
    case 'mines': {
      const c = mines.defaultConfig;
      return [
        [1, 5],
        [3, 3],
        [5, 2],
        [10, 4],
        [24, 1],
      ].map(([m, k]) => ({
        name: `${m} mines, cash out after ${k}`,
        rtp: strategyRtp(c, m!, k!),
        play: (r: RandomSource) => {
          let step = mines.start(c, { amount: STAKE, mines: m! }, r);
          // Tile choice is irrelevant (mine positions are uniform): reveal tiles in order.
          for (let t = 0; t < k! && step.status === 'OPEN'; t += 1) step = mines.act(c, step.state as MinesState, { type: 'reveal', tile: t }, { elapsedMs: 0 });
          if (step.status === 'OPEN') step = mines.act(c, step.state as MinesState, { type: 'cashout' }, { elapsedMs: 0 });
          return step.payout;
        },
      }));
    }
    case 'crash': {
      const c = crash.defaultConfig;
      return [101, 150, 200, 1000, 10000].map((x) => ({
        name: `auto cash-out ${(x / 100).toFixed(2)}×`,
        rtp: survivalAt(x, c.houseEdgeBp) * (x / 100),
        play: (r: RandomSource) => {
          const step = crash.start(c, { amount: STAKE, autoCashoutE2: x }, r);
          if (step.status !== 'OPEN') return step.payout;
          const end = crash.expire(c, step.state as CrashState, { elapsedMs: timeToReach(c.maxMultiplierE2, c.growthPerMs) + 1 });
          return end ? end.payout : 0;
        },
      }));
    }
    default:
      throw new Error(`no generic simulation for ${game} (blackjack has its own: simulate-game.ts blackjack)`);
  }
}

function seedWords(): [number, number, number, number] {
  const b = randomBytes(16);
  return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)];
}

export async function simulateGeneric(game: string, rounds: number): Promise<void> {
  const results = [];
  for (const sc of scenarios(game)) {
    const rng = new SimulationRandom(seedWords());
    const stats = new RunningStats();
    const t0 = Date.now();
    for (let i = 0; i < rounds; i += 1) stats.push(sc.play(rng) / STAKE);
    const se = stats.standardError;
    const z = (stats.mean - sc.rtp) / se;
    const row = {
      scenario: sc.name,
      rounds: stats.n,
      theoreticalRtp: sc.rtp,
      simulatedRtp: stats.mean,
      ci95: stats.ci(0.95),
      z,
      variancePerUnit: stats.variance,
    };
    results.push(row);
    console.log(
      `${sc.name.padEnd(28)} theory ${(sc.rtp * 100).toFixed(4)}%  simulated ${(stats.mean * 100).toFixed(4)}% ± ${(1.96 * se * 100).toFixed(4)}  z ${z.toFixed(2).padStart(6)}  var ${stats.variance.toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    );
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync(`reports/${game}-simulation-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), simulated: true, game, results }, null, 2) + '\n');
  const worst = Math.max(...results.map((r) => Math.abs(r.z)));
  console.log(`max |z| = ${worst.toFixed(2)} ${worst > 4 ? '— INVESTIGATE: outside the 4σ band' : '(consistent with theory)'}`);
  // A 4σ excursion has probability ≈ 6e-5 per scenario under a correct engine.
  if (worst > 4) process.exitCode = 1;
}
