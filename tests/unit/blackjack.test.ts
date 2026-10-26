import { describe, expect, it } from 'vitest';
import {
  applyAction,
  blackjack,
  dealFromShoe,
  handTotal,
  insuranceEdge,
  type BlackjackConfig,
  type BlackjackState,
} from '@/engine/games/blackjack';
import { basicStrategy } from '@/engine/games/blackjack/strategy';
import { GameRuleError, type StepResult } from '@/engine/games/types';
import { HmacRandomStream } from '@/engine/rng/provably-fair';

const S17: BlackjackConfig = blackjack.defaultConfig;
const H17: BlackjackConfig = { ...S17, dealerHitsSoft17: true };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Builds a 6-deck shoe whose first cards have the given ranks (deal order: P, D-up, P, D-hole, then draws). */
function shoe(ranks: string[], decks = 6): number[] {
  const all = Array.from({ length: 52 * decks }, (_, i) => i);
  const used = new Set<number>();
  const head = ranks.map((r) => {
    const rank = RANKS.indexOf(r);
    const idx = all.find((i) => !used.has(i) && (i % 52) % 13 === rank)!;
    used.add(idx);
    return idx;
  });
  return [...head, ...all.filter((i) => !used.has(i))];
}

const deal = (ranks: string[], amount = 1000, config = S17) => dealFromShoe(config, { amount }, shoe(ranks));
const act = (step: StepResult<BlackjackState>, a: Parameters<typeof applyAction>[2], config = S17) => applyAction(config, step.state, a);

