/**
 * Bankroll / reserve Monte Carlo (SIMULATED; never mixed with live data).
 * Model, assumptions and limitations: scripts/sim/risk-model.ts and docs/risk.md.
 *
 *   npm run sim:risk -- [--days 30] [--paths 500] [--rounds-per-day 10000]
 *                       [--stake-median 10] [--stake-sigma 1.2]           (chips)
 *                       [--mix roulette=0.3,dice=0.25,mines=0.15,crash=0.15,blackjack=0.15]
 *                       (also limbo, keno, plinko, hilo; games not listed get 0)
 *                       [--seed 1,2,3,4 | --seed <any string>] [--blackjack-hands 200000]
 *                       [--check]
 *
 * Output: console summary + reports/risk-simulation-<timestamp>.json.
 * The same seed and parameters reproduce the same numbers.
 *
 * --check (extended verification) fails the run when the simulator disagrees
 * with itself or with the configured caps: the simulated mean house P&L must
 * lie within 4 standard errors of the exact expectation for the sampled
 * stakes, and no single payout may exceed the largest per-round payout cap.
 * It does NOT judge whether the configured reserve is adequate — that is a
 * business decision informed by the printed quantiles (docs/risk.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CATALOG } from '../src/server/games/catalog';
import { DEFAULT_PLATFORM } from '../src/server/bootstrap';
import { defaultScenarios, meanCi, quantile, RISK_GAMES, simulate, type GameId, type Limits, type RunConfig } from './sim/risk-model';
import { provenance, seedWords, stepSummary } from './sim/provenance';

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : def;
};
const CHIP = 100;
const chips = (minor: number) => (minor / CHIP).toLocaleString('en-US', { maximumFractionDigits: 0 });

function parseMix(s: string): Record<GameId, number> {
  const mix = Object.fromEntries(RISK_GAMES.map((g) => [g, 0])) as Record<GameId, number>;
  for (const part of s.split(',')) {
    const [k, v] = part.split('=');
    if (!(k! in mix) || !Number.isFinite(Number(v)) || Number(v) < 0) throw new Error(`invalid --mix entry "${part}"`);
    mix[k as GameId] = Number(v);
  }
  return mix;
}

async function main() {
  const seedArg = flag('seed', '1,2,3,4');
  const ints = seedArg.split(',').map(Number);
  // Four 32-bit integers are used as given (backwards compatible); any other string is hashed.
  const seed = (ints.length === 4 && ints.every((x) => Number.isInteger(x) && x >= 0 && x < 2 ** 32) ? ints : seedWords(seedArg)) as [number, number, number, number];
  const limits = Object.fromEntries(
    RISK_GAMES.map((g) => [g, CATALOG[g]!.limits as Limits]),
  ) as Record<GameId, Limits>;
  const cfg: RunConfig = {
    days: Number(flag('days', '30')),
    paths: Number(flag('paths', '500')),
    roundsPerDay: Number(flag('rounds-per-day', '10000')),
    stakeMedian: Number(flag('stake-median', '10')) * CHIP,
    stakeSigma: Number(flag('stake-sigma', '1.2')),
    mix: parseMix(flag('mix', 'roulette=0.3,dice=0.25,mines=0.15,crash=0.15,blackjack=0.15')),
    limits,
    seed,
  };
  for (const [k, v] of Object.entries(cfg)) if (typeof v === 'number' && !(v > 0)) throw new Error(`--${k} must be positive`);

  const t0 = Date.now();
  const scenarios = defaultScenarios(Number(flag('blackjack-hands', '200000')), seed);
  const { paths, theoreticalPnl } = simulate(cfg, scenarios);
  const seconds = (Date.now() - t0) / 1000;

  const pnl = paths.map((p) => p.pnl);
  const dd = paths.map((p) => p.maxDrawdown);
  const worstDay = paths.map((p) => p.worstDay);
  const stakes = meanCi(paths.map((p) => p.stakes));
  const mean = meanCi(pnl);
  const rounds = cfg.days * cfg.roundsPerDay;
  const largestPayoutLimit = Math.max(...Object.values(limits).map((l) => l.maxPayoutPerRound));
  const reserve = (q: number) => {
    const d = quantile(dd, q);
    return { drawdown: d.value, drawdownCi95: d.ci95, reliable: d.reliable, recommended: d.ci95[1] + largestPayoutLimit };
  };
  // Self-consistency checks (--check): see the header.
  const meanSe = (mean.ci95[1] - mean.mean) / 1.96;
  const pnlZ = meanSe > 0 ? (mean.mean - theoreticalPnl) / meanSe : 0;
  const largestObserved = Math.max(...paths.map((p) => p.largestPayout));
  const checks = {
    meanPnlWithin4Se: { z: pnlZ, passed: Math.abs(pnlZ) <= 4 },
    payoutsWithinPerRoundCap: { largestObserved, cap: largestPayoutLimit, passed: largestObserved <= largestPayoutLimit },
  };
  const passed = Object.values(checks).every((c) => c.passed);
  const report = {
    ...provenance(),
    simulated: true,
    seedArgument: seedArg,
    checks,
    passed,
    parameters: { ...cfg, stakeMedianChips: cfg.stakeMedian / CHIP, roundsPerPath: rounds },
    scenarios: scenarios.map((s) => ({ game: s.game, name: s.name, weight: s.weight, source: s.source, outcomes: s.outcomes.length })),
    results: {
      theoreticalHousePnl: theoreticalPnl,
      simulatedHousePnl: mean,
      handleMean: stakes.mean,
      realisedHoldPct: (mean.mean / stakes.mean) * 100,
      pnlQuantiles: { p0_1: quantile(pnl, 0.001), p1: quantile(pnl, 0.01), p5: quantile(pnl, 0.05), p50: quantile(pnl, 0.5) },
      probabilityHouseLosesOverHorizon: pnl.filter((x) => x < 0).length / pnl.length,
      meanLosingDays: paths.reduce((a, p) => a + p.losingDays, 0) / paths.length,
      worstDayQuantiles: { p1: quantile(worstDay, 0.01), p50: quantile(worstDay, 0.5) },
      maxDrawdownQuantiles: { p50: quantile(dd, 0.5), p99: quantile(dd, 0.99), p99_9: quantile(dd, 0.999) },
      largestSinglePayoutObserved: Math.max(...paths.map((p) => p.largestPayout)),
      reserve99: reserve(0.99),
      reserve99_9: reserve(0.999),
      stress: {
        description: 'Deterministic worst case allowed by the configured caps: every open round pays its maximum at once.',
        maxTotalExposure: DEFAULT_PLATFORM.maxTotalExposure,
        sumOfGameExposureCaps: Object.values(CATALOG).reduce((a, e) => a + (e?.limits.maxGameExposure ?? 0), 0),
        minHouseReserve: DEFAULT_PLATFORM.minHouseReserve,
      },
    },
    seconds,
  };

  mkdirSync('reports', { recursive: true });
  const file = `reports/risk-simulation-${report.generatedAt.slice(0, 19).replace(/:/g, '')}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');

  const r = report.results;
  console.log(`SIMULATED — ${cfg.paths} paths × ${cfg.days} days × ${cfg.roundsPerDay.toLocaleString('en-US')} rounds/day (${seconds.toFixed(1)} s)`);
  console.log(`handle per path            ${chips(stakes.mean)} chips`);
  console.log(`house P&L  theoretical     ${chips(theoreticalPnl)} chips`);
  console.log(`           simulated mean  ${chips(mean.mean)} chips (95% CI ${chips(mean.ci95[0])} – ${chips(mean.ci95[1])}); hold ${r.realisedHoldPct.toFixed(2)}%`);
  console.log(`           1% / 0.1% worst ${chips(r.pnlQuantiles.p1.value)} / ${chips(r.pnlQuantiles.p0_1.value)} chips`);
  console.log(`P(house loses over horizon) ${(r.probabilityHouseLosesOverHorizon * 100).toFixed(2)}%; losing days per path ${r.meanLosingDays.toFixed(1)} of ${cfg.days}`);
  console.log(`max drawdown p99 / p99.9   ${chips(r.maxDrawdownQuantiles.p99.value)} / ${chips(r.maxDrawdownQuantiles.p99_9.value)} chips`);
  console.log(`largest single payout seen ${chips(r.largestSinglePayoutObserved)} chips (per-round cap ${chips(largestPayoutLimit)})`);
  const note = (x: { reliable: boolean }) => (x.reliable ? '' : '  [NOT RESOLVED: too few paths beyond this quantile — increase --paths]');
  console.log(`reserve @99%   ≥ ${chips(r.reserve99.recommended)} chips  (upper CI of p99 drawdown + largest per-round payout cap)${note(r.reserve99)}`);
  console.log(`reserve @99.9% ≥ ${chips(r.reserve99_9.recommended)} chips${note(r.reserve99_9)}`);
  console.log(`stress: total exposure cap ${chips(r.stress.maxTotalExposure)} chips; configured minimum reserve ${chips(r.stress.minHouseReserve)} chips`);
  console.log(`checks: mean P&L z = ${pnlZ.toFixed(2)} (|z| ≤ 4), largest payout ${chips(largestObserved)} ≤ cap ${chips(largestPayoutLimit)} chips → ${passed ? 'consistent' : 'INCONSISTENT'}`);
  console.log(`report: ${file}`);
  stepSummary(
    [
      `### risk model (SIMULATED): ${args.includes('--check') ? (passed ? '✅ self-consistent' : '❌ inconsistent') : 'report only'} (seed \`${seedArg}\`, ${cfg.paths} paths × ${cfg.days} days)`,
      `* mean house P&L ${chips(mean.mean)} chips vs exact expectation ${chips(theoreticalPnl)} (z = ${pnlZ.toFixed(2)})`,
      `* P(house loses over the horizon) ${(r.probabilityHouseLosesOverHorizon * 100).toFixed(2)}%; max drawdown p99 ${chips(r.maxDrawdownQuantiles.p99.value)} chips`,
      `* reserve @99.9% ≥ ${chips(r.reserve99_9.recommended)} chips${r.reserve99_9.reliable ? '' : ' (not resolved — more paths needed)'} — a model estimate, not a guarantee`,
    ].join('\n'),
  );
  if (args.includes('--check') && !passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
