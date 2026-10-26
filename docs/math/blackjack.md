# Blackjack — mathematics

Status: **house edge is a simulation estimate, not an exact value.** Every
figure below that depends on player strategy is labelled as an estimate and
carries a 95% confidence interval.

## Rules (configurable, immutable per configuration version)

| Parameter | Options | Default |
|---|---|---|
| Decks | 6, 8 | 6 |
| Dealer soft 17 | stands (S17) / hits (H17) | S17 |
| Blackjack pays | 3:2, 6:5 | 3:2 |
| Double after split | yes (DAS) / no (NDAS) | DAS |

These rules are fixed: the dealer peeks for blackjack with an ace or ten up
(the player loses only the original stake to a dealer blackjack); doubling is
allowed on any first two cards; equal-value pairs split up to 4 hands; split
aces receive one card each and cannot be re-split; 21 after a split is not a
blackjack; there is no surrender; insurance costs half the stake and pays 2:1.

## Shoe and fairness

Every round shuffles a **fresh** shoe of `52·decks` cards with Fisher–Yates
driven by the provably fair HMAC stream (`src/engine/rng/provably-fair.ts`).
The deal order is player, dealer up, player, dealer hole; further cards are
drawn in the order actions request them (on a split, both new hands get their
second card immediately, the first hand first). The whole order is fixed when
the round starts, so the player's decisions choose *which* cards they take
but cannot change the order of the shoe. The verifier at `/fairness`
recomputes the shoe order from the revealed seed: by default the first 24 cards, and from a
round's link exactly as many as the round dealt (any number up to the whole shoe).

Because the shoe is fresh every hand, the composition is the same at the
start of every round: card counting has no value, and every hand is
independent and identically distributed under a fixed strategy.

## Why an estimate

Blackjack's return depends on the player's decisions and the exact
composition-dependent probabilities of a multi-deck shoe with splitting.
An exact combinatorial analysis (e.g. full recursive enumeration with
re-splits to 4 hands) is possible but costly; this project instead estimates
the edge of **basic strategy** (`src/engine/games/blackjack/strategy.ts`) by
Monte Carlo through the production engine code (`dealFromShoe` /
`applyAction`), never by a separate re-implementation.

* Simulation: `npm run sim:game -- blackjack --rules <key> --hands N --write`
  (`scripts/simulate-game.ts`, `scripts/sim/blackjack.ts`).
* RNG for simulation: xoshiro128** (`src/engine/rng/sim-random.ts`), seeded
  from `crypto.randomBytes`; used **only** for simulations, never outcomes.
* Each hand shuffles a uniformly random 100-card prefix of a full shoe
  (front-to-back Fisher–Yates), equivalent in distribution to a full shuffle
  because no hand can consume more than ~60 cards.
* Stake per hand: 1,000,000 minor units, so rounding of 3:2/6:5 payouts is
  negligible; the real game rounds payouts *down* to 0.01 chip, which can
  only lower the RTP (by < 0.01 chip per hand).
* Reported: mean net result per unit of **initial** wager (house edge =
  −mean), its standard error, 95% CI, and variance per unit of initial wager.
* Insurance is never taken by basic strategy and is excluded from the
  estimate.

The generated table lives between the `GENERATED-ESTIMATES` markers in
`src/engine/games/blackjack/estimates.ts`; reports land in
`reports/evidence/blackjack-estimates-2026-10-26.json` (the 16 runs behind the published
table; new runs write `reports/blackjack-simulation-<timestamp>.json`, not committed).
`theoretical()` refuses to publish a
configuration that has no estimate (the admin cannot activate un-simulated
rules), and the UI prints the figure with “≈” and the CI.

### Cross-checks

* `tests/statistical/blackjack.stat.test.ts` plays 120,000 basic-strategy
  hands through the **production** RNG path (HMAC stream → full shuffle),
  independent of the simulation PRNG, and requires the published estimate to
  lie inside the 99.9% CI of the realised edge, the variance to agree within
  5%, dealer up-cards to be uniform, and player naturals to occur at the
  exact rate below.
