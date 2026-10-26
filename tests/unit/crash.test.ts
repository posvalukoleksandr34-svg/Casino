import { describe, expect, it } from 'vitest';
import { crash, crashPointFromBits, drawCrashPoint, multiplierAt, survivalAt, timeToReach, type CrashState } from '@/engine/games/crash';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';

const config = crash.defaultConfig;
const TWO_52 = 2n ** 52n;
const rng = (nonce: number) => new HmacRandomStream({ serverSeed: 'e'.repeat(64), clientSeed: 'crash', nonce });

/** Finds a nonce whose crash point satisfies the predicate. */
function nonceWhere(pred: (e2: number) => boolean): number {
  for (let n = 0; n < 100_000; n += 1) if (pred(drawCrashPoint(rng(n), 100))) return n;
  throw new Error('no nonce found');
}

describe('crash point distribution (exact)', () => {
  it('maps the bit range as documented', () => {
    expect(crashPointFromBits(0n, 100)).toBe(100); // 0.99 → clamped to 1.00
    expect(crashPointFromBits(TWO_52 / 100n, 100)).toBe(100); // u ≈ 0.01 → ~1.00
    expect(crashPointFromBits(TWO_52 / 2n, 100)).toBe(198); // u = 0.5 → 0.99 × 2 = 1.98
    expect(crashPointFromBits(TWO_52 - 1n, 100)).toBe(1_000_000_000); // clamped
  });

  it('P(crash ≥ x) = 0.99 / x exactly in the bit space', () => {
    for (const x of [101, 150, 200, 1000, 10_000]) {
      // Smallest n with crash ≥ x, by binary search over the monotone mapping.
      let lo = 0n;
      let hi = TWO_52 - 1n;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        if (crashPointFromBits(mid, 100) >= x) hi = mid;
        else lo = mid + 1n;
      }
      const p = Number(TWO_52 - lo) / 2 ** 52;
      expect(p).toBeCloseTo(0.99 / (x / 100), 10);
      expect(survivalAt(x, 100)).toBeCloseTo(0.99 / (x / 100), 12);
    }
  });

  it('time ↔ multiplier', () => {
    expect(multiplierAt(0, config.growthPerMs)).toBe(100);
    expect(timeToReach(200, config.growthPerMs)).toBeCloseTo(Math.log(2) / 0.00006, 6);
    expect(multiplierAt(timeToReach(200, config.growthPerMs) + 1, config.growthPerMs)).toBe(200);
  });
});

describe('crash round', () => {
  it('manual cash-out before the crash pays the current multiplier', () => {
    const n = nonceWhere((e2) => e2 >= 300);
    const start = crash.start(config, { amount: 1000 }, rng(n));
    expect(start.status).toBe('OPEN');
    expect(crash.view(config, start.state, false).crashE2).toBeNull();
    const t = timeToReach(150, config.growthPerMs) + 5;
    const out = crash.act(config, start.state, { type: 'cashout' }, { elapsedMs: t });
    expect(out.status).toBe('SETTLED');
    expect(out.state.cashedOutE2).toBe(150);
    expect(out.payout).toBe(1500);
  });

  it('a cash-out request after the crash is a bust', () => {
    const n = nonceWhere((e2) => e2 >= 110 && e2 < 200);
    const s = crash.start(config, { amount: 1000 }, rng(n)).state as CrashState;
    const out = crash.act(config, s, { type: 'cashout' }, { elapsedMs: timeToReach(s.crashE2, config.growthPerMs) + 1 });
    expect(out.state.status).toBe('busted');
    expect(out.payout).toBe(0);
  });

  it('automatic cash-out wins iff target ≤ crash point, even with no further requests', () => {
    const n = nonceWhere((e2) => e2 >= 250);
    const s = crash.start(config, { amount: 1000, autoCashoutE2: 250 }, rng(n)).state;
    expect(crash.expire(config, s, { elapsedMs: timeToReach(240, config.growthPerMs) })).toBeNull();
    const done = crash.expire(config, s, { elapsedMs: 10 * 60_000 })!;
    expect(done.payout).toBe(2500);
    const m = nonceWhere((e2) => e2 >= 101 && e2 < 250);
    const lost = crash.expire(config, crash.start(config, { amount: 1000, autoCashoutE2: 250 }, rng(m)).state, { elapsedMs: 10 * 60_000 })!;
    expect(lost.payout).toBe(0);
  });

  it('the 1.00× crash busts immediately and the cap pays the cap', () => {
    const n = nonceWhere((e2) => e2 === 100);
    const r = crash.start(config, { amount: 1000 }, rng(n));
    expect(r.status).toBe('SETTLED');
    expect(r.payout).toBe(0);
    const big = nonceWhere((e2) => e2 >= config.maxMultiplierE2);
    const s = crash.start(config, { amount: 100 }, rng(big)).state;
    const capped = crash.expire(config, s, { elapsedMs: timeToReach(config.maxMultiplierE2, config.growthPerMs) + 1 })!;
    expect(capped.payout).toBe(100 * 1000);
  });

  it('max payout is the auto target or the cap; RTP is 99% for every target', () => {
    expect(crash.assess(config, { amount: 1000, autoCashoutE2: 300 }).maxPayout).toBe(3000);
    expect(crash.assess(config, { amount: 1000 }).maxPayout).toBe(1000 * 1000);
    for (const x of [101, 150, 200, 500, 10_000]) {
      const r = crash.assess(config, { amount: 10_000, autoCashoutE2: x });
      expect(r.expectedPayout / 10_000).toBeCloseTo(0.99, 6);
    }
    expect(() => crash.assess(config, { amount: 100, autoCashoutE2: config.maxMultiplierE2 + 1 })).toThrow();
  });

  it('verifier reproduces the crash point', () => {
    for (let nonce = 0; nonce < 50; nonce += 1) {
      const s = crash.start(config, { amount: 100 }, rng(nonce)).state;
      expect(verifyOutcome('crash', { serverSeed: 'e'.repeat(64), clientSeed: 'crash', nonce }).outcome.crashE2).toBe(s.crashE2);
    }
  });
});

describe('crash expiry capability', () => {
  const config = crash.defaultConfig;
  it('expire() settles exactly from expiresAfterMs and never a millisecond earlier', () => {
    for (let nonce = 0; nonce < 400; nonce += 1) {
      const auto = [undefined, 101, 150, 200, 1000, 100_000][nonce % 6];
      const start = crash.start(config, { amount: 1000, ...(auto ? { autoCashoutE2: auto } : {}) }, new HmacRandomStream({ serverSeed: 'e'.repeat(64), clientSeed: 'expiry', nonce }));
      if (start.status !== 'OPEN') {
        expect(crash.expiresAfterMs(config, start.state)).toBeNull();
        continue;
      }
      const due = crash.expiresAfterMs(config, start.state)!;
      expect(Number.isInteger(due)).toBe(true);
      expect(crash.expire(config, start.state, { elapsedMs: due - 1 })).toBeNull();
      const done = crash.expire(config, start.state, { elapsedMs: due });
      expect(done?.status).toBe('SETTLED');
      expect(crash.expiresAfterMs(config, done!.state)).toBeNull();
    }
  });

  it('games without time-based settlement declare that explicitly', async () => {
    const { getGameModule } = await import('@/engine/games/registry');
    for (const id of ['roulette', 'dice', 'mines', 'blackjack'] as const) {
      const mod = getGameModule(id);
      expect(mod.expiresAfterMs(mod.defaultConfig, {})).toBeNull();
    }
  });
});
