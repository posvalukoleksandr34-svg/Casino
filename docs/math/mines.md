# Mines — mathematical specification

Implementation: `src/engine/games/mines`. Tests: `tests/unit/mines.test.ts`,
`tests/integration/interactive.test.ts`, statistical suite.

## Outcome space

At round start a Fisher–Yates shuffle of the 25 tiles (driven by `int(i + 1)` from the
provably fair stream) is taken; the first m entries are the mines. All C(25, m) layouts
are equally likely. Nothing is drawn afterwards: reveals and cash-outs are deterministic
transitions over that fixed layout.

## Rules and payout

After k safe reveals, with house edge h = 1%:

  P(k) = C(25 − m, k) / C(25, k)            (probability the first k picks are all safe)
  multiplierE4(k) = min(⌊(10000 − 100) · C(25, k) / C(25 − m, k)⌋, cap)      cap = 10,000,000 (1,000×)
  payout = ⌊stake · multiplierE4 / 10⁴⌋

The player may cash out after any k ≥ 1. Revealing all 25 − m safe tiles, or reaching the
cap, cashes out automatically. Hitting a mine pays 0.

Because the layout is uniformly random and the player's choices only determine *when to
stop*, the identity of the tiles picked never matters: given k safe reveals, each of the
remaining 25 − k tiles hides a mine with probability (m)/(25 − k).

## RTP

For the strategy "cash out after exactly k picks": RTP(k) = P(k) · multiplier(k) ≤ 0.99,
equal to 0.99 up to the 4-decimal floor (< 0.0001) whenever the cap does not bind.

**Every strategy, including adaptive ones.** Let S_k be the event that the first k picks
are safe and f(k) = 1/P(k) the fair multiplier. Given any history with k safe picks, the
next pick is safe with probability q = (25 − m − k)/(25 − k), whichever tile is chosen
(the layout is exchangeable). Hence E[f(k+1)·1{S_{k+1}} | history] = f(k+1)·q·1{S_k} =
f(k)·1{S_k}: the sequence f(k)·1{S_k} is a martingale with value 1 at k = 0. The player's
stopping point T is a stopping time bounded by 25 − m, so by optional stopping
E[f(T)·1{S_T}] = 1. The actual payout is ⌊0.99·f(T)⌋ (and possibly capped) times
1{S_T}, which is ≤ 0.99·f(T)·1{S_T}; therefore **E[payout] ≤ 0.99 × stake for every
strategy: house edge ≥ 1%.** The cap only lowers returns (e.g. clearing 22 tiles with
3 mines pays 1,000× instead of 2,277×, RTP 43.5% for that particular strategy).

Selected values (exact; variance is per unit staked for the fixed-k strategy):

| Mines | k | P(safe through k) | Multiplier | RTP | Variance |
|---|---|---|---|---|---|
| 1 | 1 | 96.00% | 1.0312× | 98.995% | 0.041 |
| 1 | 24 | 4.00% | 24.75× | 99.000% | 23.52 |
| 3 | 1 | 88.00% | 1.1250× | 99.000% | 0.134 |
| 3 | 3 | 66.96% | 1.4785× | 98.995% | 0.484 |
| 3 | 5 | 49.57% | 1.9973× | 98.997% | 0.997 |
| 5 | 3 | 49.57% | 1.9973× | 98.997% | 0.997 |
| 5 | 5 | 29.18% | 3.3925× | 98.997% | 2.378 |
| 10 | 1 | 60.00% | 1.6500× | 99.000% | 0.653 |
| 10 | 5 | 5.65% | 17.5153× | 99.000% | 16.36 |
| 24 | 1 | 4.00% | 24.75× | 99.000% | 23.52 |

## Maximum payout, exposure and reserves

Max payout = stake × multiplier at the final reachable pick (all-safe or the cap):
24.75× for 1 or 24 mines, up to 1,000× otherwise. The risk engine reserves this worst
case as **open exposure** (max payout − stake) from the moment the round starts until it
settles; the wager is rejected up front if it would breach the per-round payout limit
(default 1,000,000 chips), the game or platform exposure limits, or the reserve floor.
Default stake range 0.10–1,000 chips.

## Analytics treatment

Mines is strategy-dependent, so the stored per-round expectation and variance use the
fixed-k strategy matching how far the player actually went (k = picks attempted). The
expectation is exact for that k; the variance is an approximation of the round's true
(adaptive-strategy) variance, documented as such in analytics.

## Validation

Unit: binomial values, survival products, documented multipliers, RTP bounds for every
(m, k), auto-settlement at all-safe and at the cap, invalid actions, verifier ≡ engine.
Integration: full round over the real ledger (stake held in escrow while open), recovery,
seed rotation refused while open, void refunds, suspension still lets open rounds finish.
Statistical: 200,000 simulated rounds per case (see testing.md).
