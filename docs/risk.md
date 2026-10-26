# Risk management

Two separate things carry the name "risk" here:

1. the **risk engine**, which accepts or rejects each wager before any randomness is
   used, so the house can always pay what it has accepted; and
2. the **bankroll model** (`npm run sim:risk`), a Monte Carlo study of how house results
   vary and how large a reserve the configured limits call for.

Neither ever changes odds, outcomes or payouts, and neither looks at who the player is,
their history, balance or past results. The house edge comes only from the published game
rules.

## 1. Risk engine

`src/server/risk/evaluate.ts` (pure, unit-tested) and `src/server/risk/risk-service.ts`
(snapshot under the house-bankroll row lock, SQL function `risk_snapshot`, migration 0002).

**Order of operations** in `startRound` (`src/server/games/round-service.ts`): validate the
bet → responsible-play checks → wallet lock and balance → reserve the nonce → **risk
decision from the bet's worst case only** → draw the outcome → record. The decision cannot
depend on the outcome because the outcome has not been computed yet; a rejection rolls back
the nonce reservation.

**Definitions** (minor units):

* net exposure of a round = max payout − stake (largest possible house loss);
* open exposure = Σ net exposure of OPEN rounds (per game and in total);
* worst-case house balance = house balance − open exposure − this wager's net exposure.

**Checks, in order** (each rejection has a stable reason code shown to the player):

| Code | Rule |
|---|---|
| `NEW_ROUNDS_DISABLED` | platform kill switch engaged (open rounds can still be finished) |
| `GAME_NOT_ACTIVE` | game suspended/disabled |
| `STAKE_BELOW_MINIMUM` / `STAKE_ABOVE_MAXIMUM` | table limits (initial wager) |
| `MAX_PAYOUT_EXCEEDED` | round's max payout above the per-round cap |
| `GAME_EXPOSURE_EXCEEDED` | game open exposure cap |
| `TOTAL_EXPOSURE_EXCEEDED` | platform open exposure cap |
| `HOUSE_RESERVE_INSUFFICIENT` | worst-case house balance below the minimum reserve |
| `PLAYER_BALANCE_CAP` | a max win would take the player above the virtual balance cap |

**Mid-round wagers** (blackjack double/split/insurance) declare an outcome-independent
`maxAddedPayout` bound before the next card is used; the service rejects any engine step
whose new worst case exceeds the previous one plus the declared bounds, and evaluates the
bound (not the realised hand) against the limits. Property tests
(`tests/unit/step-invariants.test.ts`) check this over thousands of random action
sequences.

**Bounds that make the arithmetic safe:** every stake ≤ `MAX_STAKE` (10,000,000 chips) and
every configurable multiplier ≤ `MAX_MULTIPLIER` (100,000×), so no payout can exceed
`MAX_AMOUNT` (10¹⁴ minor units) and all money stays exact integer arithmetic.

### Default limits (bootstrap; editable in `/admin/games` and `/admin/risk`, audited)

| Game | Stake range (chips) | Max payout / round | Max game exposure |
|---|---|---|---|
| Roulette | 0.10 – 10,000 | 360,000 | 50,000,000 |
| Dice | 0.10 – 10,000 | 100,000 | 50,000,000 |
| Mines | 0.10 – 1,000 | 1,000,000 | 50,000,000 |
| Crash | 0.10 – 1,000 | 1,000,000 | 50,000,000 |
| Blackjack | 1 – 5,000 | 100,000 | 50,000,000 |

Platform: total open exposure 500,000,000; minimum house reserve 100,000,000; player
balance cap 100,000,000 chips. The initial virtual house bankroll is 1,000,000,000 chips.

## 2. Bankroll model — `npm run sim:risk`

Model and assumptions: `scripts/sim/risk-model.ts` (unit-tested in
`tests/unit/risk-model.test.ts`). Everything it outputs is **simulated** and is never mixed
with live analytics.

* Rounds are independent: every round has its own provably fair draw (single-player games),
  so there is no outcome correlation between players by construction. Correlated
  *behaviour* (many players raising stakes together) is modelled by the stake and volume
  parameters, not by correlated outcomes.