describe('blackjack rules', () => {
  it('hand totals handle soft aces', () => {
    const c = (r: string) => shoe([r])[0]!;
    expect(handTotal([c('A'), c('6')])).toEqual({ total: 17, soft: true });
    expect(handTotal([c('A'), c('6'), c('10')])).toEqual({ total: 17, soft: false });
    expect(handTotal([c('A'), c('A'), c('9')])).toEqual({ total: 21, soft: true });
    expect(handTotal([c('K'), c('Q'), c('2')])).toEqual({ total: 22, soft: false });
  });

  it('player blackjack pays 3:2 immediately (rounded down to the minor unit)', () => {
    const r = deal(['A', '9', 'K', '7'], 101);
    expect(r.status).toBe('SETTLED');
    expect(r.payout).toBe(101 + 151); // 101 × 1.5 = 151.5 → 151
    expect(r.state.results![0]!.outcome).toBe('blackjack');
    expect(dealFromShoe({ ...S17, blackjackPays: '6:5' }, { amount: 100 }, shoe(['A', '9', 'K', '7'])).payout).toBe(220);
  });

  it('dealer peeks with a ten up: dealer blackjack beats everything but a player blackjack', () => {
    const lose = deal(['10', 'K', '9', 'A']);
    expect(lose.status).toBe('SETTLED');
    expect(lose.payout).toBe(0);
    expect(lose.state.outcomeSummary).toBe('Dealer blackjack');
    const push = deal(['A', 'K', 'Q', 'A']);
    expect(push.payout).toBe(1000);
  });

  it('insurance is offered on an ace and pays 2:1 when the dealer has blackjack', () => {
    const r = deal(['10', 'A', '9', 'K']);
    expect(r.status).toBe('OPEN');
    expect(r.state.phase).toBe('insurance');
    const taken = act(r, { type: 'insurance', take: true });
    expect(taken.additionalStakes).toEqual([{ kind: 'insurance', amount: 500, maxAddedPayout: 1500 }]);
    expect(taken.status).toBe('SETTLED');
    expect(taken.payout).toBe(1500); // main hand lost, insurance 500 × 3
    expect(act(r, { type: 'insurance', take: false }).payout).toBe(0);
  });

  it('insurance is lost when the dealer has no blackjack and play continues', () => {
    const r = act(deal(['10', 'A', '9', '7', '5']), { type: 'insurance', take: true });
    expect(r.status).toBe('OPEN');
    expect(r.state.phase).toBe('player');
    const done = act(r, { type: 'stand' }); // 19 vs dealer A7 = soft 18 → stands (S17)
    expect(done.state.results![0]!.outcome).toBe('win');
    expect(done.payout).toBe(2000); // insurance lost
  });

  it('busting loses immediately and the dealer does not draw', () => {
    const r = act(deal(['10', '9', '6', '7', 'K', '5']), { type: 'hit' });
    expect(r.status).toBe('SETTLED');
    expect(r.state.results![0]!.outcome).toBe('bust');
    expect(r.state.dealer).toHaveLength(2);
  });

  it('dealer stands on soft 17 (S17) and hits it under H17', () => {
    const s17 = act(deal(['10', 'A', '8', '6', '3']), { type: 'insurance', take: false });
    const done = act(s17, { type: 'stand' });
    expect(handTotal(done.state.dealer)).toEqual({ total: 17, soft: true });
    expect(done.state.results![0]!.outcome).toBe('win');
    const h = act(deal(['10', 'A', '8', '6', '3'], 1000, H17), { type: 'insurance', take: false }, H17);
    const doneH = act(h, { type: 'stand' }, H17);
    expect(doneH.state.dealer.length).toBe(3); // drew to the soft 17
  });

  it('double: one card, stake doubled, additional wager with an outcome-independent bound', () => {
    const r = act(deal(['6', '6', '5', '10', '10', '8']), { type: 'double' });
    expect(r.additionalStakes).toEqual([{ kind: 'double', amount: 1000, selection: { hand: 0 }, maxAddedPayout: 2000 }]);
    expect(r.state.hands[0]!.cards).toHaveLength(3);
    expect(r.state.hands[0]!.stake).toBe(2000);
    expect(r.status).toBe('SETTLED'); // 21 vs dealer 6,10 → draws 8 → 24 bust
    expect(r.payout).toBe(4000);
  });

  it('split pairs: two hands each receive a card; extra stake equals the original', () => {
    const r = act(deal(['8', '10', '8', '7', '3', '2']), { type: 'split' });
    expect(r.state.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(r.additionalStakes[0]).toMatchObject({ kind: 'split', amount: 1000, maxAddedPayout: 2000 });
    expect(r.risk.stake).toBe(2000);
    const a = act(r, { type: 'stand' }); // hand 1: 8,3 = 11
    expect(a.state.active).toBe(1);
    const b = act(a, { type: 'stand' }); // hand 2: 8,2 = 10; dealer 10,7 = 17
    expect(b.status).toBe('SETTLED');
    expect(b.payout).toBe(0);
  });

  it('split aces get one card each and 21 is not a blackjack', () => {
    const r = act(deal(['A', '9', 'A', '7', 'K', 'Q']), { type: 'split' });
    expect(r.status).toBe('SETTLED');
    expect(r.state.results!.map((x) => x.outcome)).toEqual(['win', 'win']);
    expect(r.payout).toBe(4000); // 2 × (2 × 1000), not 3:2
  });

  it('respects the four-hand limit, no re-split of aces and the DAS flag', () => {
    let r = deal(['8', '10', '8', '7', '8', '8', '8', '2', '2', '2', '2']);
    r = act(r, { type: 'split' });
    r = act(r, { type: 'split' });
    r = act(r, { type: 'split' });
    expect(r.state.hands).toHaveLength(4);
    expect(() => act(r, { type: 'split' })).toThrow(GameRuleError);
    const aces = act(deal(['A', '9', 'A', '7', 'A', '5']), { type: 'split' });
    expect(aces.status).toBe('SETTLED');
    const nodas = { ...S17, doubleAfterSplit: false };
    const ns = act(deal(['8', '10', '8', '7', '3', '2'], 1000, nodas), { type: 'split' }, nodas);
    expect(() => act(ns, { type: 'double' }, nodas)).toThrow(GameRuleError);
  });

  it('view hides the hole card and the shoe until the hand is over', () => {
    const r = deal(['10', '9', '7', '8']);
    const v = blackjack.view(S17, r.state, false);
    expect(v.dealer).toEqual([r.state.dealer[0], null]);
    expect('shoe' in v).toBe(false);
    expect(v.allowed).toEqual(['hit', 'stand', 'double']);
    const settledView = blackjack.view(S17, act(r, { type: 'stand' }).state, true);
    expect(settledView.dealer.every((c) => c !== null)).toBe(true);
  });

  it('start() deals from a provably fair shuffle of 312 cards', () => {
    const r = blackjack.start(S17, { amount: 100 }, new HmacRandomStream({ serverSeed: 'b'.repeat(64), clientSeed: 'bj', nonce: 1 }));
    expect(r.state.shoe).toHaveLength(312);
    expect(new Set(r.state.shoe).size).toBe(312);
  });

  it('insurance edge for 6 decks ≈ 7.40%', () => {
    expect(insuranceEdge(6)).toBeCloseTo(1 - (3 * 96) / 311, 12);
    expect(insuranceEdge(6)).toBeCloseTo(0.074, 3);
  });
});

describe('basic strategy', () => {
  const c = (r: string) => shoe([r])[0]!;
  const rules = { dealerHitsSoft17: false, doubleAfterSplit: true };
  const all = ['hit', 'stand', 'double', 'split'] as const;
  it.each([
    [['10', '6'], '10', 'hit'],
    [['10', '6'], '6', 'stand'],
    [['10', '2'], '3', 'hit'],
    [['10', '2'], '4', 'stand'],
    [['6', '5'], 'A', 'hit'],
    [['6', '5'], '10', 'double'],
    [['A', '7'], '9', 'hit'],
    [['A', '7'], '2', 'stand'],
    [['A', '7'], '5', 'double'],
    [['8', '8'], '10', 'split'],
    [['10', '10'], '6', 'stand'],
    [['9', '9'], '7', 'stand'],
    [['9', '9'], '8', 'split'],
    [['5', '5'], '9', 'double'],
    [['A', 'A'], 'A', 'split'],
  ])('%j vs %s → %s', (cards, up, expected) => {
    expect(basicStrategy(cards.map(c), c(up), all, rules)).toBe(expected);
  });

  it('falls back when doubling is not allowed', () => {
    expect(basicStrategy([c('6'), c('5')], c('6'), ['hit', 'stand'], rules)).toBe('hit');
    expect(basicStrategy([c('A'), c('7')], c('5'), ['hit', 'stand'], rules)).toBe('stand');
  });
});
