/**
 * Theoretical RTPs derived from the PUBLISHED rules (docs/math/*.md), written
 * independently of the engine: no engine helper is imported here. The Monte
 * Carlo checks compare realised RTP against these values, and separately
 * require the engine's own theory functions to agree with them, so a
 * simulation cannot pass merely because the engine and its theory share the
 * same mistake.
 */

/** Exact binomial coefficient (own implementation, not engine/combinatorics). */
function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i += 1) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

/** European roulette: every bet type returns 36 units per 37 equally likely pockets. */
export function rouletteRtp(): number {
  return 36 / 37;
}

/**
 * Dice (docs/math/dice.md): 10,000 equally likely rolls; a bet covering w rolls
 * pays ⌊(10000 − edge) · 10000 / w⌋ / 10000 × stake (4 decimals, rounded down).
 */
export function diceRtp(winCount: number, houseEdgeBp: number): number {
  const multiplierE4 = Math.floor(((10_000 - houseEdgeBp) * 10_000) / winCount);
  return (winCount / 10_000) * (multiplierE4 / 10_000);
}

/**
 * Mines (docs/math/mines.md): 25 tiles, m mines, cash out after k safe reveals.
 * P(survive k) = C(25 − m, k) / C(25, k); multiplier ⌊(10000 − edge) · C(25, k) / C(25 − m, k)⌋ / 10000,
 * capped at capE4.
 */
export function minesRtp(mines: number, k: number, houseEdgeBp: number, capE4: number): number {
  const total = choose(25, k);
  const safe = choose(25 - mines, k);
  let multiplierE4 = (BigInt(10_000 - houseEdgeBp) * total) / safe;
  if (multiplierE4 > BigInt(capE4)) multiplierE4 = BigInt(capE4);
  return (Number(safe) / Number(total)) * (Number(multiplierE4) / 10_000);
}

/**
 * Crash (docs/math/crash.md), automatic target x (hundredths, 101 ≤ x ≤ cap).
 * The crash point is ⌊100 · (10000 − h) · 2⁵² / (10000 · (2⁵² − n))⌋ for n
 * uniform on [0, 2⁵²). crash ≥ x ⟺ 2⁵² − n ≤ (10000 − h) · 2⁵² / (100 · x), so
 * P(crash ≥ x) = ⌊(10000 − h) · 2⁵² / (100 · x)⌋ / 2⁵² exactly, and the target
 * pays x / 100.
 */
export function crashAutoRtp(xE2: number, houseEdgeBp: number): number {
  const TWO_52 = 2n ** 52n;
  const count = (BigInt(10_000 - houseEdgeBp) * TWO_52) / (100n * BigInt(xE2));
  const p = Number(count < TWO_52 ? count : TWO_52) / 2 ** 52;
  return p * (xE2 / 100);
}

/**
 * Limbo (docs/math/limbo.md), target T (hundredths): the result uses the Crash
 * mapping, the target wins when result ≥ T, so P(win) is the Crash survival
 * count ⌊(10000 − h) · 2⁵² / (100 · T)⌋ / 2⁵² and the win pays T / 100.
 */
export function limboRtp(targetE2: number, houseEdgeBp: number): number {
  return crashAutoRtp(targetE2, houseEdgeBp);
}

/**
 * Keno (docs/math/keno.md): 10 of 40 numbers drawn, n picks, row[k] hundredths
 * for k hits. P(k) = C(n, k) · C(40 − n, 10 − k) / C(40, 10).
 */
export function kenoRtp(picks: number, row: readonly number[]): number {
  const total = choose(40, 10);
  let num = 0n;
  for (let k = 0; k <= picks; k += 1) num += choose(picks, k) * choose(40 - picks, 10 - k) * BigInt(row[k] ?? 0);
  return Number(num) / Number(total * 100n);
}

/** Plinko (docs/math/plinko.md): slot k of R rows has probability C(R, k) / 2^R; table in hundredths. */
export function plinkoRtp(rows: number, table: readonly number[]): number {
  let num = 0n;
  for (let k = 0; k <= rows; k += 1) num += choose(rows, k) * BigInt(table[k] ?? 0);
  return Number(num) / Number(2n ** BigInt(rows) * 100n);
}

/**
 * Hi-Lo (docs/math/hilo.md), strategy "guess the likelier side (higher from 1–7,
 * lower from 8–13), cash out after k correct guesses or at the cap". Ranks are
 * uniform on 1–13 for every card; a guess from r with s successful ranks pays
 * ⌊(10000 − h) · 13^j / (s₁ ⋯ s_j)⌋ / 10⁴ after j correct guesses, capped.
 */
export function hiloRtp(k: number, houseEdgeBp: number, capE4: number): number {
  const multiplier = (counts: number[]) => {
    let num = BigInt(10_000 - houseEdgeBp);
    let den = 1n;
    for (const c of counts) {
      num *= 13n;
      den *= BigInt(c);
    }
    return Number(num / den);
  };
  const go = (rank: number, counts: number[], prob: number): number => {
    const m = counts.length ? multiplier(counts) : 0;
    if (counts.length === k || m >= capE4) return prob * (Math.min(m, capE4) / 10_000);
    const up = rank <= 7;
    const wins: number[] = [];
    for (let next = 1; next <= 13; next += 1) if (up ? next > rank : next < rank) wins.push(next);
    return wins.reduce((acc, next) => acc + go(next, [...counts, wins.length], prob / 13), 0);
  };
  let total = 0;
  for (let first = 1; first <= 13; first += 1) total += go(first, [], 1 / 13);
  return total;
}
