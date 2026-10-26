/**
 * Provably fair random stream (isomorphic: runs on the server and in the
 * browser-based verifier with identical results).
 *
 * Protocol (see docs/fairness.md):
 *   commitment   = hex(SHA-256(utf8(serverSeed)))            published before play
 *   block(i)     = HMAC-SHA256(key = utf8(serverSeed),
 *                              msg = utf8(`${clientSeed}:${nonce}:${i}`))   i = 0,1,2,…
 *   byte stream  = block(0) ‖ block(1) ‖ …
 *
 * Bytes are consumed in order; integers are read big-endian. Mapping bytes to
 * game outcomes uses rejection sampling, so every outcome in [0, n) is exactly
 * equally likely (no modulo bias).
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const TWO_POW_32 = 0x1_0000_0000;

export interface RandomSource {
  /** Uniform integer in [0, 2^32). */
  nextUint32(): number;
  /** Uniform integer in [0, n) for 1 <= n <= 2^32, unbiased (rejection sampling). */
  nextInt(n: number): number;
  /** Uniform float in [0, 1) with 52 bits of precision. */
  nextFloat(): number;
  /** Number of bytes consumed so far (useful for audits and tests). */
  readonly bytesConsumed: number;
}

export interface FairnessInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export const SERVER_SEED_HEX_LENGTH = 64;
export const CLIENT_SEED_MAX_LENGTH = 64;
const CLIENT_SEED_PATTERN = /^[\x21-\x7e]{1,64}$/;

export function isValidClientSeed(seed: string): boolean {
  return CLIENT_SEED_PATTERN.test(seed);
}

export function isValidServerSeed(seed: string): boolean {
  return /^[0-9a-f]{64}$/.test(seed);
}

/** SHA-256 commitment to a server seed, as lowercase hex. */
export function hashServerSeed(serverSeed: string): string {
  return bytesToHex(sha256(utf8ToBytes(serverSeed)));
}

export function verifyCommitment(serverSeed: string, commitment: string): boolean {
  return hashServerSeed(serverSeed) === commitment.toLowerCase();
}

/** Raw HMAC block i of the stream. Exposed for verification tooling. */
export function streamBlock(input: FairnessInput, index: number): Uint8Array {
  return hmac(sha256, utf8ToBytes(input.serverSeed), utf8ToBytes(`${input.clientSeed}:${input.nonce}:${index}`));
}

export class HmacRandomStream implements RandomSource {
  private block: Uint8Array = new Uint8Array(0);
  private blockIndex = 0;
  private offset = 0;
  private consumed = 0;

  constructor(private readonly input: FairnessInput) {
    if (!Number.isSafeInteger(input.nonce) || input.nonce < 0) {
      throw new Error('nonce must be a non-negative safe integer');
    }
    if (input.serverSeed.length === 0) throw new Error('server seed must not be empty');
    if (!isValidClientSeed(input.clientSeed)) throw new Error('invalid client seed');
  }

  get bytesConsumed(): number {
    return this.consumed;
  }

  private nextByte(): number {
    if (this.offset >= this.block.length) {
      this.block = streamBlock(this.input, this.blockIndex);
      this.blockIndex += 1;
      this.offset = 0;
    }
    const b = this.block[this.offset];
    this.offset += 1;
    this.consumed += 1;
    return b as number;
  }

  nextUint32(): number {
    // Big-endian; multiply instead of shifting to stay in unsigned range.
    return ((this.nextByte() * 256 + this.nextByte()) * 256 + this.nextByte()) * 256 + this.nextByte();
  }

  nextInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
      throw new Error(`nextInt bound must be an integer in [1, 2^32], got ${n}`);
    }
    if (n === 1) return 0;
    // Largest multiple of n not exceeding 2^32; values at or above it are rejected.
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    for (;;) {
      const u = this.nextUint32();
      if (u < limit) return u % n;
    }
  }

  nextFloat(): number {
    // 52 bits: 20 high bits from one word, 32 low bits from the next.
    const hi = this.nextUint32() >>> 12;
    const lo = this.nextUint32();
    return (hi * TWO_POW_32 + lo) / 2 ** 52;
  }
}

/** In-place Fisher–Yates shuffle driven by `rng` (unbiased given unbiased nextInt). */
export function shuffle<T>(items: T[], rng: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

export function createRandomStream(input: FairnessInput): RandomSource {
  return new HmacRandomStream(input);
}
