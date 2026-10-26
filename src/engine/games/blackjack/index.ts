/**
 * Blackjack. Each round deals from a freshly shuffled shoe (provably fair
 * Fisher–Yates over 52·decks cards), so card counting is impossible.
 *
 * Rules (default configuration): 6 decks · dealer stands on soft 17 · dealer
 * peeks for blackjack with an ace or ten up · blackjack pays 3:2 · double on
 * any first two cards, also after a split · split equal-value pairs up to 4
 * hands · split aces receive one card each and cannot be re-split · no
 * surrender · insurance (half the bet) pays 2:1 when the dealer shows an ace.
 *
 * Card order is fixed by the shuffle: player, dealer up, player, dealer hole,
 * then cards are drawn in the order actions request them (on a split both new
 * hands receive their second card immediately, first hand first).
 */
import { z } from 'zod';
import { mulDivFloor, sumMinor } from '../../money';
import { shuffle, type RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, settled, type AdditionalStake, type GameModule, type RiskProfile, type StepResult } from '../types';
import { handTotal, isBlackjack, rankOf, valueOf } from './cards';
import { analyticsEstimate, estimateFor } from './estimates';

export * from './cards';

export const blackjackConfigSchema = z
  .object({
    decks: z.union([z.literal(6), z.literal(8)]),
    dealerHitsSoft17: z.boolean(),
    blackjackPays: z.enum(['3:2', '6:5']),
    doubleAfterSplit: z.boolean(),
  })
  .strict();
export type BlackjackConfig = z.infer<typeof blackjackConfigSchema>;

/** Maximum number of hands after splitting (fixed rule). */
export const MAX_HANDS = 4;

export const blackjackBetSchema = z.object({ amount: stakeSchema }).strict();
export type BlackjackBet = z.infer<typeof blackjackBetSchema>;

export const blackjackActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hit') }).strict(),
  z.object({ type: z.literal('stand') }).strict(),
  z.object({ type: z.literal('double') }).strict(),
  z.object({ type: z.literal('split') }).strict(),
  z.object({ type: z.literal('insurance'), take: z.boolean() }).strict(),
]);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;
export type ActionType = BlackjackAction['type'];

export interface Hand {
  cards: number[];
  stake: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
}

export interface HandResult {
  outcome: 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
  payout: number;
  total: number;
}

export interface BlackjackState {
  decks: number;
  /** Secret: the shuffled shoe (only the dealt prefix is ever revealed while open). */
  shoe: number[];
  next: number;
  dealer: number[];
  hands: Hand[];
  active: number;
  phase: 'insurance' | 'player' | 'done';
  baseStake: number;
  insurance: { offered: boolean; taken: boolean | null; stake: number; payout: number };
  dealerBlackjack: boolean | null;
  results: HandResult[] | null;
  payout: number;
  outcomeSummary: string | null;
}

export interface BlackjackView extends Omit<BlackjackState, 'shoe' | 'dealer' | 'next'> {
  dealer: (number | null)[];
  dealerTotal: number | null;
  handTotals: { total: number; soft: boolean }[];
  allowed: ActionType[];
}

const PAYS: Record<BlackjackConfig['blackjackPays'], [number, number]> = { '3:2': [3, 2], '6:5': [6, 5] };

function draw(s: BlackjackState): number {
  const card = s.shoe[s.next];
  if (card === undefined) throw new Error('shoe exhausted');
  s.next += 1;
  return card;
}

function clone(s: BlackjackState): BlackjackState {
  return {
    ...s,
    dealer: [...s.dealer],
    hands: s.hands.map((h) => ({ ...h, cards: [...h.cards] })),
    insurance: { ...s.insurance },
    results: s.results ? s.results.map((r) => ({ ...r })) : null,
  };
}

function blackjackPayout(config: BlackjackConfig, stake: number): number {
  const [num, den] = PAYS[config.blackjackPays];
  return stake + mulDivFloor(stake, num, den);
}

function totalStake(s: BlackjackState): number {
  return sumMinor([...s.hands.map((h) => h.stake), s.insurance.taken ? s.insurance.stake : 0]);
}

