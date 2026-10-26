# Architecture

Aurovane is a single Next.js 15 application (App Router, TypeScript strict) backed by
PostgreSQL 16. It is organised as three layers with lint-enforced boundaries
(`eslint.config.mjs`, `no-restricted-imports`):

| Layer | Path | May import | Must never import |
|---|---|---|---|
| **Engine** – game rules, mathematics, provably fair RNG, statistics | `src/engine` | `zod`, `@noble/hashes` | anything from `server`, `app`, `components`, React, Next, Node built-ins; `Math.random` |
| **Server** – domain services, persistence, HTTP plumbing | `src/server` | engine | `components`, `app`, client libs |
| **Presentation** – pages, route handlers, components | `src/app`, `src/components`, `src/lib` | engine (pure) and, for `app` only, server | — (`components` may not import `server`) |

The engine is *isomorphic*: the same code computes outcomes on the server and
re-computes them in the browser verifier, so a player can check results with the
exact code that produced them.

## Why one Next.js app instead of a separate API service

* The API is a thin layer over domain services; route handlers (`src/app/api/**/route.ts`)
  only parse input, authenticate and call a service. Moving the services behind a separate
  Fastify/Express process later is mechanical because nothing in `src/server` depends on Next.
* Server components read from the same services directly (no internal HTTP hop).
* The admin back office is a separate route tree (`/admin`, `/api/admin`) with its own
  layout and permission checks on every page and endpoint; it answers **404** to anyone
  without staff permissions. It can be split into its own deployment by routing `/admin*`
  to a separate instance/network if required.

## Component diagram

```mermaid
flowchart LR
  subgraph Browser
    UI[Player UI\nReact client components]
    VER[Fairness verifier\n(engine in browser)]
    ADM[Admin UI]
  end
  subgraph App[Next.js server]
    RH[Route handlers\nsrc/app/api]
    RSC[Server components\nsrc/app/**/page.tsx]
    subgraph Services[src/server]
      AUTH[auth + sessions + RBAC]
      ROUND[round service]
      RISK[risk engine]
      LEDGER[ledger + wallet]
      FAIR[seed management]
      RG[responsible play]
      PROMO[promotions]
      ADMIN[admin service]
      ANA[analytics]
      AUD[audit]
      OBS[logging · metrics · errors · health]
      JOBS[scheduler: reconciliation · anomalies · expiry · cleanup]
    end
    ENGINE[src/engine\npure game modules + RNG]
  end
  DB[(PostgreSQL\nconstraints + triggers)]
  UI -- JSON + Idempotency-Key --> RH
  ADM --> RH
  RSC --> Services
  RH --> Services
  ROUND --> ENGINE
  ROUND --> RISK & LEDGER & FAIR & RG
  Services --> DB
  JOBS --> DB
  VER -. same code .- ENGINE
```

## Request flow: placing a wager

```mermaid
sequenceDiagram
  participant C as Client
  participant H as Route handler
  participant S as Round service
  participant DB as PostgreSQL
  C->>H: POST /api/games/dice/rounds {bet} + Idempotency-Key
  H->>H: Origin check (CSRF) · session · rate limit · JSON/Zod
  H->>S: startRound(user, game, bet, key)
  S->>DB: BEGIN
  S->>DB: INSERT idempotency_keys (blocks duplicates; replay if committed)
  S->>S: validate bet with engine schema · assess risk profile
  S->>DB: SELECT wallet FOR UPDATE
  S->>DB: responsible-play checks (limits, breaks, exclusion)
  S->>DB: SELECT seed pair FOR UPDATE · nonce++
  S->>DB: SELECT house FOR UPDATE · exposure sums · evaluate limits
  S->>S: engine.start(config, bet, HMAC stream(seed, client seed, nonce))
  S->>DB: INSERT round, bets, ledger BET_PLACED (wallet → escrow)
  S->>DB: (instant games) ledger BET_SETTLED, payouts row, round SETTLED
  S->>DB: store response on idempotency row
  S->>DB: COMMIT (deferred check: every ledger transaction sums to 0)
  S-->>H: {round, balance}
  H-->>C: 201 JSON (no-store)
```

Everything between `BEGIN` and `COMMIT` is one PostgreSQL transaction. Any failure —
validation, a limit, a constraint, a crash — rolls back *all* effects, including the
nonce consumption and the idempotency record, so a retry with the same key starts clean.
This is exercised by fault-injection tests (`tests/integration/rounds.test.ts`).

## Concurrency model

* Transactions run at READ COMMITTED with explicit row locks; serialization failures and
  deadlocks are retried (`withTransaction`).
* **Lock order** (deadlock-free by construction): player wallet → round row → seed pair →
  house bankroll → wagers-in-play → other system accounts. Ledger entries are inserted in
  canonical account order (wallets by id, then system accounts by rank).
