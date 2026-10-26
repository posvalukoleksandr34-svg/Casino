import { describe, expect, it } from 'vitest';
import { dice } from '@/engine/games/dice';
import { roulette } from '@/engine/games/roulette';
import { createRandomStream, hashServerSeed } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';

const seed = 'c'.repeat(64);

describe('fairness verifier agrees with the game engine', () => {
  it('roulette', () => {
    for (let nonce = 0; nonce < 200; nonce += 1) {
      const input = { serverSeed: seed, clientSeed: 'verify', nonce };
      const engine = roulette.start(roulette.defaultConfig, { bets: [{ type: 'red', amount: 1 }] }, createRandomStream(input));
      expect(verifyOutcome('roulette', input).outcome.pocket).toBe(engine.state.result);
    }
  });

  it('dice', () => {
    for (let nonce = 0; nonce < 200; nonce += 1) {
      const input = { serverSeed: seed, clientSeed: 'verify', nonce };
      const engine = dice.start(dice.defaultConfig, { amount: 100, target: 5000, direction: 'under' }, createRandomStream(input));
      expect(verifyOutcome('dice', input).outcome.roll).toBe(engine.state.roll);
    }
  });

  it('reports the commitment hash for comparison', () => {
    expect(verifyOutcome('dice', { serverSeed: seed, clientSeed: 'x', nonce: 0 }).serverSeedHash).toBe(hashServerSeed(seed));
  });

  it('rejects invalid inputs', () => {
    expect(() => verifyOutcome('dice', { serverSeed: seed, clientSeed: 'has space', nonce: 0 })).toThrow();
    expect(() => verifyOutcome('dice', { serverSeed: seed, clientSeed: 'x', nonce: -1 })).toThrow();
    expect(() => verifyOutcome('poker', { serverSeed: seed, clientSeed: 'x', nonce: 0 })).toThrow();
  });
});
