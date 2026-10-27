import { describe, expect, it } from 'vitest';
import {
  cardLabel,
  hilo,
  hiloActionSchema,
  hiloConfigSchema,
  hiloMultiplierE4,
  hiloStrategyRtp,
  likelierSide,
  maxGuesses,
  rankOf,
  sequenceLength,
  successNumerator,
  type HiloAction,
  type HiloConfig,
  type HiloState,
} from '@/engine/games/hilo';
import { GameRuleError, type StepResult } from '@/engine/games/types';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { SimulationRandom } from '@/engine/rng/sim-random';
import { verifyOutcome } from '@/engine/verify';
import { hiloRtp } from '../../scripts/sim/independent-rtp';

const config = hilo.defaultConfig;
const input = (nonce: number) => ({ serverSeed: 'd4'.repeat(32), clientSeed: 'hilo', nonce });
const rng = (nonce: number) => new HmacRandomStream(input(nonce));
const ctx = { elapsedMs: 0 };
const current = (s: HiloState) => rankOf(s.sequence[s.position]!);

/**
 * Best expected return over EVERY strategy (guess higher, guess lower, skip or
 * cash out at each point), by exhaustive search with at most `guesses` guesses
 * and `skips` skips. Ranks are uniform on 1–13 for every card.
 */
