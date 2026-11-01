/**
 * Derives sound cues from what the server said about a round. For
 * multi-step games (Mines, Hi-Lo, Blackjack, Crash) the cue for a step
 * depends on how the authoritative round changed between two responses.
 *
 * Pure and side-effect free: these functions only describe which cue to play.
 * Screens call them only for responses to the player's own requests (see
 * `useRoundCues`), so restoring an open round on page load stays silent.
 */
import type { CueOf } from './profiles';

export interface RoundLike<S> {
  id: string;
  status: 'OPEN' | 'SETTLED' | 'VOIDED';
  stake: number;
  payout: number | null;
  state: S;
}

type Pair<S> = { prev: RoundLike<S> | null; next: RoundLike<S> | null };

const sameRound = <S>({ prev, next }: Pair<S>) => prev !== null && next !== null && prev.id === next.id;
const isNewRound = <S>({ prev, next }: Pair<S>) => next !== null && (prev === null || prev.id !== next.id);

/** Win / lose / nothing (a push or an unsettled round) from the round's net. */
export function outcomeCue(stake: number, payout: number | null): 'win' | 'lose' | null {
  if (payout === null) return null;
  if (payout > stake) return 'win';
  if (payout < stake) return 'lose';
  return null;
}

// ── Mines ────────────────────────────────────────────────────────────────
interface MinesLike {
  revealed: number[];
  status: 'playing' | 'busted' | 'cashed';
}
export function minesCues(prev: RoundLike<MinesLike> | null, next: RoundLike<MinesLike> | null): CueOf<'mines'>[] {
  const pair = { prev, next };
  if (!next || !sameRound(pair)) return [];
  const cues: CueOf<'mines'>[] = [];
  if (prev!.state.status === 'playing' && next.state.status === 'busted') cues.push('explosion');
  else if (next.state.revealed.length > prev!.state.revealed.length) cues.push('safe');
  if (prev!.state.status === 'playing' && next.state.status === 'cashed') cues.push('cashout');
  return cues;
}

// ── Hi-Lo ────────────────────────────────────────────────────────────────
interface HiloLike {
  steps: { via: string; correct: boolean | null }[];
  status: 'playing' | 'busted' | 'cashed';
}
export function hiloCues(prev: RoundLike<HiloLike> | null, next: RoundLike<HiloLike> | null): CueOf<'hilo'>[] {
  const pair = { prev, next };
  if (!next) return [];
  if (isNewRound(pair)) return ['reveal'];
  if (!sameRound(pair)) return [];
  const cues: CueOf<'hilo'>[] = [];
  if (next.state.steps.length > prev!.state.steps.length) {
    cues.push('reveal');
    const last = next.state.steps[next.state.steps.length - 1]!;
    if (last.correct === true) cues.push('correct');
    if (last.correct === false) cues.push('incorrect');
  }
  if (prev!.state.status === 'playing' && next.state.status === 'cashed') cues.push('cashout');
  return cues;
}

// ── Blackjack ────────────────────────────────────────────────────────────
interface BlackjackLike {
  dealer: (number | null)[];
  hands: { cards: number[] }[];
  phase: string;
}
const playerCards = (s: BlackjackLike) => s.hands.reduce((a, h) => a + h.cards.length, 0);
const hidden = (s: BlackjackLike) => s.dealer.filter((c) => c === null).length;

export function blackjackCues(prev: RoundLike<BlackjackLike> | null, next: RoundLike<BlackjackLike> | null): CueOf<'blackjack'>[] {
  const pair = { prev, next };
  if (!next) return [];
  const cues: CueOf<'blackjack'>[] = [];
  if (isNewRound(pair)) {
    cues.push('chip', 'shuffle', 'deal');
    if (next.status === 'SETTLED') {
      if (hidden(next.state) === 0) cues.push('flip');
      const o = outcomeCue(next.stake, next.payout);
      if (o) cues.push(o);
    }
    return cues;
  }
  if (!sameRound(pair)) return [];
  const p = prev!;
  if (next.stake > p.stake) cues.push('chip'); // double, split or insurance adds a stake
  if (playerCards(next.state) > playerCards(p.state) || next.state.dealer.length > p.state.dealer.length) cues.push('deal');
  if (hidden(next.state) < hidden(p.state)) cues.push('flip');
  if (p.status === 'OPEN' && next.status === 'SETTLED') {
    const o = outcomeCue(next.stake, next.payout);
    if (o) cues.push(o);
  }
  return cues;
}

// ── Crash ────────────────────────────────────────────────────────────────
interface CrashLike {
  status: 'flying' | 'cashed' | 'busted';
}
export function crashCues(prev: RoundLike<CrashLike> | null, next: RoundLike<CrashLike> | null): CueOf<'crash'>[] {
  const pair = { prev, next };
  if (!next) return [];
  if (isNewRound(pair)) return next.state.status === 'flying' ? ['launch'] : next.state.status === 'busted' ? ['launch', 'crash'] : [];
  if (!sameRound(pair)) return [];
  if (prev!.state.status === 'flying' && next.state.status === 'cashed') return ['cashout'];
  if (prev!.state.status === 'flying' && next.state.status === 'busted') return ['crash'];
  return [];
}