/** Current worst case for the house, using only information visible to the player. */
function currentMaxPayout(config: BlackjackConfig, s: BlackjackState): number {
  if (s.phase === 'done') return s.payout;
  let max = 0;
  for (const h of s.hands) {
    if (handTotal(h.cards).total > 21) continue;
    max += !h.fromSplit && isBlackjack(h.cards) ? blackjackPayout(config, h.stake) : 2 * h.stake;
  }
  if (s.insurance.taken && s.dealerBlackjack === null) max += 3 * s.insurance.stake;
  return max;
}

function riskFor(config: BlackjackConfig, s: BlackjackState): RiskProfile {
  const est = analyticsEstimate(config);
  const stake = totalStake(s);
  // Strategy-dependent game: expectation uses the simulated basic-strategy edge per
  // initial wager (plus the analytical insurance edge); variance the simulated σ².
  const insEdge = insuranceEdge(config.decks);
  const expected = stake - est.houseEdge * s.baseStake - (s.insurance.taken ? insEdge * s.insurance.stake : 0);
  return { stake, maxPayout: currentMaxPayout(config, s), expectedPayout: expected, payoutVariance: est.variancePerUnit * s.baseStake * s.baseStake };
}

/** House edge of insurance with a fresh shoe, given only the dealer's ace is known. */
export function insuranceEdge(decks: number): number {
  const tens = 16 * decks;
  const unseen = 52 * decks - 1;
  return 1 - (3 * tens) / unseen;
}

function canSplit(s: BlackjackState, h: Hand): boolean {
  return (
    h.cards.length === 2 &&
    valueOf(h.cards[0]!) === valueOf(h.cards[1]!) &&
    s.hands.length < MAX_HANDS &&
    !h.splitAces
  );
}

function canDouble(config: BlackjackConfig, h: Hand): boolean {
  return h.cards.length === 2 && !h.splitAces && (!h.fromSplit || config.doubleAfterSplit);
}

export function allowedActions(config: BlackjackConfig, s: BlackjackState): ActionType[] {
  if (s.phase === 'insurance') return ['insurance'];
  if (s.phase !== 'player') return [];
  const h = s.hands[s.active]!;
  const out: ActionType[] = ['hit', 'stand'];
  if (canDouble(config, h)) out.push('double');
  if (canSplit(s, h)) out.push('split');
  return out;
}

function dealerPlays(config: BlackjackConfig, s: BlackjackState): void {
  for (;;) {
    const t = handTotal(s.dealer);
    if (t.total > 17 || (t.total === 17 && !(t.soft && config.dealerHitsSoft17))) return;
    s.dealer.push(draw(s));
  }
}

function summary(results: HandResult[], dealerBj: boolean): string {
  if (dealerBj) return results.some((r) => r.outcome === 'push') ? 'Both blackjack — push' : 'Dealer blackjack';
  if (results.length === 1) {
    const r = results[0]!;
    return { blackjack: 'Blackjack!', win: `Win with ${r.total}`, push: `Push on ${r.total}`, lose: `Lose with ${r.total}`, bust: 'Bust' }[r.outcome];
  }
  return results.map((r, i) => `Hand ${i + 1}: ${r.outcome}`).join(' · ');
}

function finish(config: BlackjackConfig, s: BlackjackState): StepResult<BlackjackState> {
  const dealerBj = s.dealerBlackjack === true;
  const playerLive = s.hands.some((h) => handTotal(h.cards).total <= 21);
  const naturalOnly = s.hands.length === 1 && !s.hands[0]!.fromSplit && isBlackjack(s.hands[0]!.cards);
  if (!dealerBj && playerLive && !naturalOnly) dealerPlays(config, s);
  const dealer = handTotal(s.dealer).total;
  const results: HandResult[] = s.hands.map((h) => {
    const t = handTotal(h.cards).total;
    const natural = !h.fromSplit && isBlackjack(h.cards);
    if (dealerBj) return natural ? { outcome: 'push', payout: h.stake, total: t } : { outcome: 'lose', payout: 0, total: t };
    if (t > 21) return { outcome: 'bust', payout: 0, total: t };
    if (natural) return { outcome: 'blackjack', payout: blackjackPayout(config, h.stake), total: t };
    if (dealer > 21 || t > dealer) return { outcome: 'win', payout: 2 * h.stake, total: t };
    if (t === dealer) return { outcome: 'push', payout: h.stake, total: t };
    return { outcome: 'lose', payout: 0, total: t };
  });
  s.insurance.payout = s.insurance.taken && dealerBj ? 3 * s.insurance.stake : 0;
  s.results = results;
  s.phase = 'done';
  s.payout = sumMinor([...results.map((r) => r.payout), s.insurance.payout]);
  s.outcomeSummary = summary(results, dealerBj);
  const risk = riskFor(config, s);
  return settled(s, s.payout, { ...risk, maxPayout: Math.max(risk.maxPayout, s.payout) });
}

