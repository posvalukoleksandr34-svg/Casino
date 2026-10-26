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
