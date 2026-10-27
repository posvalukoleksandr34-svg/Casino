/**
 * Monte Carlo checks for the games whose RTP is known exactly: each scenario
 * runs the production engine with a seeded simulation PRNG and compares the
 * realised RTP with the analytical value. Results are SIMULATED.
 *
 * Expected values come from scripts/sim/independent-rtp.ts (the published
 * rules, implemented without engine code); the engine's own theory function
 * must agree with them too. Acceptance: |z| ≤ 4 per scenario (two-sided
 * α ≈ 6.3·10⁻⁵); over the 31 scenarios of an extended run the family-wise
 * false-alarm probability is ≤ 31 · 6.3·10⁻⁵ ≈ 2.0·10⁻³ (Bonferroni), i.e. about
 * one spurious failure in 10 years of weekly runs. Each report also states the
 * smallest RTP bias the run could detect (4 standard errors).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crash, survivalAt, timeToReach, type CrashState } from '../../src/engine/games/crash';
import { dice, diceRtp as engineDiceRtp } from '../../src/engine/games/dice';
import { hilo, hiloStrategyRtp, likelierSide, rankOf, type HiloState } from '../../src/engine/games/hilo';
import { keno, kenoRowRtp } from '../../src/engine/games/keno';
import { limbo, limboWinProbability } from '../../src/engine/games/limbo';
import { mines, strategyRtp, type MinesState } from '../../src/engine/games/mines';
import { plinko, plinkoKey, plinkoRtp as enginePlinkoRtp, type PlinkoRisk, type PlinkoRows } from '../../src/engine/games/plinko';
import { roulette } from '../../src/engine/games/roulette';
import { RunningStats } from '../../src/engine/stats';
import { SimulationRandom } from '../../src/engine/rng/sim-random';
import type { RandomSource } from '../../src/engine/rng/provably-fair';
import { crashAutoRtp, diceRtp, hiloRtp, kenoRtp, limboRtp, minesRtp, plinkoRtp, rouletteRtp } from './independent-rtp';
import { deriveSeed, provenance, resolveSeed, stepSummary } from './provenance';

interface Scenario {
  name: string;
  /** Exact theoretical RTP from the published rules (independent of the engine). */
  rtp: number;
  /** The engine's own theoretical value for the same scenario. */
  engineRtp: number;
  /** Plays one round with a stake of STAKE minor units and returns the payout. */
  play(rng: RandomSource): number;
}

const STAKE = 10_000;
const Z_LIMIT = 4;

function scenarios(game: string): Scenario[] {
  switch (game) {
    case 'roulette': {
      const c = roulette.defaultConfig;
      return [
        { name: 'straight 17', rtp: rouletteRtp(), engineRtp: roulette.theoretical(c).rtp, play: (r) => roulette.start(c, { bets: [{ type: 'straight', number: 17, amount: STAKE }] }, r).payout },
        { name: 'red', rtp: rouletteRtp(), engineRtp: roulette.theoretical(c).rtp, play: (r) => roulette.start(c, { bets: [{ type: 'red', amount: STAKE }] }, r).payout },
        { name: 'dozen 2', rtp: rouletteRtp(), engineRtp: roulette.theoretical(c).rtp, play: (r) => roulette.start(c, { bets: [{ type: 'dozen', index: 2, amount: STAKE }] }, r).payout },
      ];
    }
    case 'dice': {
      const c = dice.defaultConfig;
      return [100, 4950, 9000, 9800].map((w) => ({
        name: `win chance ${(w / 100).toFixed(2)}%`,
        rtp: diceRtp(w, c.houseEdgeBp),
        engineRtp: engineDiceRtp(w, c.houseEdgeBp),
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
        rtp: minesRtp(m!, k!, c.houseEdgeBp, c.maxMultiplierE4),
        engineRtp: strategyRtp(c, m!, k!),
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
        rtp: crashAutoRtp(x, c.houseEdgeBp),
        engineRtp: survivalAt(x, c.houseEdgeBp) * (x / 100),
        play: (r: RandomSource) => {
          const step = crash.start(c, { amount: STAKE, autoCashoutE2: x }, r);
          if (step.status !== 'OPEN') return step.payout;
          const end = crash.expire(c, step.state as CrashState, { elapsedMs: timeToReach(c.maxMultiplierE2, c.growthPerMs) + 1 });
          return end ? end.payout : 0;
        },
      }));
    }
    case 'limbo': {
      const c = limbo.defaultConfig;
      return [101, 200, 1000, 10000].map((t) => ({
        name: `target ${(t / 100).toFixed(2)}×`,
        rtp: limboRtp(t, c.houseEdgeBp),
        engineRtp: limboWinProbability(t, c.houseEdgeBp) * (t / 100),
        play: (r: RandomSource) => limbo.start(c, { amount: STAKE, targetE2: t }, r).payout,
      }));
    }
    case 'keno': {
      const c = keno.defaultConfig;
      return [1, 4, 7, 10].map((n) => {
        const row = c.table[String(n)]!;
        // Which numbers are picked is irrelevant (the draw is uniform): pick 1…n.
        const picks = Array.from({ length: n }, (_, i) => i + 1);
        return {
          name: `${n} pick${n === 1 ? '' : 's'}`,
          rtp: kenoRtp(n, row),
          engineRtp: kenoRowRtp(n, row),
          play: (r: RandomSource) => keno.start(c, { amount: STAKE, picks }, r).payout,
        };
      });
    }
    case 'plinko': {
      const c = plinko.defaultConfig;
      const cases: [PlinkoRows, PlinkoRisk][] = [[8, 'low'], [12, 'medium'], [16, 'high']];
      return cases.map(([rows, risk]) => {
        const table = c.tables[plinkoKey(rows, risk)]!;
        return {
          name: `${rows} rows, ${risk} risk`,
          rtp: plinkoRtp(rows, table),
          engineRtp: enginePlinkoRtp(rows, table),
          play: (r: RandomSource) => plinko.start(c, { amount: STAKE, rows, risk }, r).payout,
        };
      });
    }
    case 'hilo': {
      const c = hilo.defaultConfig;
      return [1, 3, 6].map((k) => ({
        name: `likelier side, cash out after ${k}`,
        rtp: hiloRtp(k, c.houseEdgeBp, c.maxMultiplierE4),
        engineRtp: hiloStrategyRtp(c, k),
        play: (r: RandomSource) => {
          let step = hilo.start(c, { amount: STAKE }, r);
          while (step.status === 'OPEN' && (step.state as HiloState).factors.length < k) {
            const s = step.state as HiloState;
            step = hilo.act(c, s, { type: 'guess', direction: likelierSide(rankOf(s.sequence[s.position]!)) }, { elapsedMs: 0 });
          }
          if (step.status === 'OPEN') step = hilo.act(c, step.state as HiloState, { type: 'cashout' }, { elapsedMs: 0 });
          return step.payout;
        },
      }));
    }
    default:
      throw new Error(`no generic simulation for ${game} (blackjack has its own: simulate-game.ts blackjack)`);
  }
}

