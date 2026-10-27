# Keno — mathematical specification

Implementation: `src/engine/games/keno`. Tests: `tests/unit/keno.test.ts`,
`tests/integration/new-games.test.ts`, `tests/statistical/new-games.stat.test.ts`.

## Outcome space

The board holds 1–40. The server shuffles 1–40 with the provably fair Fisher–Yates
shuffle (the same one Mines and Blackjack use) and takes the first 10: all C(40, 10) =
847,660,528 draws are equally likely. The draw does not depend on the player's picks.

## Rules and payout

The player picks n distinct numbers, 1 ≤ n ≤ 10. With k hits (picked numbers that were
drawn), the round pays ⌊stake · m(n, k) / 100⌋ where m is the immutable configured table
(hundredths of a multiple). The chance of k hits is hypergeometric:

  P(k | n) = C(n, k) · C(40 − n, 10 − k) / C(40, 10)

## Payout table and RTP (default configuration)

| Picks | Hits → multiplier | Exact RTP | Variance per unit |
|---|---|---|---|
| 1 | 1 → 3.96× | 99.00000% | 2.94 |
| 2 | 1 → 1.60×, 2 → 6.49× | 98.98077% | 2.43 |
| 3 | 2 → 5.01×, 3 → 25.14× | 98.99089% | 10.13 |
| 4 | 2 → 2.11×, 3 → 10.57×, 4 → 52.95× | 98.99852% | 10.82 |
| 5 | 3 → 7.23×, 4 → 36.25×, 5 → 181.13× | 98.99967% | 28.31 |
| 6 | 3 → 3.55×, 4 → 15.97×, 5 → 71.90×, 6 → 323.87× | 99.00000% | 22.61 |
| 7 | 4 → 13.18×, 5 → 52.81×, 6 → 211.03×, 7 → 844.46× | 99.00000% | 43.00 |
| 8 | 4 → 7.05×, 5 → 25.38×, 6 → 91.49×, 7 → 329.12×, 8 → 1,184.59× | 99.00000% | 27.14 |
| 9 | 5 → 26.18×, 6 → 86.45×, 7 → 285.34×, 8 → 941.30×, 9 → 3,106.74× | 99.00000% | 59.90 |
| 10 | 5 → 14.44×, 6 → 43.32×, 7 → 129.97×, 8 → 390.14×, 9 → 1,170.13×, 10 → 3,509.94× | 99.00000% | 34.32 |

Values "99.00000%" are at most 99% exactly (rational arithmetic), not rounded up. Hit
counts not listed pay nothing.

**How the table was built.** For each n, multipliers grow geometrically with hits from a
chosen first paying tier, scaled so the row's RTP is just below 99%, floored to 0.01×,
then topped up 0.01× at a time while the exact RTP stays ≤ 99%. No prize could exceed
10,000× during construction (that limit did not bind). The table is an original design
for this site.

## Configuration safety

`kenoConfigSchema` refuses a table unless it has exactly rows 1–10, row n has n + 1
entries, multipliers never decrease with more hits, and **every row's exact RTP is
strictly below 100%** (BigInt arithmetic). A configuration change is a new immutable
configuration version; rounds keep the version they started with.

## Maximum payout and limits

Max payout = ⌊stake × max(m(n, ·))⌋: 3,509.94× for 10 picks. Default limits: stake
0.10–250 chips, per-round cap 1,000,000 chips (250 × 3,509.94 = 877,485 chips).

## Verification

`verifyOutcome('keno', …)` recomputes the 10 drawn numbers from the revealed seeds.
