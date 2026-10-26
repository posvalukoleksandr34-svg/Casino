# European Roulette — mathematical specification

Implementation: `src/engine/games/roulette`. Tests: `tests/unit/roulette.test.ts`,
`tests/statistical/roulette-dice.stat.test.ts`.

## Outcome space

37 equally likely pockets {0, 1, …, 36}: `pocket = int(37)` from the provably fair stream.
P(n) = 1/37 for every n. Colours: 0 green; red = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21,
23, 25, 27, 30, 32, 34, 36}; the other 18 black. Zero is not odd/even/low/high/red/black and
belongs to no dozen or column. No "la partage" / "en prison".

## Payout table (gross return includes the stake)

| Bet | Winning pockets k | P(win) | Odds | Gross return on win | RTP = k·(odds+1)/37 |
|---|---|---|---|---|---|
| Straight up (0–36) | 1 | 1/37 = 2.7027% | 35:1 | 36 × stake | 36/37 = 97.2973% |
| Red / Black | 18 | 18/37 = 48.6486% | 1:1 | 2 × stake | 36/37 |
| Odd / Even | 18 | 18/37 | 1:1 | 2 × stake | 36/37 |
| Low 1–18 / High 19–36 | 18 | 18/37 | 1:1 | 2 × stake | 36/37 |
| Dozen (1–12, 13–24, 25–36) | 12 | 12/37 = 32.4324% | 2:1 | 3 × stake | 36/37 |
| Column (n mod 3 = 1, 2, 0; n ≠ 0) | 12 | 12/37 | 2:1 | 3 × stake | 36/37 |

All payouts are integer multiples of the stake — no rounding occurs.

## Expected value, RTP and house edge

For a bet of stake s: Player EV = Σ P(outcome) × net result
= k/37 · (odds · s) − (37 − k)/37 · s = s · (k·(odds+1) − 37)/37 = −s/37 for every bet,
because k·(odds+1) = 36 for every bet type.

RTP (gross return / stake, stake included) = **36/37 = 97.2973%**;
house edge = 1 − RTP = **1/37 = 2.7027%**, identical for every bet and therefore for any
combination of simultaneous bets (linearity of expectation). The unit test verifies
Σₙ gross(n) = 36·stake exactly in integer arithmetic for all 49 positions.

## Variance (per unit staked, gross return X)

| Bet | E[X] | E[X²] | Var(X) | SD |
|---|---|---|---|---|
| Straight up | 0.97297 | 1296/37 = 35.0270 | 34.0804 | 5.8378 |
| Even money | 0.97297 | 72/37 = 1.9459 | 0.9993 | 0.9996 |
| Dozen / column | 0.97297 | 108/37 = 2.9189 | 1.9722 | 1.4044 |

For a slip of several bets the server computes the exact distribution over the 37 pockets
(payout table) and stores E and Var per round; these feed the analytics z-scores.

## Worked example

Slip: 1 chip straight 17, 1 chip red, 1 chip odd (stake 3 chips).

| Pockets | Count | Gross payout |
|---|---|---|
| 17 (black, odd) | 1 | 36 + 0 + 2 = 38 |
| red & odd (1, 3, 5, 7, 9, 19, 21, 23, 25, 27) | 10 | 2 + 2 = 4 |
| red & even | 8 | 2 |
| black & odd, except 17 | 7 | 2 |
| black & even | 10 | 0 |
| 0 | 1 | 0 |

Σ = 38 + 40 + 16 + 14 = 108 = 36 × 3, so E[payout] = 108/37 = 2.9189 chips (RTP 97.297%),
max payout (house liability) = 38 chips, net exposure 35 chips. This exact case is a unit test.

## Maximum payout and exposure

Max payout of a slip = maxₙ Σ bets gross(n) (exact, over 37 pockets). Net exposure =
max payout − stake. Limits (defaults, configurable): stake 0.10–10,000 chips per spin,
max payout 360,000 chips per spin (covers a maximum straight-up), per-game open exposure
50 M chips. Rounds settle instantly, so open exposure is only held within a transaction.

## Validation

* Exact: integer-arithmetic RTP for every position; payout table; normalisation of
  duplicate positions; zero handling; schema rejection of malformed bets.
* Statistical (370,000 spins, fixed seeds): pocket frequencies χ² = 22.6 vs critical 68.1
  (df 36, α = 0.001); mixed-slip RTP 97.52%, 99.9% CI [96.48%, 98.57%] contains 97.297%.
