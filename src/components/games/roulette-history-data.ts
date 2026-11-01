/**
 * The player's settled roulette spins, as returned by `/api/rounds`, and
 * descriptive statistics over them. Statistics describe the past only:
 * every spin is independent, so they predict nothing.
 */
import { pocketColor, type RouletteBetResult } from '@/engine/games/roulette';

export interface RoundListItem {
  id: string;
  gameId: string;
  status: string;
  stake: number;
  payout: number | null;
  startedAt: string;
  settledAt: string | null;
  summary: unknown;
}

export interface RouletteSpin {
  id: string;
  result: number;
  color: 'red' | 'black' | 'green';
  stake: number;
  payout: number;
  net: number;
  at: string;
  results: RouletteBetResult[];
}

/** Settled roulette rounds with a valid result, in the order given (newest first). */
export function toSpins(items: readonly RoundListItem[]): RouletteSpin[] {
  const spins: RouletteSpin[] = [];
  for (const r of items) {
    if (r.gameId !== 'roulette' || r.status !== 'SETTLED' || r.payout === null) continue;
    const s = r.summary as { result?: unknown; results?: unknown } | null;
    const n = s?.result;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 36) continue;
    spins.push({
      id: r.id,
      result: n,
      color: pocketColor(n),
      stake: r.stake,
      payout: r.payout,
      net: r.payout - r.stake,
      at: r.settledAt ?? r.startedAt,
      results: Array.isArray(s?.results) ? (s.results as RouletteBetResult[]) : [],
    });
  }
  return spins;
}

export interface HistoryStats {
  count: number;
  red: number;
  black: number;
  green: number;
  odd: number;
  even: number;
  low: number;
  high: number;
  /** Most frequent numbers, most frequent first (ties: lower number first). */
  frequent: { number: number; count: number }[];
}

/** Counts over past results. Zero is neither odd/even nor low/high. */
export function historyStats(results: readonly number[], top = 5): HistoryStats {
  const s: HistoryStats = { count: results.length, red: 0, black: 0, green: 0, odd: 0, even: 0, low: 0, high: 0, frequent: [] };
  const freq = new Map<number, number>();
  for (const n of results) {
    s[pocketColor(n)] += 1;
    if (n !== 0) {
      if (n % 2) s.odd += 1;
      else s.even += 1;
      if (n <= 18) s.low += 1;
      else s.high += 1;
    }
    freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  s.frequent = [...freq]
    .map(([number, count]) => ({ number, count }))
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, top);
  return s;
}
