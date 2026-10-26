/**
 * Reproducibility metadata for simulation reports: the seed (any string,
 * hashed to the PRNG's four 32-bit words), the commit tested and the runtime.
 * A run is reproduced exactly by passing the recorded seed and parameters.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

export type SeedWords = [number, number, number, number];

/** `--seed` value, or a fresh random one (always recorded in the report). */
export function resolveSeed(arg: string | undefined): { seed: string; words: SeedWords } {
  const seed = arg && arg.trim() ? arg.trim() : randomBytes(8).toString('hex');
  return { seed, words: seedWords(seed) };
}

export function seedWords(seed: string): SeedWords {
  const h = createHash('sha256').update(seed).digest();
  const w: SeedWords = [h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)];
  if (w.every((x) => x === 0)) w[0] = 1; // xoshiro128** must not start from the all-zero state
  return w;
}

/** Independent stream i of a seed (scenarios, worker processes). */
export function deriveSeed(seed: string, i: number | string): SeedWords {
  return seedWords(`${seed}/${i}`);
}

export function provenance() {
  const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let commit = process.env.GITHUB_SHA ?? null;
  // True when the code that ran differs from `commit` (uncommitted changes).
  let uncommittedChanges: boolean | null = null;
  try {
    commit ??= git('rev-parse', 'HEAD');
    uncommittedChanges = git('status', '--porcelain', '--untracked-files=no').length > 0;
  } catch {
    /* not a git checkout */
  }
  return { generatedAt: new Date().toISOString(), commit, uncommittedChanges, node: process.version };
}

/** Appends Markdown to the GitHub Actions job summary when running in Actions. */
export function stepSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}
