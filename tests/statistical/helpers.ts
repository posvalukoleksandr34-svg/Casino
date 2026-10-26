import { HmacRandomStream } from '@/engine/rng/provably-fair';

/** Fixed seeds keep statistical tests reproducible; a different seed set is a different experiment. */
export const STAT_SERVER_SEED = '3b1f0c6a9d2e47f8a5c4b3e2d1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2';

export function streamFor(nonce: number, clientSeed = 'statistical-suite') {
  return new HmacRandomStream({ serverSeed: STAT_SERVER_SEED, clientSeed, nonce });
}
