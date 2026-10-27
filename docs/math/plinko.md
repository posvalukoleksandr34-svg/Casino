# Plinko — mathematical specification

Implementation: `src/engine/games/plinko`. Tests: `tests/unit/plinko.test.ts`,
`tests/integration/new-games.test.ts`, `tests/statistical/new-games.stat.test.ts`.

## Outcome space

The player chooses R ∈ {8, 12, 16} rows and a risk level (low, medium, high). The server
draws the whole path before anything is shown: one `int(2)` per row from the provably
fair stream (0 = left, 1 = right). The landing slot k ∈ {0, …, R} is the number of right
bounces, so k ~ Binomial(R, ½):

  P(k) = C(R, k) / 2^R

The browser animation replays the stored path; it never decides anything. Risk does not
change the path: the same seeds land in the same slot at every risk level.

## Payout and RTP

The round pays ⌊stake · m(R, risk, k) / 100⌋ with the immutable configured table
(hundredths). Tables are symmetric (m(k) = m(R − k)).

  RTP(R, risk) = Σₖ C(R, k) · m(k) / (100 · 2^R)

| Rows | Risk | Multipliers, edge → centre | Exact RTP | Variance per unit |
|---|---|---|---|---|
| 8 | low | 4.26 · 2.41 · 1.40 · 0.83 · 0.50 | 99/100 | 0.32 |
| 8 | medium | 7.52 · 3.21 · 1.44 · 0.70 · 0.40 | 99/100 | 0.82 |
| 8 | high | 17.60 · 4.82 · 1.37 · 0.45 · 0.20 | 99/100 | 3.40 |
| 12 | low | 6.06 · 4.06 · 2.67 · 1.77 · 1.16 · 0.76 · 0.50 | 99/100 | 0.31 |
| 12 | medium | 14.97 · 7.58 · 3.88 · 2.01 · 1.09 · 0.63 · 0.40 | 99/100 | 0.86 |
| 12 | high | 63.95 · 20.75 · 6.77 · 2.26 · 0.81 · 0.35 · 0.20 | 99/100 | 5.78 |
| 16 | low | 7.90 · 5.73 · 4.09 · 2.93 · 2.09 · 1.49 · 1.04 · 0.73 · 0.50 | 99/100 | 0.28 |
| 16 | medium | 26.84 · 14.93 · 8.39 · 4.72 · 2.69 · 1.57 · 0.93 · 0.59 · 0.40 | 99/100 | 0.88 |
| 16 | high | 187.64 · 69.56 · 25.87 · 9.66 · 3.66 · 1.43 · 0.61 · 0.31 · 0.20 | 99/100 | 7.65 |

Every default table returns exactly 99% (house edge 1%); rounding each payout down to
0.01 chip lowers it by less than 0.01 chip per round.

**How the tables were built.** m(d) = base + c · (g^d − 1), where d is the distance from
the centre slot, base is a fixed centre value (0.5×, 0.4×, 0.2× for low, medium, high)
and g sets the growth towards the edges. c is solved so the RTP is just below 99%;
values are floored to 0.01× and topped up symmetrically while the exact RTP stays
≤ 99%. The tables are an original design for this site.

## Configuration safety

`plinkoConfigSchema` requires exactly the nine rows × risk tables, each with R + 1 slots,
symmetric, with exact RTP strictly below 100%.

## Maximum payout and limits

Max multiplier 187.64× (16 rows, high, a 1 in 65,536 chance per side). Default limits:
stake 0.10–1,000 chips, per-round cap 200,000 chips.

## Verification

`verifyOutcome('plinko', …, { rows })` recomputes the L/R path and the slot.
