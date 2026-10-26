import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashServerSeed,
  HmacRandomStream,
  isValidClientSeed,
  shuffle,
  streamBlock,
  verifyCommitment,
} from '@/engine/rng/provably-fair';

const SEED = 'a'.repeat(64);

describe('provably fair stream', () => {
  it('commitment is SHA-256 of the seed string (matches node:crypto)', () => {
    const expected = createHash('sha256').update(SEED, 'utf8').digest('hex');
    expect(hashServerSeed(SEED)).toBe(expected);
    expect(verifyCommitment(SEED, expected)).toBe(true);
    expect(verifyCommitment(SEED, expected.replace(/^./, '0'))).toBe(false);
  });

  it('blocks are HMAC-SHA256(serverSeed, "client:nonce:index") (matches node:crypto)', () => {
    const input = { serverSeed: SEED, clientSeed: 'player-seed', nonce: 42 };
    for (const i of [0, 1, 7]) {
      const expected = createHmac('sha256', SEED).update(`player-seed:42:${i}`).digest();
      expect(Buffer.from(streamBlock(input, i)).equals(expected)).toBe(true);
    }
  });

  it('reads big-endian uint32 values in order across block boundaries', () => {
    const input = { serverSeed: SEED, clientSeed: 'c', nonce: 0 };
    const bytes = Buffer.concat([
      createHmac('sha256', SEED).update('c:0:0').digest(),
      createHmac('sha256', SEED).update('c:0:1').digest(),
    ]);
    const rng = new HmacRandomStream(input);
    for (let i = 0; i < 16; i += 1) {
      expect(rng.nextUint32()).toBe(bytes.readUInt32BE(i * 4));
    }
    expect(rng.bytesConsumed).toBe(64);
  });

  it('is deterministic for identical inputs and differs when any input changes', () => {
    const draw = (serverSeed: string, clientSeed: string, nonce: number) => {
      const rng = new HmacRandomStream({ serverSeed, clientSeed, nonce });
      return Array.from({ length: 8 }, () => rng.nextInt(1000));
    };
    expect(draw(SEED, 'x', 1)).toEqual(draw(SEED, 'x', 1));
    expect(draw(SEED, 'x', 1)).not.toEqual(draw(SEED, 'x', 2));
    expect(draw(SEED, 'x', 1)).not.toEqual(draw(SEED, 'y', 1));
    expect(draw(SEED, 'x', 1)).not.toEqual(draw('b'.repeat(64), 'x', 1));
  });

  it('nextInt stays in range, handles n = 1 and n = 2^32', () => {
    const rng = new HmacRandomStream({ serverSeed: SEED, clientSeed: 'r', nonce: 3 });
    for (let i = 0; i < 2000; i += 1) {
      const v = rng.nextInt(37);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(37);
    }
    expect(rng.nextInt(1)).toBe(0);
    const big = rng.nextInt(2 ** 32);
    expect(big).toBeGreaterThanOrEqual(0);
    expect(big).toBeLessThan(2 ** 32);
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(2 ** 32 + 1)).toThrow();
    expect(() => rng.nextInt(2.5)).toThrow();
  });

  it('rejection sampling discards values at or above the largest multiple of n', () => {
    // For n = 3·2^30 the acceptance limit is exactly 3·2^30, so roughly a quarter
    // of raw draws must be rejected; consumed bytes reveal the rejections.
    const n = 3 * 2 ** 30;
    const rng = new HmacRandomStream({ serverSeed: SEED, clientSeed: 'rej', nonce: 0 });
    let draws = 0;
    for (let i = 0; i < 4000; i += 1) {
      const before = rng.bytesConsumed;
      expect(rng.nextInt(n)).toBeLessThan(n);
      draws += (rng.bytesConsumed - before) / 4;
    }
    const rejectionRate = 1 - 4000 / draws;
    expect(rejectionRate).toBeGreaterThan(0.2);
    expect(rejectionRate).toBeLessThan(0.3);
  });

  it('nextFloat is in [0, 1)', () => {
    const rng = new HmacRandomStream({ serverSeed: SEED, clientSeed: 'f', nonce: 9 });
    for (let i = 0; i < 2000; i += 1) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('shuffle produces a permutation', () => {
    const rng = new HmacRandomStream({ serverSeed: SEED, clientSeed: 's', nonce: 1 });
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), rng);
    expect([...deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it('validates client seeds and nonces', () => {
    expect(isValidClientSeed('abc')).toBe(true);
    expect(isValidClientSeed('')).toBe(false);
    expect(isValidClientSeed('has space')).toBe(false);
    expect(isValidClientSeed('x'.repeat(65))).toBe(false);
    expect(() => new HmacRandomStream({ serverSeed: SEED, clientSeed: 'ok', nonce: -1 })).toThrow();
    expect(() => new HmacRandomStream({ serverSeed: SEED, clientSeed: 'bad seed', nonce: 0 })).toThrow();
  });
});