function open(config: BlackjackConfig, s: BlackjackState, extra: AdditionalStake[] = []): StepResult<BlackjackState> {
  return { state: s, status: 'OPEN', payout: 0, additionalStakes: extra, risk: riskFor(config, s) };
}

/** Peek for dealer blackjack (ace or ten up), then settle naturals or hand over to the player. */
function afterInsurance(config: BlackjackConfig, s: BlackjackState, extra: AdditionalStake[]): StepResult<BlackjackState> {
  const up = valueOf(s.dealer[0]!);
  s.dealerBlackjack = up === 1 || up === 10 ? isBlackjack(s.dealer) : false;
  if (s.dealerBlackjack || isBlackjack(s.hands[0]!.cards)) {
    s.hands[0]!.done = true;
    const result = finish(config, s);
    return { ...result, additionalStakes: extra };
  }
  s.phase = 'player';
  return open(config, s, extra);
}

/** Moves to the next unfinished hand, or plays the dealer and settles. */
function advance(config: BlackjackConfig, s: BlackjackState, extra: AdditionalStake[]): StepResult<BlackjackState> {
  const h = s.hands[s.active]!;
  if (!h.done && handTotal(h.cards).total >= 21) h.done = true;
  if (!h.done) return open(config, s, extra);
  const nextIdx = s.hands.findIndex((x) => !x.done);
  if (nextIdx === -1) {
    const r = finish(config, s);
    return { ...r, additionalStakes: extra };
  }
  s.active = nextIdx;
  const n = s.hands[nextIdx]!;
  if (handTotal(n.cards).total >= 21) {
    n.done = true;
    return advance(config, s, extra);
  }
  return open(config, s, extra);
}

function assessBet(config: BlackjackConfig, bet: BlackjackBet): RiskProfile {
  const est = analyticsEstimate(config);
  return {
    stake: bet.amount,
    // Before the cards are known, the worst case is a player blackjack.
    maxPayout: blackjackPayout(config, bet.amount),
    expectedPayout: bet.amount * (1 - est.houseEdge),
    payoutVariance: est.variancePerUnit * bet.amount * bet.amount,
  };
}

export const blackjack: GameModule<BlackjackConfig, BlackjackBet, BlackjackState, BlackjackAction, BlackjackView> = {
  id: 'blackjack',
  name: 'Blackjack',
  interactive: true,
  configSchema: blackjackConfigSchema,
  defaultConfig: { decks: 6, dealerHitsSoft17: false, blackjackPays: '3:2', doubleAfterSplit: true },
  betSchema: blackjackBetSchema,
  actionSchema: blackjackActionSchema,

  assess(config, bet) {
    return assessBet(config, bet);
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount }];
  },

  start(config, bet, rng: RandomSource) {
    return dealFromShoe(config, bet, shuffle(Array.from({ length: 52 * config.decks }, (_, i) => i), rng));
  },

  act(config, prev, action) {
    return applyAction(config, prev, action);
  },

  expire() {
    return null;
  },

  view(config, s, isFinal) {
    const reveal = isFinal || s.phase === 'done';
    const { shoe: _shoe, next: _next, ...rest } = s;
    return {
      ...rest,
      dealer: reveal ? s.dealer : [s.dealer[0]!, null],
      dealerTotal: reveal ? handTotal(s.dealer).total : null,
      handTotals: s.hands.map((h) => handTotal(h.cards)),
      allowed: reveal ? [] : allowedActions(config, s),
    };
  },

  theoretical(config) {
    const est = estimateFor(config);
    return {
      rtp: 1 - est.houseEdge,
      houseEdge: est.houseEdge,
      method: 'estimate',
      ci95: [1 - est.ci95[1], 1 - est.ci95[0]],
      notes: `Estimated by simulating ${est.hands.toLocaleString('en-US')} hands of basic strategy for these rules (95% CI shown). Deviating from basic strategy raises the house edge; insurance has a ${(insuranceEdge(config.decks) * 100).toFixed(2)}% edge.`,
    };
  },
};

