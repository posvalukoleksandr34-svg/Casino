import { describe, expect, it } from 'vitest';
import { crashPointFromBits, drawCrashPoint } from '@/engine/games/crash';
import { limbo, limboBetSchema, limboConfigSchema, limboWinNumerator, limboWinProbability } from '@/engine/games/limbo';
import { GameRuleError } from '@/engine/games/types';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';

const config = limbo.defaultConfig;
const TWO_52 = 2n ** 52n;
const input = (nonce: number) => ({ serverSeed: 'a1'.repeat(32), clientSeed: 'limbo', nonce });
const rng = (nonce: number) => new HmacRandomStream(input(nonce));

describe('limbo maths (exact)', () => {
  it('P(result ≥ T) equals the count of 52-bit values that reach T (binary search over the mapping)', () => {
    for (const t of [101, 150, 200, 777, 1_000, 10_000, 100_000, 1_000_000]) {
      let lo = 0n;
      let hi = TWO_52 - 1n;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        if (crashPointFromBits(mid, 100) >= t) hi = mid;
        else lo = mid + 1n;
      }
      expect(TWO_52 - lo).toBe(limboWinNumerator(t, 100));
    }
  });

  it('RTP ≤ 1 − edge for every target 1.01×–100.00× and a sample above (exact integer check)', () => {
    for (const h of [100, 250]) {
      const bound = BigInt(10_000 - h) * TWO_52 * 100n;
      const targets = [...Array.from({ length: 10_000 - 100 }, (_, i) => 101 + i), 12_345, 99_999, 500_000, 1_000_000];
      for (const t of targets) {
        // count / 2⁵² × T / 100 ≤ (10000 − h) / 10000  ⟺  count · T · 10000 ≤ (10000 − h) · 2⁵² · 100
        expect(limboWinNumerator(t, h) * BigInt(t) * 10_000n <= bound).toBe(true);
      }
    }
    expect(limboWinProbability(200, 100) * 2).toBeCloseTo(0.99, 14);
    expect(limbo.theoretical(config)).toMatchObject({ rtp: 0.99, method: 'exact' });
  });
});

describe('limbo rounds', () => {
  it('draws the Crash result, wins on result ≥ target (a tie wins) and pays ⌊stake × T⌋', () => {
    let ties = 0;
    for (let nonce = 0; nonce < 2_000; nonce += 1) {
      const result = drawCrashPoint(rng(nonce), 100);
      const target = result >= 101 && nonce % 3 === 0 ? result : 150 + (nonce % 300);
      const step = limbo.start(config, { amount: 1_234, targetE2: target }, rng(nonce));
      expect(step.status).toBe('SETTLED');
      expect(step.state.resultE2).toBe(result);
      expect(step.state.won).toBe(result >= target);
      expect(step.payout).toBe(result >= target ? Math.floor((1_234 * target) / 100) : 0);
      expect(step.payout).toBeLessThanOrEqual(step.risk.maxPayout);
      if (result === target) ties += 1;
    }
    expect(ties).toBeGreaterThan(100);
  });

  it('the result does not depend on the target or stake', () => {
    const a = limbo.start(config, { amount: 10, targetE2: 101 }, rng(7)).state.resultE2;
    const b = limbo.start(config, { amount: 99_999, targetE2: 1_000_000 }, rng(7)).state.resultE2;
    expect(a).toBe(b);
  });

  it('risk profile: maxPayout is the win, expectation is win × P(win)', () => {
    const r = limbo.assess(config, { amount: 10_000, targetE2: 200 });
    expect(r.maxPayout).toBe(20_000);
    expect(r.expectedPayout).toBeCloseTo(20_000 * limboWinProbability(200, 100), 6);
    expect(r.payoutVariance).toBeCloseTo(20_000 ** 2 * 0.495 * 0.505, 0);
  });

  it('rejects targets outside the configuration and malformed bets', () => {
    const narrow = { ...config, maxTargetE2: 10_000 };
    expect(() => limbo.assess(narrow, { amount: 100, targetE2: 10_001 })).toThrow(GameRuleError);
    expect(() => limbo.assess({ ...config, minTargetE2: 200 }, { amount: 100, targetE2: 150 })).toThrow(/between 2.00× and/);
    for (const bad of [
      { amount: 100, targetE2: 100 },
      { amount: 100, targetE2: 150.5 },
      { amount: 0, targetE2: 200 },
      { amount: 100, targetE2: 200, extra: 1 },
      { amount: 100 },
    ]) {
      expect(limboBetSchema.safeParse(bad).success).toBe(false);
    }
    expect(limboConfigSchema.safeParse({ houseEdgeBp: 100, minTargetE2: 500, maxTargetE2: 500 }).success).toBe(false);
    expect(limboConfigSchema.safeParse({ houseEdgeBp: 0, minTargetE2: 101, maxTargetE2: 500 }).success).toBe(false);
    expect(limboConfigSchema.safeParse(config).success).toBe(true);
  });

  it('is not interactive', () => {
    const step = limbo.start(config, { amount: 100, targetE2: 200 }, rng(1));
    expect(() => limbo.act(config, step.state, undefined as never, { elapsedMs: 0 })).toThrow(/settle immediately/);
  });

  it('the verifier recomputes the same result', () => {
    for (let nonce = 0; nonce < 100; nonce += 1) {
      const step = limbo.start(config, { amount: 100, targetE2: 200 }, rng(nonce));
      expect(verifyOutcome('limbo', input(nonce)).outcome.resultE2).toBe(step.state.resultE2);
    }
  });
});
