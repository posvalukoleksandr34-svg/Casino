import { describe, expect, it } from 'vitest';
import { blackjackCues, crashCues, hiloCues, minesCues, outcomeCue, type RoundLike } from '@/lib/audio/cues';

function r<S>(state: S, over: Partial<RoundLike<S>> = {}): RoundLike<S> {
  return { id: 'r1', status: 'OPEN', stake: 1000, payout: null, state, ...over };
}

describe('cues derived from server round changes', () => {
  it('outcome: win above the stake, lose below, nothing for a push or an open round', () => {
    expect(outcomeCue(1000, 2000)).toBe('win');
    expect(outcomeCue(1000, 0)).toBe('lose');
    expect(outcomeCue(1000, 1000)).toBeNull();
    expect(outcomeCue(1000, null)).toBeNull();
  });

  it('mines: safe reveal, explosion, cash-out', () => {
    const playing = r({ revealed: [1], status: 'playing' as const });
    expect(minesCues(playing, r({ revealed: [1, 4], status: 'playing' }))).toEqual(['safe']);
    expect(minesCues(playing, r({ revealed: [1], status: 'busted' }, { status: 'SETTLED', payout: 0 }))).toEqual(['explosion']);
    expect(minesCues(playing, r({ revealed: [1], status: 'cashed' }, { status: 'SETTLED', payout: 1500 }))).toEqual(['cashout']);
    // Revealing the last safe tile cashes out automatically.
    expect(minesCues(playing, r({ revealed: [1, 2], status: 'cashed' }))).toEqual(['safe', 'cashout']);
    expect(minesCues(null, playing)).toEqual([]);
    expect(minesCues(playing, playing)).toEqual([]);
  });

  it('hi-lo: first card, correct and incorrect guesses, cash-out', () => {
    const start = r({ steps: [{ via: 'start', correct: null }], status: 'playing' as const });
    expect(hiloCues(null, start)).toEqual(['reveal']);
    expect(hiloCues(start, r({ steps: [...start.state.steps, { via: 'higher', correct: true }], status: 'playing' }))).toEqual(['reveal', 'correct']);
    expect(hiloCues(start, r({ steps: [...start.state.steps, { via: 'lower', correct: false }], status: 'busted' }))).toEqual(['reveal', 'incorrect']);
    expect(hiloCues(start, r({ steps: [...start.state.steps, { via: 'skip', correct: null }], status: 'playing' }))).toEqual(['reveal']);
    expect(hiloCues(start, r({ steps: start.state.steps, status: 'cashed' }))).toEqual(['cashout']);
  });

  it('blackjack: chip, shuffle and deal; then deal, flip and the result', () => {
    const dealt = r({ dealer: [10, null], hands: [{ cards: [5, 6] }], phase: 'player' });
    expect(blackjackCues(null, dealt)).toEqual(['chip', 'shuffle', 'deal']);
    expect(blackjackCues(dealt, r({ dealer: [10, null], hands: [{ cards: [5, 6, 9] }], phase: 'player' }))).toEqual(['deal']);
    const doubled = r({ dealer: [10, 7, 4], hands: [{ cards: [5, 6, 9] }], phase: 'done' }, { stake: 2000, status: 'SETTLED', payout: 4000 });
    expect(blackjackCues(dealt, doubled)).toEqual(['chip', 'deal', 'flip', 'win']);
    const instant = r({ dealer: [11, 10], hands: [{ cards: [10, 9] }], phase: 'done' }, { status: 'SETTLED', payout: 0 });
    expect(blackjackCues(null, instant)).toEqual(['chip', 'shuffle', 'deal', 'flip', 'lose']);
  });

  it('crash: launch, cash-out, crash', () => {
    const flying = r({ status: 'flying' as const });
    expect(crashCues(null, flying)).toEqual(['launch']);
    expect(crashCues(flying, r({ status: 'cashed' }))).toEqual(['cashout']);
    expect(crashCues(flying, r({ status: 'busted' }))).toEqual(['crash']);
    expect(crashCues(flying, flying)).toEqual([]);
    expect(crashCues(null, r({ status: 'busted' }))).toEqual(['launch', 'crash']);
  });
});
