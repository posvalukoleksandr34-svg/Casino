# Product specification

## 1. Overview

Aurovane is a premium, **virtual-currency-only** online casino. Players receive free
virtual chips (no purchase, no withdrawal, no exchange) and play server-authoritative
games whose rules, probabilities and payouts are published and whose outcomes are
provably fair. Operators run it from a back office with risk controls, analytics,
reconciliation and a complete audit trail.

Positioning: *transparency as the product*. Every game has a documented positive house
edge; the platform shows it plainly and gives players the tools to verify outcomes and
control their play.

**Out of scope (by design):** real-money deposits/withdrawals, payment details,
cryptocurrency, any conversion of chips to value, marketing messages that encourage play,
fake winner feeds, near-miss effects.

## 2. Personas

| Persona | Goal |
|---|---|
| Player | Play fair-looking, well-made casino games for entertainment; understand the odds; stay in control |
| Support agent | Look up a player's rounds and transactions; suspend abusive accounts |
| Risk manager | Configure limits, suspend games during incidents, investigate anomalies |
| Auditor | Read-only access to everything incl. the audit log |
| Administrator | All of the above plus roles, compensating corrections, reserve funding |

## 3. User stories (MVP)

1. As a visitor I can register with e-mail, username, password and an 18+/virtual-currency
   confirmation, and receive 10,000 welcome chips.
2. As a player I can sign in/out, reset a forgotten password and change my password.
3. As a player I can play European roulette with several simultaneous bets and see the
   total stake, best-case payout and expected return before spinning.
4. As a player I can play dice choosing target, direction and risk profile, seeing win
   chance, multiplier and payout before rolling.
5. As a player I see my balance update only after the server has settled the round.
6. As a player I can view my transaction statement and game history and open any round.
7. As a player I can see my active seed commitment, rotate seeds, and verify any past
   round in my browser.
8. As a player I can set loss/wager/session limits, reality checks, take a break or
   self-exclude, and export or delete my data.
9. As a player whose connection drops mid-bet I can safely retry without being charged twice.
10. As a risk manager I can suspend a game or stop all new rounds with a reason, and
    change stake/payout/exposure limits.
11. As an administrator I can see wagered, paid, GGR, NGR, actual vs theoretical RTP with
    statistical significance, exposure and reserves.
12. As an auditor I can see who changed what, when, from what to what, and why.

Phase 5 adds Crash, Mines, Blackjack and Slots with the same guarantees.

## 4. Functional requirements

| ID | Requirement |
|---|---|
| F1 | Server generates every outcome from a CSPRNG-seeded HMAC stream; clients submit only choices |
| F2 | Every wager passes validation, responsible-play checks, balance check and risk evaluation **before** randomness is used |
| F3 | Stakes, payouts, bonuses, refunds and corrections are double-entry ledger transactions |
| F4 | Wager and action requests are idempotent via `Idempotency-Key` |
| F5 | Game configuration is versioned and immutable; every round references its version |
| F6 | Games can be suspended/disabled; a platform kill switch blocks new rounds |
| F7 | Open rounds survive disconnects and can be resumed (`/api/rounds/active`) |
| F8 | Analytics compare realised with theoretical results using stored per-round expectation and variance |
| F9 | Reconciliation verifies 17 ledger/round/operational invariants on a schedule and on demand |
| F10 | All state-changing staff actions require a reason and are audited with before/after |
| F11 | Players can export their data and delete their account (financial records retained, pseudonymised) |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | Integer minor units; BigInt for multiplications; payouts rounded down < 1 minor unit |
| Consistency | One DB transaction per request; DB constraints and triggers back every invariant |
| Security | scrypt (N = 2¹⁷), hashed session tokens, HttpOnly SameSite cookies, Origin-checked writes, CSP, RBAC, rate limits, secrets never sent to clients, encrypted server seeds |
| Performance | Single-player wager p95 < 100 ms; ≥ 70 settled wagers/s per node with p95 < 500 ms under 50 continuously-betting players (measured, see testing.md); horizontal scaling path documented |
| Availability | Stateless app instances; jobs coordinated with advisory locks; health/readiness probes |
| Observability | JSON logs with redaction, Prometheus metrics, error events, operational dashboard |
| Accessibility | Keyboard-operable controls, focus management, ARIA labels, reduced motion, contrast on dark surfaces |
| Portability | Docker image, environment-only configuration, forward-only migrations |

## 6. Acceptance criteria (measurable)

| # | Criterion | How verified |
|---|---|---|
| A1 | Every game's theoretical RTP < 100% (positive house edge); roulette exactly 36/37; dice ∈ (98.99%, 99.00%] for every allowed target | unit tests (exact / exhaustive) |
| A2 | Empirical RTP within 99.9% CI of theory over ≥ 370k simulated rounds; outcome distributions pass χ² at α = 0.001 | statistical tests |
| A3 | 0 reconciliation mismatches after concurrent load and fault injection | integration tests, `npm run job:reconcile` |
| A4 | Duplicate requests (same key, sequential or 8× concurrent) produce exactly one round and one charge | integration + e2e |
| A5 | 20 concurrent wagers on one wallet never produce a negative balance | integration |
| A6 | A crash injected at any point of a wager leaves no round, entry, nonce consumption or idempotency record | integration (3 fault points) |
| A7 | Ledger rows, audit rows and settled rounds cannot be updated or deleted through SQL | integration |
| A8 | Players receive 403/404 for every admin API/page | API + e2e tests |
| A9 | Cross-origin writes are rejected (403) | API + e2e tests |
| A10 | The browser verifier reproduces every outcome after seed rotation | integration + e2e |
| A11 | Register → play → balance/transactions/history agree end to end | e2e |
| A12 | No horizontal scroll on a 412 px wide mobile viewport for game pages | e2e (mobile project) |

## 7. MVP scope

Authentication, wallet, ledger, European roulette, dice, game and transaction history,
statistics, fairness verification, responsible play, admin dashboard, analytics,
reconciliation, automated tests, Docker. (Delivered — see README "Status".)

## 8. Assumptions and constraints

* Virtual currency only; chips have no value. Bonus amounts are configurable.
* One currency (`CHIP`, 2 decimals). Multi-currency would add a currency column to accounts
  and require same-currency postings.
* Single PostgreSQL primary; the hot house-bankroll row bounds wager throughput (documented
  scaling path: sharded house sub-accounts).
* E-mail delivery is not integrated; password-reset links are logged in development only.
* Session time limits are measured per login session.
* Theoretical figures for strategy-dependent games (blackjack) are simulation estimates with
  confidence intervals and are labelled as such.