* Payout distributions are built from the engine's own payout functions (exact for
  roulette, dice, Mines with a fixed cash-out step, Crash with an automatic target; an
  empirical basic-strategy histogram for blackjack, with its sample size reported).
  Payouts are floored to the minor unit as in production.
* Stakes are log-normal (median 10 chips, σ = 1.2 by default) clamped to each game's table
  limits and per-round payout cap (larger wagers would be rejected by the risk engine).
* Not modelled: bonus cost (promotions), staff adjustments, open-round timing (the
  exposure caps bound simultaneous liability and are reported as a deterministic stress
  figure).
* Reproducible: the same `--seed` and parameters give the same numbers. Reports record the
  seed, the commit and whether the working tree had uncommitted changes.
* **Bankroll definition.** The model tracks the house's cumulative game result (stakes
  collected minus payouts) from zero at the start of each path. "Drawdown" is the largest
  fall from a running peak of that result. It does not start from, or deplete, the
  configured bankroll. Compare the drawdown quantiles with the reserve you hold.
* **Bet sizing.** Each round draws its stake independently from the log-normal above. There
  is no martingale, loss chasing or progressive staking, and no dependence on past outcomes.
  Strategy-dependent games use fixed strategies: a fixed Mines cash-out step, a Crash
  automatic target, and blackjack basic strategy.
* **Stopping.** Every path runs the full horizon (`--days` × `--rounds-per-day`). There is
  no ruin barrier, because the house is never stopped by a loss. The probability of the
  house being down is measured at the horizon, and drawdowns are taken along the path.
* **Interpretation.** These are estimates under the stated assumptions, with confidence
  intervals, not guarantees. Real volume, stake distributions, player mix and strategy
  differ. Tail quantiles are only as reliable as the number of paths beyond them, and the
  report marks the unresolved ones.
* **Self-consistency check** (`--check`, run weekly by the extended workflow): the
  simulated mean P&L must lie within 4 standard errors of the exact expectation for the
  sampled stakes, and no payout may exceed the largest per-round cap. A failure points to
  a defect in the simulator or the caps. It does not say whether the reserve is adequate.

### Reference run (2026-10-26)

`npm run sim:risk -- --paths 1000` — 1,000 paths × 30 days × 10,000 rounds/day, default mix
(roulette 30 %, dice 25 %, Mines 15 %, Crash 15 %, blackjack 15 %), seed 1,2,3,4.
Full output: `reports/evidence/risk-reference-2026-10-26.json`.

| Quantity (per 30-day path) | Result |
|---|---|
| Handle (total staked), mean | 6,282,355 chips |
| House P&L — theoretical expectation | 84,648 chips |
| House P&L — simulated mean (95 % CI) | 86,608 (82,423 – 90,793) chips — consistent with theory |
| Realised hold | 1.38 % |
| P&L 1st / 0.1th percentile | −85,365 / −155,070 chips |
| Probability the house is down after 30 days | 10.0 % |
| Losing days per path, mean | 10.5 of 30 |
| Max drawdown, 99th percentile (95 % CI) | 143,037 (135,053 – 191,805) chips |
| Max drawdown, 99.9th percentile | 210,922 chips — **not resolved** at 1,000 paths (fewer than 10 paths beyond it) |
| Largest single payout observed | 100,000 chips (the Dice per-round cap) |

**Reserve.** At this volume a reserve covering the 99 % drawdown (upper CI) plus one
maximum per-round payout is about **1.19 million chips**; the configured minimum reserve
(100 million) and the initial bankroll (1 billion) exceed it by orders of magnitude, so at
this scale the binding constraint is the exposure caps, not variance. The deterministic
stress — every open round paying its maximum at once — is bounded by the total open
exposure cap (500 million chips), which the reserve check keeps covered at all times
(`HOUSE_RESERVE_INSUFFICIENT`). Re-run the model with your expected volumes and stake
distribution before changing limits; for tail quantiles beyond 99 % use at least
`10 / (1 − q)` paths (e.g. 10,000 paths for 99.9 %).

The scheduled CI workflow (`.github/workflows/extended.yml`) runs the model weekly with `--check`
(2,000 paths; local run 2026-10-26: P&L z = 1.20, largest payout 113,347 chips ≤ cap, 171 s).
