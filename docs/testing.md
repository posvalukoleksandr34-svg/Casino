# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Unit | `npm run test:unit` | nothing | engine maths, RNG, money bounds, verifier, content-vs-engine, config/seed safety, admin guards, contrast, risk model |
| Integration | `npm run test:integration` | PostgreSQL (`DATABASE_URL_TEST`, name must end in `_test`; wiped each run) | ledger invariants, rounds and concurrency, expiry queue, reconciliation (incl. fault injection), least-privilege role, auth and password recovery (SMTP), responsible play, admin, API routes |
| Statistical | `npm run test:stats` | nothing | fixed-seed chi-square and RTP confidence-interval tests for every game (≈1 min) |
| End-to-end | `npm run build && npm run test:e2e` | PostgreSQL (`DATABASE_URL_E2E`, name must contain `e2e`; reset each run), Chromium | Playwright against the **production standalone build**, desktop and mobile |
| Docs | `npm run check:docs` | nothing | relative Markdown links resolve |
| Bundle | `npm run check:bundle` (after build) | nothing | no server secret names/values in `.next/static` |
| Extended | `.github/workflows/extended.yml` | nothing | 2M-round Monte Carlo per exact-game scenario (fails beyond 4σ), blackjack estimate re-check, risk model |

Integration and e2e setups create the least-privilege role `casino_app` when the test user
may (a superuser, as in CI). Otherwise they stop with the exact SQL to run once:
`CREATE ROLE casino_app NOLOGIN; GRANT casino_app TO <test user>;`. The e2e server and a
dedicated integration test connect *through* that role, so production privileges are
what the tests exercise.

## Test files

* **Unit** (`tests/unit`): `money`, `rng`, `stats`, `crypto`, `client-ip`, `env`
  (production config fails closed), `seed-plan` (seed safety), `roulette`, `dice`, `mines`,
  `crash` (incl. expiry capability), `blackjack` (rules, strategy, estimates vs rules),
  `step-invariants` (property tests for interactive games), `verify`, `content`
  (published figures derived exactly), `admin-guards`, `contrast`, `risk-model`.
* **Integration** (`tests/integration`): `ledger-invariants`, `rounds`, `interactive`,
  `blackjack`, `expiry`, `reconciliation-faults`, `schema-and-reconciliation`,
  `privileges`, `auth`, `password-recovery`, `responsible`, `responsible-hardening`,
  `fairness`, `admin`, `api`, `audit-regressions`.
* **Statistical** (`tests/statistical`): `roulette-dice`, `mines`, `crash`, `blackjack`.
* **E2E** (`tests/e2e`): `player-journey`, `blackjack`, `security`, `resilience-access`
  (interrupted request recovery, admin API authorisation, honest states),
  `fairness-admin`, `accessibility`, `mobile`.

## Regression tests for defects fixed in the production-readiness pass

Each was confirmed to **fail on the previous code** before the fix was kept.

| Defect | Test |
|---|---|
| Non-expiring rounds starve Crash expiry | `expiry.test.ts` (old query: 0 rounds settled) |
| Void refund amount never verified | `reconciliation-faults.test.ts` (short/over/misdirected/duplicate/missing) |
| Oversized stake → HTTP 500 | `audit-regressions.test.ts`, `money.test.ts` |
| Crash cash-out priced after lock wait | `audit-regressions.test.ts` (old code paid 1.09× instead of ≈1.00×) |
| Parallel password guesses bypass lockout | `password-recovery.test.ts` (old code checked 24 of 24) |
| Session flag allowed direct balance edits | `privileges.test.ts` |
| Later limit loosening inherited an earlier time | `responsible-hardening.test.ts` |
| Voided rounds counted towards limits | `responsible-hardening.test.ts` |
| Daily chips during cool-off / self-exclusion | `responsible-hardening.test.ts` |
| Flaky 24-hour loss-limit test (1 % failure rate) | `responsible.test.ts` (deterministic seed oracle) |
| Append-only test depended on file order | `ledger-invariants.test.ts` |

## Results of the final run (2026-10-26, this repository's environment)

Clean `npm ci` (Node 22.22, npm 10.9), PostgreSQL 16.15:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 problems) |
| `npm run test:unit` | **151 passed** (18 files) |
| `npm run check:docs` | pass |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| `npm run test:integration` | **124 passed** (16 files, 35 s) |
| `npm run test:stats` | **18 passed** (4 files, 62 s) |
| `npm run build` (no `.env` present, as in CI) | pass; no `.env` in the artifact |
| `npm run check:bundle` | pass (103 files, no server secrets) |
| `npm run test:e2e` | **19 passed** (chromium desktop + Pixel 7 mobile, 48 s) |
| Docker images + `docker compose up` (generated secrets) | runner and tools images build; readiness 200 with `database_role` ok (app connects as `casino_app`); migrations ran as `casino_migrator`; no `.env` in the image; app runs as uid 1000 (`node`); only the proxy port is published |

Baseline before this pass, for comparison: unit 107, integration 71 of 72 (the flaky
loss-limit test failed), statistical 18, e2e 9.

**Not run here:** the GitHub Actions workflows themselves (no runner in this
environment; the same commands were run locally in the same order), a real SMTP provider
(an in-test SMTP server was used), real TLS certificates (configs validated with
`nginx -t` and a throwaway self-signed certificate), and the 2M-round extended
simulations (shorter runs of the same scripts were executed).
