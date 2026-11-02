import { describe, expect, it } from 'vitest';
import { analyseMachine, playSlotRound } from '@/engine/games/slots/engine';
import { CORAL_DEEP, EMBER_FRUITS, FROST_CROWN, LANTERN_HOLLOW, SANDS_OF_AURUM } from '@/engine/games/slots/machines';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

const ALPHA = 0.001;
const Z999 = 3.2905; // two-sided 99.9%

describe.each([
  ['lantern-hollow', LANTERN_HOLLOW],
  ['ember-fruits', EMBER_FRUITS],
  ['sands-of-aurum', SANDS_OF_AURUM],
  ['coral-deep', CORAL_DEEP],
  ['frost-crown', FROST_CROWN],
] as const)('%s (statistical)', (name, config) => {
  const N = 150_000;
  const a = analyseMachine(config);
  const stats = new RunningStats();
  const stopCounts = config.reels.map((r) => new Array<number>(r.length).fill(0));
  let triggers = 0;
  let hits = 0;
  for (let nonce = 0; nonce < N; nonce += 1) {
    const r = playSlotRound(config, streamFor(nonce, name));
    stats.push(r.totalE2 / 100);
    r.base.stops.forEach((s, i) => (stopCounts[i]![s]! += 1));
    if (r.freeSpins.length > 0) triggers += 1;
    if (r.base.winE2 > 0) hits += 1;
  }

  it('every reel stop is uniform (chi-square per reel)', () => {
    for (const counts of stopCounts) {
      expect(chiSquareStatistic(counts, new Array(counts.length).fill(1 / counts.length))).toBeLessThan(chiSquareCritical(counts.length - 1, ALPHA));
    }
  });

  it('the simulated return is within a 99.9% interval of the exact RTP', () => {
    // The exact standard deviation is known: use it for the interval.
    const half = (Z999 * Math.sqrt(a.varE2)) / 100 / Math.sqrt(N);
    expect(Math.abs(stats.mean - a.rtp)).toBeLessThan(half);
  });

  it('free-spin trigger rate and hit frequency match the exact values', () => {
    const p = a.triggerProbability;
    expect(Math.abs(triggers / N - p)).toBeLessThan(Z999 * Math.sqrt((p * (1 - p)) / N));
    const h = a.hitFrequency;
    expect(Math.abs(hits / N - h)).toBeLessThan(Z999 * Math.sqrt((h * (1 - h)) / N));
  });

  it('no round exceeds the exact maximum, and the sample variance agrees with the exact one', () => {
    expect(stats.max * 100).toBeLessThanOrEqual(a.maxTotalE2);
    // Heavy-tailed: allow a wide band for the variance (it is dominated by rare large wins).
    const ratio = stats.variance / (a.varE2 / 10_000);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
