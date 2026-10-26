# Crash — mathematical specification

Implementation: `src/engine/games/crash`. Tests: `tests/unit/crash.test.ts`,
`tests/integration/interactive.test.ts`, `tests/statistical/crash.stat.test.ts`.

Aurovane's crash is **single-player**: each wager starts its own round with its own crash
point from the player's seed pair. (A shared multiplayer round would need a public hash
chain and a broadcast channel; the per-player design keeps every outcome verifiable with
the same commit/reveal protocol as the other games.)

## Crash point (drawn at round start)

From the provably fair stream take 52 bits: n = (uint32 ≫ 12)·2³² + uint32, so n is
uniform on {0, …, 2⁵² − 1}. With house edge h = 100 bp, in exact integer arithmetic:

  crashE2 = max(100, ⌊ 100 · (10000 − h) · 2⁵² / (10000 · (2⁵² − n)) ⌋)   (hundredths; clamped at 10⁹)

For a target X (hundredths, X ≥ 101): crashE2 ≥ X ⇔ 2⁵² − n ≤ 0.99·2⁵²·100/X, so

  **P(crash ≥ x) = 0.99 / x**   (exact up to the 2⁻⁵² granularity of n).

Crash points below 1.01× end the round at take-off:
P(crash = 1.00×) = 1 − 0.99/1.01 = **1.9802%** (verified by the statistical suite).

## Flight and settlement (server clock)

Multiplier at t ms after the round started: ⌊100·e^{r·t}⌋/100, r = 6·10⁻⁵ ms⁻¹
(2× at 11.55 s, 10× at 38.4 s, 100× at 76.8 s, cap 1,000× at 115.1 s).
The crash happens at t(crash) = ln(crash)/r. Settlement rules, in time order:

| Event | Condition | Payout |
|---|---|---|
| Automatic target A reached | A ≤ crash, t ≥ t(A) | ⌊stake · A⌋ |
| Cap C = 1,000× reached | crash ≥ C, t ≥ t(C), no lower auto target | ⌊stake · C⌋ |
| Manual cash-out at server time t | t < t(crash), t < t(A), t < t(C) | ⌊stake · c⌋, c = ⌊100·e^{rt}⌋/100 (< crash) |
| Crash | t ≥ t(crash) and nothing above applied | 0 |

Time-based events are applied by the expiry job (every 5 s), lazily when the round is read,
or when a cash-out request arrives — whichever happens first — always using the event's own
time, never the time it was processed. A manual cash-out is priced at the moment the server
**received** the request (`actOnRound` captures the time before taking any lock), so waiting
for a contended lock or a transaction retry neither raises nor lowers the multiplier
(regression test: `tests/integration/audit-regressions.test.ts`). A request that reaches the
server after the crash is a bust even if the player pressed the button earlier: network
latency to the server is the player's risk (documented in the UI; the automatic target
removes it). The flight's end time is also stored as `game_rounds.expires_at` for the expiry
queue; it is server-only and never part of any response.

## RTP, edge and variance

For any target x ≥ 1.01× (automatic, or a manual cash-out at that multiplier):
RTP = x · 0.99/x = **99%**, house edge **1%**. Cashing out at exactly 1.00× would return
98.02%. Payout rounding to the minor unit lowers returns by < 1 minor unit.

Variance per unit staked for target x: x²·p(1 − p), p = 0.99/x.

| Target | P(win) | RTP | Variance |
|---|---|---|---|
| 1.01× | 98.0198% | 99.00% | 0.0198 |
| 1.50× | 66.0000% | 99.00% | 0.505 |
| 2.00× | 49.5000% | 99.00% | 1.000 |
| 3.00× | 33.0000% | 99.00% | 1.990 |
| 10.00× | 9.9000% | 99.00% | 8.92 |
| 100.00× | 0.9900% | 99.00% | 98.0 |
| 1,000× | 0.0990% | 99.00% | 989 |

Analytics: rounds with an automatic target store that target's exact expectation and
variance. Manual rounds are strategy-dependent; the realised cash-out multiplier (or 2.00×
for a bust without target) is used as the reference strategy — a documented approximation.

## Maximum payout and exposure

Max payout = stake × (automatic target, or the 1,000× cap). It is reserved as open exposure
while the round is in flight. Default limits: stake 0.10–1,000 chips, max payout per round
1,000,000 chips (so a 1,000-chip wager needs no target; larger potential payouts are refused
before take-off).

## Validation

* Exact: bit-space survival probabilities by binary search over the monotone mapping
  (matches 0.99/x to 10⁻¹⁰), clamp boundaries, time↔multiplier conversion.
* Rounds: manual cash-out pricing by server time, post-crash bust, automatic target wins iff
  target ≤ crash even with no further requests, instant bust, cap, verifier ≡ engine.
* Statistical (500,000 crash points): χ² over 9 tail bins at α = 0.001; RTP of targets 1.10×,
  2.00×, 10.00× within 99.9% CIs of 99%; instant-bust share consistent with 1.98%.