* The wallet lock serialises all money movement for one player; the house-bankroll lock
  serialises risk decisions so exposure cannot be over-committed by concurrent wagers.
  This bounds throughput on a single hot row (measured in `docs/testing.md`); the scaling
  path is sharded house sub-accounts with per-shard exposure budgets.
* Balances are updated by a database trigger as entries are inserted, under the account
  row lock, and each entry receives a gapless per-account sequence number. Entry ids are
  not commit-ordered; `(account_id, account_seq)` is.

## Money bounds

All amounts are integer minor units (1 chip = 100). `MAX_AMOUNT` = 10¹⁴ bounds every
single amount; `MAX_MULTIPLIER` = 100,000× bounds every configurable payout multiplier
(Mines and Crash cap schemas); `MAX_STAKE` = `MAX_AMOUNT / MAX_MULTIPLIER` = 10⁹ (10,000,000
chips) bounds every bet schema. Hence no payout, exposure or risk computation for a
schema-valid bet can leave the exact integer range, whatever the configuration
(`tests/unit/money.test.ts`). Table limits are much lower and enforced by the risk engine.
Multiplier payouts use exact BigInt `mulDivFloor` (rounding down by < 1 minor unit).

## Game module contract

`src/engine/games/types.ts` — every game implements:

| Member | Purpose |
|---|---|
| `configSchema`, `defaultConfig` | Versioned, validated configuration (house edge must be > 0) |
| `betSchema`, `actionSchema` | Zod schemas for untrusted player input (strict: unknown keys rejected) |
| `assess(config, bet)` | Validates and returns the risk profile: stake, max payout, expected payout, variance |
| `wagers(config, bet)` | Breakdown into individual wagers (one row per roulette position) |
| `start(config, bet, rng)` | Draws all randomness for the round; returns initial or final state |
| `act(config, state, action, ctx)` | Deterministic state transition for interactive games (may request extra stakes) |
| `expire(config, state, ctx)` | Time-based settlement (e.g. crash) |
| `expiresAfterMs(config, state)` | Explicit expiry capability: elapsed ms from which `expire` settles the state, or `null` (never) |
| `view(config, state, settled)` | Client-safe projection; hides secrets until the round is final |
| `theoretical(config)` | Documented RTP / house edge, exact or simulation estimate with CI |

### Time-based expiry

The server stores the settlement deadline
`game_rounds.expires_at = started_at + expiresAfterMs(state) + 1 s` (the grace
of `src/server/games/action-timing.ts`; recomputed after every step; `NULL`
for rounds that never settle by time, always `NULL` once a round is finished —
enforced by a CHECK constraint). No path settles a round by time before that
deadline, judged by the database clock read under the round's locks; player
actions are ordered against settlement by the same rule
(`docs/math/crash.md` § Ordering). The `expire-rounds` job (every 5 s,
advisory-locked, also `npm run job:expire-rounds`) selects only
`status = 'OPEN' AND expires_at <= clock_timestamp()`,
oldest due first, through the partial index `game_rounds_expiry_due_idx`.
Non-expiring games (Mines, Blackjack) therefore never occupy the queue. Each
round is settled in its own transaction under the wallet and round locks with
the status re-checked, and the ledger settlement key is unique, so repeated or
concurrent runs (scheduler, lazy expiry on read) settle a round at most once.
A round whose expiry fails is deferred with backoff (5 s doubling to 1 h,
`expiry_attempts`) and reported to `error_events`; it cannot block the rounds
behind it. Reconciliation flags rounds overdue by more than 5 minutes.

Adding a game = a new module + registry entry + catalogue entry (limits) + UI component.
Wallet, ledger, risk, fairness, history, analytics and admin work unchanged.

## Repository structure

```
migrations/            forward-only SQL migrations (schema, constraints, triggers)
scripts/               migrate · seed · reconcile · expire-rounds · simulations · demo activity
src/engine/            pure game engine (money, rng, games/*, stats, verify)
src/server/            domain services (db, auth, ledger, wallet, risk, games, fairness,
                       responsible, promotions, admin, analytics, audit, observability,
                       jobs, http)
src/app/               pages and API route handlers (player area, /admin, /api)
src/components/        UI kit, layout, game screens, account and admin components
src/content/           player-facing rules and payout tables (tested against the engine)
tests/unit             engine and pure server logic
tests/statistical      large-sample checks (chi-square, RTP confidence intervals)
tests/integration      real PostgreSQL: ledger, rounds, concurrency, auth, admin, API
tests/e2e              Playwright against the production standalone build
docs/                  specifications, mathematics, threat model, operations
```

See also: [database.md](database.md) · [api.md](api.md) · [fairness.md](fairness.md) ·
[risk.md](risk.md) · [threat-model.md](threat-model.md) · [math/](math/).