/** Deals a round from a given shoe order (exposed for tests and simulations). */
export function dealFromShoe(config: BlackjackConfig, bet: BlackjackBet, shoe: number[]): StepResult<BlackjackState> {
  const s: BlackjackState = {
    decks: config.decks,
    shoe,
    next: 0,
    dealer: [],
    hands: [{ cards: [], stake: bet.amount, doubled: false, fromSplit: false, splitAces: false, done: false }],
    active: 0,
    phase: 'player',
    baseStake: bet.amount,
    insurance: { offered: false, taken: null, stake: Math.floor(bet.amount / 2), payout: 0 },
    dealerBlackjack: null,
    results: null,
    payout: 0,
    outcomeSummary: null,
  };
  s.hands[0]!.cards.push(draw(s));
  s.dealer.push(draw(s));
  s.hands[0]!.cards.push(draw(s));
  s.dealer.push(draw(s));
  if (rankOf(s.dealer[0]!) === 0 && s.insurance.stake > 0) {
    s.insurance.offered = true;
    s.phase = 'insurance';
    return open(config, s);
  }
  return afterInsurance(config, s, []);
}

/** Applies one player action (pure: the previous state is not mutated). */
export function applyAction(config: BlackjackConfig, prev: BlackjackState, action: BlackjackAction): StepResult<BlackjackState> {
  if (prev.phase === 'done') throw new GameRuleError('ROUND_FINISHED', 'This hand has finished');
  const allowed = allowedActions(config, prev);
  if (!allowed.includes(action.type)) {
    throw new GameRuleError('ACTION_NOT_ALLOWED', `You cannot ${action.type} now`, { allowed });
  }
  const s = clone(prev);
  if (action.type === 'insurance') {
    const extra: AdditionalStake[] = [];
    s.insurance.taken = action.take;
    if (action.take) extra.push({ kind: 'insurance', amount: s.insurance.stake, maxAddedPayout: 3 * s.insurance.stake });
    return afterInsurance(config, s, extra);
  }
  const h = s.hands[s.active]!;
  switch (action.type) {
    case 'hit':
      h.cards.push(draw(s));
      if (handTotal(h.cards).total >= 21) h.done = true;
      return advance(config, s, []);
    case 'stand':
      h.done = true;
      return advance(config, s, []);
    case 'double': {
      const extra: AdditionalStake[] = [{ kind: 'double', amount: h.stake, selection: { hand: s.active }, maxAddedPayout: 2 * h.stake }];
      h.stake *= 2;
      h.doubled = true;
      h.cards.push(draw(s));
      h.done = true;
      return advance(config, s, extra);
    }
    case 'split': {
      const extra: AdditionalStake[] = [{ kind: 'split', amount: h.stake, selection: { hand: s.active }, maxAddedPayout: 2 * h.stake }];
      const aces = rankOf(h.cards[0]!) === 0;
      const second: Hand = { cards: [h.cards[1]!], stake: h.stake, doubled: false, fromSplit: true, splitAces: aces, done: false };
      h.cards = [h.cards[0]!];
      h.fromSplit = true;
      h.splitAces = aces;
      s.hands.splice(s.active + 1, 0, second);
      h.cards.push(draw(s));
      second.cards.push(draw(s));
      if (aces) {
        h.done = true;
        second.done = true;
      }
      return advance(config, s, extra);
    }
  }
}
