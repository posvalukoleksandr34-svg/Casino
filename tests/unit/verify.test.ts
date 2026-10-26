import { describe, expect, it } from 'vitest';
import { blackjack, label } from '@/engine/games/blackjack';
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

  it('blackjack shoe order', () => {
    for (let nonce = 0; nonce < 50; nonce += 1) {
      const input = { serverSeed: seed, clientSeed: 'verify', nonce };
      const engine = blackjack.start(blackjack.defaultConfig, { amount: 100 }, createRandomStream(input));
      const shown = verifyOutcome('blackjack', input, { decks: 6 }).outcome.firstCards as string[];
      expect(shown).toEqual(engine.state.shoe.slice(0, shown.length).map(label));
      expect(engine.state.hands[0]!.cards.slice(0, 2).map(label)).toEqual([shown[0], shown[2]]);
      expect(engine.state.dealer.slice(0, 2).map(label)).toEqual([shown[1], shown[3]]);
    }
    expect(() => verifyOutcome('blackjack', { serverSeed: seed, clientSeed: 'x', nonce: 0 }, { decks: 7 })).toThrow();
  });

  it('blackjack verifier shows every card a long round dealt', () => {
    const input = { serverSeed: seed, clientSeed: 'verify', nonce: 3 };
    const engine = blackjack.start(blackjack.defaultConfig, { amount: 100 }, createRandomStream(input));
    const shown = verifyOutcome('blackjack', input, { decks: 6, cards: 60 }).outcome.firstCards as string[];
    expect(shown).toHaveLength(60);
    expect(shown).toEqual(engine.state.shoe.slice(0, 60).map(label));
    expect(() => verifyOutcome('blackjack', input, { decks: 6, cards: 313 })).toThrow();
    expect(() => verifyOutcome('blackjack', input, { decks: 6, cards: 2 })).toThrow();
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