* Literature values for comparable rules (6 decks, S17, DAS, no surrender,
  peek, re-split to 4, no re-split of aces) are about 0.40%; H17 adds about
  0.2 percentage points, NDAS about 0.14, and 6:5 blackjack about 1.36. The
  simulated table is consistent with these.

## Exact quantities

* Player natural: `P = 2 · (4d/52d) · (16d/(52d−1))` = 4.748% for 6 decks.
* Insurance, ignoring the player's own two cards: the hole card is a ten
  with probability `16d/(52d−1)` (96/311 = 30.87% for 6 decks), so insurance
  returns `3 · 96/311 = 0.926` per unit: house edge **7.40%** (6 decks),
  7.47% (8 decks). Conditioning on the player's cards changes this slightly;
  it is never favourable without card information, which a fresh shoe
  denies.

## Risk model

* **Before the deal** (`assess`): worst case is a player blackjack:
  `maxPayout = stake + ⌊stake · 3/2⌋` (or 6/5).
* **Extra wagers** (double, split, insurance) are separate `AdditionalStake`
  entries escrowed through the ledger. Each declares an outcome-independent
  bound `maxAddedPayout` (double and split: `2 × stake`; insurance:
  `3 × insurance stake`) that the risk engine checks *before* the step is
  applied; the bound never depends on undrawn cards.
* The structural worst case of one round is 4 split hands, each doubled
  (16 × initial stake) plus insurance (1.5 ×); the default per-round payout
  limit (100,000 chips) admits that at the maximum stake (5,000 chips).
* Analytics expectation per round: `stake − edge · initialStake −
  insuranceEdge · insuranceStake`; variance: simulated `σ² · initialStake²`.
  Players who deviate from basic strategy make the realised RTP drift
  below the estimate; the anomaly detector's z-score therefore treats
  blackjack's expectation as approximate.

## Simulated estimates

See `src/engine/games/blackjack/estimates.ts` for the authoritative generated
values (copied here at generation time):

| Rules | House edge (est.) | 95% CI | Variance / unit | Hands |
|---|---|---|---|---|
| `6-S17-3:2-DAS` | 0.419% | 0.379–0.459% | 1.332 | 32,000,000 |
| `6-S17-3:2-NDAS` | 0.544% | 0.466–0.623% | 1.287 | 8,000,000 |
| `6-S17-6:5-DAS` | 1.759% | 1.680–1.838% | 1.294 | 8,000,000 |
| `6-S17-6:5-NDAS` | 1.925% | 1.847–2.002% | 1.250 | 8,000,000 |
| `6-H17-3:2-DAS` | 0.572% | 0.492–0.653% | 1.347 | 8,000,000 |
| `6-H17-3:2-NDAS` | 0.770% | 0.691–0.849% | 1.300 | 8,000,000 |
| `6-H17-6:5-DAS` | 1.915% | 1.836–1.994% | 1.309 | 8,000,000 |
| `6-H17-6:5-NDAS` | 2.223% | 2.145–2.301% | 1.263 | 8,000,000 |
| `8-S17-3:2-DAS` | 0.427% | 0.347–0.507% | 1.333 | 8,000,000 |
| `8-S17-3:2-NDAS` | 0.666% | 0.588–0.745% | 1.287 | 8,000,000 |
| `8-S17-6:5-DAS` | 1.786% | 1.707–1.865% | 1.296 | 8,000,000 |
| `8-S17-6:5-NDAS` | 1.900% | 1.823–1.978% | 1.251 | 8,000,000 |
| `8-H17-3:2-DAS` | 0.622% | 0.542–0.703% | 1.347 | 8,000,000 |
| `8-H17-3:2-NDAS` | 0.822% | 0.743–0.901% | 1.301 | 8,000,000 |
| `8-H17-6:5-DAS` | 1.986% | 1.907–2.065% | 1.311 | 8,000,000 |
| `8-H17-6:5-NDAS` | 2.143% | 2.065–2.221% | 1.264 | 8,000,000 |

Non-default rule sets used 8M hands (CI ±0.08 pp), so differences smaller than about 0.1 pp between them (e.g. 6 vs 8 decks) are not resolved by this table; rerun with more hands before relying on them. The default rule set used 32M hands (±0.04 pp).