function bestReturn(cfg: HiloConfig, guesses: number, skips: number): number {
  const memo = new Map<string, number>();
  const value = (rank: number, factors: number[], g: number, s: number): number => {
    const m = factors.length ? Math.min(hiloMultiplierE4(cfg.houseEdgeBp, factors), cfg.maxMultiplierE4) : 0;
    if (factors.length && m >= cfg.maxMultiplierE4) return m / 10_000; // auto cash-out at the cap
    const key = `${rank}|${[...factors].sort().join(',')}|${g}|${s}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = factors.length ? m / 10_000 : 0; // cash out (or forfeit an unplayed round: 0)
    if (s > 0) {
      let skip = 0;
      for (let next = 1; next <= 13; next += 1) skip += value(next, factors, g, s - 1) / 13;
      best = Math.max(best, skip);
    }
    if (g > 0) {
      for (const dir of ['higher', 'lower'] as const) {
        const a = successNumerator(rank, dir);
        if (a === 0) continue;
        let v = 0;
        for (let next = 1; next <= 13; next += 1) {
          if (dir === 'higher' ? next > rank : next < rank) v += value(next, [...factors, a], g - 1, s) / 13;
        }
        best = Math.max(best, v);
      }
    }
    memo.set(key, best);
    return best;
  };
  let total = 0;
  for (let first = 1; first <= 13; first += 1) total += value(first, [], guesses, skips) / 13;
  return total;
}

function nonceWhere(pred: (s: HiloState) => boolean): number {
  for (let n = 0; n < 10_000; n += 1) if (pred(hilo.start(config, { amount: 100 }, rng(n)).state)) return n;
  throw new Error('no nonce found');
}

describe('hi-lo maths (exact)', () => {
  it('multiplier = ⌊(1 − edge) · 13^k / Π aᵢ⌋ at 4 decimals', () => {
    expect(hiloMultiplierE4(100, [12])).toBe(10_725); // Ace, higher: 0.99 × 13/12
    expect(hiloMultiplierE4(100, [6])).toBe(21_450);
    expect(hiloMultiplierE4(100, [1])).toBe(128_700);
    expect(hiloMultiplierE4(100, [12, 12])).toBe(11_618); // 0.99 × 169/144 = 1.161875
    expect(hiloMultiplierE4(100, [])).toBe(10_000);
    expect(() => hiloMultiplierE4(100, [13])).toThrow(RangeError);
    expect(() => hiloMultiplierE4(100, [0])).toThrow(RangeError);
  });

  it('success chances: strictly higher / strictly lower, ties lose', () => {
    expect(successNumerator(1, 'higher')).toBe(12);
    expect(successNumerator(1, 'lower')).toBe(0);
    expect(successNumerator(13, 'higher')).toBe(0);
    expect(successNumerator(13, 'lower')).toBe(12);
    for (let r = 1; r <= 13; r += 1) expect(successNumerator(r, 'higher') + successNumerator(r, 'lower')).toBe(12); // + 1 tie rank
    expect(likelierSide(7)).toBe('higher');
    expect(likelierSide(8)).toBe('lower');
  });

  it('fixed strategies return just under 99% (engine and independent derivation agree)', () => {
    for (const k of [1, 2, 3, 4, 5, 6]) {
      const rtp = hiloStrategyRtp(config, k);
      expect(rtp).toBeLessThanOrEqual(0.99);
      expect(rtp).toBeGreaterThan(0.9899);
      expect(rtp).toBeCloseTo(hiloRtp(k, config.houseEdgeBp, config.maxMultiplierE4), 14);
    }
  });

  it('no strategy beats 99%: exhaustive optimal play with up to 4 guesses and 3 skips', () => {
    const best = bestReturn(config, 4, 3);
    expect(best).toBeLessThanOrEqual(0.99 + 1e-12);
    expect(best).toBeGreaterThan(0.989);
    // A low cap can only lower the return.
    expect(bestReturn({ ...config, maxMultiplierE4: 20_000 }, 4, 2)).toBeLessThanOrEqual(0.99 + 1e-12);
  }, 30_000); // exhaustive search: about 1 s locally, slower on shared CI runners

  it('the pre-drawn sequence covers the longest possible round', () => {
    // The most guesses before the cap: every guess at 12/13 (slowest growth).
    let k = 0;
    while (hiloMultiplierE4(config.houseEdgeBp, Array<number>(k).fill(12)) < config.maxMultiplierE4) k += 1;
    expect(k).toBeLessThanOrEqual(maxGuesses(config));
    expect(sequenceLength(config)).toBe(1 + maxGuesses(config) + config.maxSkips);
    for (const cap of [20_000, 1_000_000, 10_000_000]) {
      const c = { ...config, maxMultiplierE4: cap };
      let j = 0;
      while (hiloMultiplierE4(c.houseEdgeBp, Array<number>(j).fill(12)) < cap) j += 1;
      expect(j).toBeLessThanOrEqual(maxGuesses(c));
    }
  });
});

describe('hi-lo rounds', () => {
  it('a guess wins exactly when the next card is strictly higher/lower', () => {
    for (let nonce = 0; nonce < 1_000; nonce += 1) {
      const start = hilo.start(config, { amount: 1_000 }, rng(nonce));
      const r = current(start.state);
      const dir = likelierSide(r);
      const next = hilo.act(config, start.state, { type: 'guess', direction: dir }, ctx);
      const nr = rankOf(start.state.sequence[1]!);
      const correct = dir === 'higher' ? nr > r : nr < r;
      expect(next.status).toBe(correct ? 'OPEN' : 'SETTLED');
      expect(next.state.steps.at(-1)).toEqual({ card: start.state.sequence[1], via: dir, correct });
      if (correct) expect(next.state.multiplierE4).toBe(hiloMultiplierE4(100, [successNumerator(r, dir)]));
      else expect(next.payout).toBe(0);
    }
  });

  it('cash-out pays ⌊stake × multiplier⌋ and needs a correct guess first', () => {
    const n = nonceWhere((s) => rankOf(s.sequence[0]!) <= 3 && rankOf(s.sequence[1]!) > rankOf(s.sequence[0]!));
    const start = hilo.start(config, { amount: 777 }, rng(n));
    expect(() => hilo.act(config, start.state, { type: 'cashout' }, ctx)).toThrow(/at least one correct guess/);
    const won = hilo.act(config, start.state, { type: 'guess', direction: 'higher' }, ctx);
    expect(won.status).toBe('OPEN');
    const cashed = hilo.act(config, won.state, { type: 'cashout' }, ctx);
    expect(cashed.status).toBe('SETTLED');
    expect(cashed.payout).toBe(Math.floor((777 * won.state.multiplierE4) / 10_000));
    expect(() => hilo.act(config, cashed.state, { type: 'cashout' }, ctx)).toThrow(GameRuleError);
  });

  it('impossible guesses are refused (higher on a King, lower on an Ace)', () => {
    const k = nonceWhere((s) => rankOf(s.sequence[0]!) === 13);
    expect(() => hilo.act(config, hilo.start(config, { amount: 100 }, rng(k)).state, { type: 'guess', direction: 'higher' }, ctx)).toThrow(/King/);
    const a = nonceWhere((s) => rankOf(s.sequence[0]!) === 1);
    expect(() => hilo.act(config, hilo.start(config, { amount: 100 }, rng(a)).state, { type: 'guess', direction: 'lower' }, ctx)).toThrow(/Ace/);
  });

  it('skips move to the next card without changing the multiplier, up to the limit', () => {
    const c = { ...config, maxSkips: 3 };
    let step = hilo.start(c, { amount: 100 }, rng(5));
    for (let i = 0; i < 3; i += 1) {
      const before = step.state.multiplierE4;
      step = hilo.act(c, step.state, { type: 'skip' }, ctx);
      expect(step.status).toBe('OPEN');
      expect(step.state.position).toBe(i + 1);
      expect(step.state.multiplierE4).toBe(before);
    }
    expect(() => hilo.act(c, step.state, { type: 'skip' }, ctx)).toThrow(/at most 3/);
  });

  it('reaching the cap cashes out automatically at the cap', () => {
    const c = { ...config, maxMultiplierE4: 20_000 };
    const n = nonceWhere((s) => rankOf(s.sequence[0]!) === 7 && rankOf(s.sequence[1]!) > 7);
    const step = hilo.act(c, hilo.start(c, { amount: 1_000 }, rng(n)).state, { type: 'guess', direction: 'higher' }, ctx);
    expect(step.status).toBe('SETTLED');
    expect(step.state.status).toBe('cashed');
    expect(step.state.multiplierE4).toBe(20_000);
    expect(step.payout).toBe(2_000);
  });

  it('random play never exhausts the sequence and respects the payout bound', () => {
    const choose = new SimulationRandom([1, 2, 3, 4]);
    for (let nonce = 0; nonce < 1_500; nonce += 1) {
      const amount = 1 + choose.nextInt(100_000);
      const assessed = hilo.assess(config, { amount });
      let step: StepResult<HiloState> = hilo.start(config, { amount }, rng(nonce));
      expect(step.risk.maxPayout).toBe(assessed.maxPayout);
      let guard = 0;
      while (step.status === 'OPEN') {
        guard += 1;
        expect(guard).toBeLessThan(sequenceLength(config) + 2);
        const s = step.state;
        const roll = choose.nextInt(10);
        let action: HiloAction;
        if (roll === 0 && s.factors.length > 0) action = { type: 'cashout' };
        else if (roll <= 3 && s.skips < config.maxSkips) action = { type: 'skip' };
        else action = { type: 'guess', direction: likelierSide(current(s)) };
        step = hilo.act(config, s, action, ctx);
        expect(step.risk.maxPayout).toBeLessThanOrEqual(assessed.maxPayout);
      }
      expect(Number.isSafeInteger(step.payout) && step.payout >= 0).toBe(true);
      expect(step.payout).toBeLessThanOrEqual(step.risk.maxPayout);
    }
  });

  it('a player who skips every allowed card and then guesses the safest side still fits in the sequence', () => {
    let step: StepResult<HiloState> = hilo.start(config, { amount: 100 }, rng(11));
    for (let i = 0; i < config.maxSkips; i += 1) step = hilo.act(config, step.state, { type: 'skip' }, ctx);
    while (step.status === 'OPEN') step = hilo.act(config, step.state, { type: 'guess', direction: likelierSide(current(step.state)) }, ctx);
    expect(step.state.position).toBeLessThan(sequenceLength(config));
  });

  it('the client view never contains cards that have not been turned over', () => {
    const start = hilo.start(config, { amount: 100 }, rng(3));
    const view = hilo.view(config, start.state, false);
    expect('sequence' in view).toBe(false);
    expect(view.steps.map((s) => s.card)).toEqual([start.state.sequence[0]]);
    expect(view.higher?.available ?? false).toBe(current(start.state) < 13);
    const ended = hilo.view(config, start.state, true);
    expect(ended.higher).toBeNull();
    expect(ended.canCashOut).toBe(false);
  });

  it('rejects malformed configuration and actions', () => {
    expect(hiloConfigSchema.safeParse(config).success).toBe(true);
    expect(hiloConfigSchema.safeParse({ ...config, maxMultiplierE4: 10_000 }).success).toBe(false);
    expect(hiloConfigSchema.safeParse({ ...config, maxSkips: -1 }).success).toBe(false);
    expect(hiloActionSchema.safeParse({ type: 'guess', direction: 'same' }).success).toBe(false);
    expect(hiloActionSchema.safeParse({ type: 'cashout', amount: 5 }).success).toBe(false);
  });

  it('the verifier shows the same card sequence', () => {
    for (let nonce = 0; nonce < 50; nonce += 1) {
      const s = hilo.start(config, { amount: 1 }, rng(nonce)).state;
      const cards = verifyOutcome('hilo', input(nonce), { cards: 20 }).outcome.cards as string[];
      expect(cards).toEqual(s.sequence.slice(0, 20).map(cardLabel));
    }
    expect(() => verifyOutcome('hilo', input(0), { cards: sequenceLength(config) + 1 })).toThrow();
  });
});
