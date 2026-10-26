/** Card model: a shoe index i maps to card i mod 52; rank = card mod 13 (0 = A … 12 = K). */
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;

export function rankOf(card: number): number {
  return (card % 52) % 13;
}

export function suitOf(card: number): number {
  return Math.floor((card % 52) / 13);
}

/** Blackjack value with aces counted as 1. */
export function valueOf(card: number): number {
  const r = rankOf(card);
  return r === 0 ? 1 : r >= 9 ? 10 : r + 1;
}

export function label(card: number): string {
  return `${RANK_LABELS[rankOf(card)]}${SUITS[suitOf(card)]}`;
}

export interface Total {
  total: number;
  soft: boolean;
}

export function handTotal(cards: readonly number[]): Total {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    const v = valueOf(c);
    sum += v;
    if (v === 1) aces += 1;
  }
  if (aces > 0 && sum + 10 <= 21) return { total: sum + 10, soft: true };
  return { total: sum, soft: false };
}

export function isBlackjack(cards: readonly number[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}
