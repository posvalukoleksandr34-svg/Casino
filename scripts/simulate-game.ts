/**
 * Monte Carlo simulation of game implementations (runs the production engine
 * code with a fast seeded PRNG; results are SIMULATED and never mixed with
 * live analytics).
 *
 *   npx tsx scripts/simulate-game.ts blackjack [--hands N] [--rules 6-S17-3:2-DAS]
 *   npx tsx scripts/simulate-game.ts blackjack --all [--hands N] [--write]
 *   npx tsx scripts/simulate-game.ts <roulette|dice|mines|crash|slots> [--rounds N]
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import { simulateBlackjack, type BjSums } from './sim/blackjack';
import type { BlackjackConfig } from '../src/engine/games/blackjack';

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

function seedWords(): [number, number, number, number] {
  const b = randomBytes(16);
  return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)];
}

function parseRules(key: string): BlackjackConfig {
  const [decks, soft, pays, das] = key.split('-');
  return { decks: Number(decks) as 6 | 8, dealerHitsSoft17: soft === 'H17', blackjackPays: pays as '3:2' | '6:5', doubleAfterSplit: das === 'DAS' };
}

function merge(a: BjSums, b: BjSums): BjSums {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof BjSums)[]) out[k] += b[k];
  return out;
}

async function parallelBlackjack(rules: string, hands: number): Promise<BjSums> {
  const workers = Math.max(1, os.cpus().length);
  const per = Math.ceil(hands / workers);
  const results = await Promise.all(
    Array.from({ length: workers }, () =>
      run('npx', ['tsx', 'scripts/simulate-game.ts', 'blackjack-worker', '--rules', rules, '--hands', String(per)], { maxBuffer: 1 << 20 }).then(
        (r) => JSON.parse(r.stdout.trim().split('\n').pop()!) as BjSums,
      ),
    ),
  );
  return results.reduce(merge);
}

function summarise(rules: string, s: BjSums) {
  const mean = s.sum / s.hands;
  const variance = s.sumSq / s.hands - mean * mean;
  const se = Math.sqrt(variance / s.hands);
  const edge = -mean;
  return {
    rules,
    hands: s.hands,
    houseEdge: edge,
    ci95: [edge - 1.96 * se, edge + 1.96 * se] as [number, number],
    standardError: se,
    variancePerUnit: variance,
    winRate: s.wins / s.hands,
    pushRate: s.pushes / s.hands,
    lossRate: s.losses / s.hands,
    blackjackRate: s.blackjacks / s.hands,
    doublesPerHand: s.doubles / s.hands,
    splitsPerHand: s.splits / s.hands,
  };
}

async function main() {
  const game = args[0];
  if (game === 'blackjack-worker') {
    const sums = simulateBlackjack(parseRules(flag('rules')!), Number(flag('hands')), seedWords());
    console.log(JSON.stringify(sums));
    return;
  }
  if (game === 'blackjack') {
    const hands = Number(flag('hands', '4000000'));
    const all = [6, 8].flatMap((d) => ['S17', 'H17'].flatMap((h) => ['3:2', '6:5'].flatMap((p) => ['DAS', 'NDAS'].map((x) => `${d}-${h}-${p}-${x}`))));
    const keys = args.includes('--all') ? all : (flag('rules', '6-S17-3:2-DAS')!).split(',');
    const out: ReturnType<typeof summarise>[] = [];
    for (const key of keys) {
      const t0 = Date.now();
      const r = summarise(key, await parallelBlackjack(key, key === '6-S17-3:2-DAS' && args.includes('--all') ? hands * 4 : hands));
      out.push(r);
      console.log(
        `${key.padEnd(16)} edge ${(r.houseEdge * 100).toFixed(3)}%  95% CI [${(r.ci95[0] * 100).toFixed(3)}, ${(r.ci95[1] * 100).toFixed(3)}]  var ${r.variancePerUnit.toFixed(3)}  hands ${r.hands.toLocaleString()}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
      );
    }
    mkdirSync('reports', { recursive: true });
    writeFileSync(`reports/blackjack-simulation-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), method: 'basic strategy, fresh shoe per hand, no insurance', results: out }, null, 2) + '\n');
    if (args.includes('--write')) {
      const file = 'src/engine/games/blackjack/estimates.ts';
      const src = readFileSync(file, 'utf8');
      // Merge with existing entries so rule sets can be (re)simulated in separate runs.
      const lines = new Map<string, string>();
      for (const m of src.matchAll(/^  '([^']+)': (\{.*\}),$/gm)) lines.set(m[1]!, m[0]);
      for (const r of out) {
        lines.set(r.rules, `  '${r.rules}': { houseEdge: ${r.houseEdge.toFixed(6)}, ci95: [${r.ci95[0].toFixed(6)}, ${r.ci95[1].toFixed(6)}], variancePerUnit: ${r.variancePerUnit.toFixed(4)}, hands: ${r.hands} },`);
      }
      const table = all.filter((k) => lines.has(k)).map((k) => lines.get(k)!).join('\n');
      const next = src.replace(
        /\/\/ GENERATED-ESTIMATES-START[\s\S]*\/\/ GENERATED-ESTIMATES-END/,
        `// GENERATED-ESTIMATES-START (${new Date().toISOString().slice(0, 10)}, npm run sim:game -- blackjack --all --write)\nexport const ESTIMATES: Partial<Record<Key, EdgeEstimate>> = {\n${table}\n};\n// GENERATED-ESTIMATES-END`,
      );
      writeFileSync(file, next);
      console.log(`wrote ${file}`);
    }
    return;
  }
  const { simulateGeneric } = await import('./sim/generic');
  await simulateGeneric(game!, Number(flag('rounds', '1000000')));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
