# Dice — mathematical specification

Implementation: `src/engine/games/dice`. Tests: `tests/unit/dice.test.ts`, statistical suite.

## Outcome space

roll = int(10000) ∈ {0, …, 9999}, each with probability 1/10,000, displayed as roll/100
(0.00–99.99).

## Rules

The player chooses target t (in hundredths) and a direction:

| Direction | Wins when | Winning outcomes w |
|---|---|---|
| under | roll < t | w = t |
| over | roll > t | w = 9999 − t |

Allowed: 100 ≤ w ≤ 9800 (win chance 1.00%–98.00%; configurable). Boundary outcomes
(roll = t) lose in both directions.

Multiplier (4 decimals, rounded down), house edge h in basis points (default 100 = 1%):

  multiplierE4 = ⌊(10000 − h) · 10000 / w⌋,  gross payout = ⌊stake · multiplierE4 / 10000⌋

computed with BigInt (exact). A losing roll returns 0.

## RTP and house edge

RTP(w) = (w/10000) · (multiplierE4/10000) ≤ 1 − h/10000 = 99.00%.
Rounding the multiplier down lowers RTP by at most (w/10⁴)·(1/10⁴) < 0.0001; rounding the
payout to the minor unit lowers it by < 1 minor unit per bet. Exhaustively verified for
every allowed w: 98.99% < RTP ≤ 99.00%, so house edge ∈ [1.00%, 1.01%).

Player EV for stake s = s · (RTP(w) − 1) ≈ −0.01 s.

| Win chance | Multiplier | RTP | Var per unit | SD per unit |
|---|---|---|---|---|
| 98.00% | 1.0102× | 98.9996% | 0.0200 | 0.1414 |
| 90.00% | 1.1000× | 99.0000% | 0.1089 | 0.3300 |
| 75.00% | 1.3200× | 99.0000% | 0.3267 | 0.5716 |
| 49.50% | 2.0000× | 99.0000% | 0.9999 | 0.9999 |
| 33.00% | 3.0000× | 99.0000% | 1.9899 | 1.4106 |
| 20.00% | 4.9500× | 99.0000% | 3.9204 | 1.9800 |
| 10.00% | 9.9000× | 99.0000% | 8.8209 | 2.9700 |
| 5.00% | 19.8000× | 99.0000% | 18.6219 | 4.3153 |
| 1.00% | 99.0000× | 99.0000% | 97.0299 | 9.8504 |

Var(X) = m² p (1 − p) for gross return X per unit stake, p = w/10⁴, m = multiplier.

## Maximum payout and exposure

Max payout = ⌊stake · 99⌋ at 1% (99×). The default per-round payout cap is 100,000 chips,
so at 1% the effective maximum stake is ≈1,010 chips — larger wagers are rejected before
the roll. Instant settlement: no exposure persists after the request.

## Validation

* Exhaustive: for sample targets, counting winning rolls over all 10,000 outcomes equals w;
  exact expected payout equals the assessed expectation; RTP bounds over all w.
* Statistical (500,000 rolls per case): uniformity χ² = 82.1 vs critical 148.3 (df 99,
  α = 0.001); empirical RTP CIs contain theory at 49.5%, 10% (over 10.00), 5%.