export async function simulateGeneric(game: string, rounds: number, seedArg?: string): Promise<void> {
  if (!Number.isInteger(rounds) || rounds < 1_000) throw new Error('--rounds must be an integer ≥ 1000');
  const { seed } = resolveSeed(seedArg);
  const results = [];
  let failed = false;
  for (const [i, sc] of scenarios(game).entries()) {
    // The engine's theory must match the published rule (exact games: within float rounding).
    const theoryGap = Math.abs(sc.engineRtp - sc.rtp);
    if (theoryGap > 1e-9) {
      console.error(`${sc.name}: engine theory ${sc.engineRtp} disagrees with the published rule ${sc.rtp}`);
      failed = true;
    }
    const rng = new SimulationRandom(deriveSeed(seed, `${game}/${i}`));
    const stats = new RunningStats();
    const t0 = Date.now();
    for (let n = 0; n < rounds; n += 1) {
      const payout = sc.play(rng);
      if (!Number.isSafeInteger(payout) || payout < 0) throw new Error(`${sc.name}: invalid payout ${payout}`);
      stats.push(payout / STAKE);
    }
    const se = stats.standardError;
    const z = (stats.mean - sc.rtp) / se;
    if (!Number.isFinite(z) || Math.abs(z) > Z_LIMIT) failed = true;
    const row = {
      scenario: sc.name,
      rounds: stats.n,
      theoreticalRtp: sc.rtp,
      engineTheoreticalRtp: sc.engineRtp,
      simulatedRtp: stats.mean,
      ci95: stats.ci(0.95),
      z,
      detectableBias: Z_LIMIT * se,
      variancePerUnit: stats.variance,
    };
    results.push(row);
    console.log(
      `${sc.name.padEnd(28)} theory ${(sc.rtp * 100).toFixed(4)}%  simulated ${(stats.mean * 100).toFixed(4)}% ± ${(1.96 * se * 100).toFixed(4)}  z ${z.toFixed(2).padStart(6)}  detects ≥ ${(Z_LIMIT * se * 100).toFixed(3)} pp  (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    );
  }
  const meta = provenance();
  mkdirSync('reports', { recursive: true });
  const file = `reports/${game}-simulation-${meta.generatedAt.slice(0, 19).replace(/:/g, '')}.json`;
  writeFileSync(file, JSON.stringify({ ...meta, simulated: true, game, seed, roundsPerScenario: rounds, zLimit: Z_LIMIT, passed: !failed, results }, null, 2) + '\n');
  const worst = Math.max(...results.map((r) => Math.abs(r.z)));
  console.log(`seed ${seed} · max |z| = ${worst.toFixed(2)} ${failed ? '— FAILED (see above)' : '(consistent with theory)'} · ${file}`);
  stepSummary(
    [
      `### ${game}: ${failed ? '❌ failed' : '✅ passed'} (seed \`${seed}\`, ${rounds.toLocaleString('en-US')} rounds per scenario)`,
      '| scenario | theory | simulated | z | detects ≥ |',
      '|---|---|---|---|---|',
      ...results.map((r) => `| ${r.scenario} | ${(r.theoreticalRtp * 100).toFixed(4)}% | ${(r.simulatedRtp * 100).toFixed(4)}% | ${r.z.toFixed(2)} | ${(r.detectableBias * 100).toFixed(3)} pp |`),
    ].join('\n'),
  );
  if (failed) process.exitCode = 1;
}
