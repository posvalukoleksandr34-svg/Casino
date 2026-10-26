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

## Ordering: cash-out versus settlement by time

Implemented in `src/server/games/action-timing.ts` (the rule) and
`src/server/games/round-service.ts` (`actOnRound`, `expireRoundIfDue`).

**Instants.** `t_end` is the engine-declared end of the flight: the crash, the automatic
target or the cap, whichever applies (`flightEndMs`, rounded up to a whole millisecond).
The **settlement deadline** is `D = t_end + G`, with grace `G = 1,000 ms`
(`TIME_SETTLEMENT_GRACE_MS`). Each request has two server-side instants:

* `receivedAt`: the application clock when the HTTP request reached the route wrapper,
  before authentication, rate limiting or any lock (`BaseContext.receivedAt`). Client
  timestamps are never used.
* `processedAt`: the **database** clock (`clock_timestamp()`), read after the player's wallet
  and the round row are locked. All instances share this one clock.

**Rule.** A manual cash-out is applied, priced at `receivedAt`, iff
`receivedAt < t_end` **and** `processedAt < D`. Settlement by time (bust, automatic target
or cap) never happens before `D`, whichever path tries it: the expiry job, lazy settlement
when the round is read, or a late request. Each of these reads the database clock under the
same locks.

| Request | Condition | Result |
|---|---|---|
| Qualifying | received before `t_end`, processed before `D` | 200, `resolution: "applied"`; pays ⌊stake · c(receivedAt)⌋ |
| Late | received at or after `t_end`, processed before `D` | 422 `GAME_RULE`, `details.rule = "ROUND_ENDED"`; **nothing changes** (the round settles at `D`) |
| Late, after the deadline | received at or after `t_end`, processed at or after `D` | 200, `resolution: "received_after_end"`; this request settles the time-based outcome |
| In time but processed too late | received before `t_end`, processed at or after `D` | 200, `resolution: "processing_deadline_passed"`; settled by time, the cash-out is not applied; logged as a warning and counted |
| Duplicate (same `Idempotency-Key`) | any | the stored response, `Idempotent-Replayed: true`; a duplicate that arrives while the original is in flight waits for it |
| Already committed | the round was settled before this request held the lock | 409 `CONFLICT`, `details.resolution = "already_settled"` |

The end instant itself belongs to the end: a request received exactly at `t_end` is late.

**Why scheduling cannot change an outcome.** Every decision is taken under the same two
locks (wallet, then round) and compares a single clock with the same stored deadline:

* A cash-out that holds the locks with `processedAt < D` cannot find the round settled by
  time. That would need an earlier settlement reading of at least `D` under the same locks,
  and the clock does not go back.
* A cash-out that finds the round already settled therefore has `processedAt ≥ D`, so the
  rule rejects it anyway. Lock order only decides *which* path writes the settlement, never
  *what* it is. The regression suite forces both lock orders and gets the same financial
  outcome.

Before this rule, any time-based settlement that started after `t_end` could take the locks
first and bust a cash-out received before it. The receipt time was also taken only after the
session check and the rate limiter. `tests/integration/crash-ordering.test.ts` reproduces
both on the old code: a settlement started 200 ms after the crash pre-empted an in-time
cash-out, and a 1.5 s rate-limiter delay raised the price from 1.00× to 1.09×.

**What the grace bounds.** `G` is a budget for the time between receipt and holding the
locks: session lookup, rate limit, idempotency key and lock waits, normally a few
milliseconds. A request that exceeds it (an overloaded database, a lock held for over a
second) is resolved by time, deterministically and visibly
(`casino_round_actions_total{resolution="processing_deadline_passed"}` plus a warning log
with the delay), instead of by whichever transaction wins a lock. Retries are new receipts
unless the original committed; a retry of a committed request replays it.

**Effect on play.** Payouts and probabilities are unchanged: each request's outcome depends
only on the crash point and its receipt time, exactly as in the table above. What changes is
*when* a bust becomes visible. It is settled, and shown, from `D`, up to about one second
after the crash plus the client's 300 ms poll. A request received after the crash was always
a bust and still is. Network latency to the server is still the player's risk; the
automatic target removes it. The flight's end time stays server-only: the queue stores `D` in
`game_rounds.expires_at`, which is never part of any response.

**Assumptions.** Application and database clocks are NTP-synchronised. A skew of δ between
them shortens or lengthens the effective grace by δ, but cannot reorder decisions, because
those all use the database clock. On a multi-instance deployment, receipt times come from
each instance's clock, so instance skew shifts which requests count as received before the
crash. Keep skew well below network latency.

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
