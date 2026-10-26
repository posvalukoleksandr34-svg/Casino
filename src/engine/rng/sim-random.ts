/**
 * Fast seeded PRNG (xoshiro128**) for Monte Carlo SIMULATIONS ONLY.
 * Never used to produce real game outcomes — those always come from the
 * provably fair HMAC stream. It implements RandomSource so simulations run
 * the exact same game code as production.
 */
import type { RandomSource } from './provably-fair';

const TWO_POW_32 = 0x1_0000_0000;

export class SimulationRandom implements RandomSource {
  private s: Uint32Array;
  private consumed = 0;

  /** `seed` must be four non-zero 32-bit words (e.g. from crypto.getRandomValues). */
  constructor(seed: [number, number, number, number]) {
    this.s = new Uint32Array(seed);
    if (this.s.every((v) => v === 0)) this.s[0] = 0x9e3779b9;
  }

  get bytesConsumed(): number {
    return this.consumed;
  }

  nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1]!, 5), 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3] = rotl(s[3]!, 11);
    this.consumed += 4;
    return result;
  }

  nextInt(n: number): number {
    if (n === 1) return 0;
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    for (;;) {
      const u = this.nextUint32();
      if (u < limit) return u % n;
    }
  }

  nextFloat(): number {
    const hi = this.nextUint32() >>> 12;
    const lo = this.nextUint32();
    return (hi * TWO_POW_32 + lo) / 2 ** 52;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
