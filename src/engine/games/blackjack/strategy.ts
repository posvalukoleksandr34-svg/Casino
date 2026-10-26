/**
 * Basic strategy for the supported rule sets (4–8 decks, no surrender, dealer
 * peeks). Used by the house-edge simulation and by the optional in-game hint.
 * Source: standard multi-deck basic strategy charts; S17/H17 and DAS
 * variations as noted inline.
 */
import { handTotal, valueOf } from './cards';
import type { ActionType } from './index';

export interface StrategyRules {
  dealerHitsSoft17: boolean;
  doubleAfterSplit: boolean;
}

type Decision = 'H' | 'S' | 'D' | 'Ds' | 'P';

/** Dealer up card value 2..11 (ace = 11). */
function upValue(card: number): number {
  const v = valueOf(card);
  return v === 1 ? 11 : v;
}

function hard(total: number, up: number, rules: StrategyRules): Decision {
  if (total <= 8) return 'H';
  if (total === 9) return up >= 3 && up <= 6 ? 'D' : 'H';
  if (total === 10) return up <= 9 ? 'D' : 'H';
  if (total === 11) return up <= 10 || rules.dealerHitsSoft17 ? 'D' : 'H';
  if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
  if (total <= 16) return up <= 6 ? 'S' : 'H';
  return 'S';
}

function soft(total: number, up: number, rules: StrategyRules): Decision {
  switch (total) {
    case 13:
    case 14:
      return up === 5 || up === 6 ? 'D' : 'H';
    case 15:
    case 16:
      return up >= 4 && up <= 6 ? 'D' : 'H';
    case 17:
      return up >= 3 && up <= 6 ? 'D' : 'H';
    case 18:
      if (rules.dealerHitsSoft17 ? up >= 2 && up <= 6 : up >= 3 && up <= 6) return 'Ds';
      return up <= 8 ? 'S' : 'H';
    case 19:
      return rules.dealerHitsSoft17 && up === 6 ? 'Ds' : 'S';
    default:
      return total <= 12 ? 'H' : 'S';
  }
}

function pair(cardValue: number, up: number, rules: StrategyRules): Decision | null {
  const das = rules.doubleAfterSplit;
  switch (cardValue) {
    case 1:
      return 'P';
    case 10:
      return null;
    case 9:
      return up === 7 || up >= 10 ? null : 'P';
    case 8:
      return 'P';
    case 7:
      return up <= 7 ? 'P' : null;
    case 6:
      return (das ? up <= 6 : up >= 3 && up <= 6) ? 'P' : null;
    case 5:
      return null;
    case 4:
      return das && (up === 5 || up === 6) ? 'P' : null;
    default: // 2s and 3s
      return (das ? up <= 7 : up >= 4 && up <= 7) ? 'P' : null;
  }
}

/** Recommends one of the allowed actions for the active hand. Never recommends insurance. */
export function basicStrategy(cards: readonly number[], dealerUp: number, allowed: readonly ActionType[], rules: StrategyRules): ActionType {
  if (allowed.includes('insurance')) return 'insurance';
  const up = upValue(dealerUp);
  if (allowed.includes('split') && cards.length === 2 && valueOf(cards[0]!) === valueOf(cards[1]!)) {
    const p = pair(valueOf(cards[0]!), up, rules);
    if (p === 'P') return 'split';
  }
  const t = handTotal(cards);
  const d = t.soft ? soft(t.total, up, rules) : hard(t.total, up, rules);
  if (d === 'D') return allowed.includes('double') ? 'double' : 'hit';
  if (d === 'Ds') return allowed.includes('double') ? 'double' : 'stand';
  if (d === 'H') return 'hit';
  return 'stand';
}
