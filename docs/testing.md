# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Unit | `npm run test:unit` | nothing | engine maths, RNG, money bounds, verifier, content-vs-engine, config/seed safety, admin guards, contrast, risk model |
| Integration | `npm run test:integration` | PostgreSQL (`DATABASE_URL_TEST`, name must end in `_test`; wiped each run) | ledger invariants, rounds and concurrency, Crash cash-out vs settlement ordering under real row locks, expiry queue, reconciliation (incl. fault injection), account-state races, least-privilege role, auth, sessions, rate limits and password recovery (SMTP), responsible play, admin, API routes |
| Statistical | `npm run test:stats` | nothing | fixed-seed chi-square and RTP confidence-interval tests for every game (≈1 min) |
| End-to-end | `npm run build && npm run test:e2e` | PostgreSQL (`DATABASE_URL_E2E`, name must contain `e2e`; reset each run), Chromium | Playwright against the **production standalone build**, desktop and mobile |
| Docs | `npm run check:docs` | nothing | relative Markdown links resolve |
| Bundle | `npm run check:bundle` (after build) | nothing | no server secret names/values and no source maps in `.next/static` |
| Secrets | `npm run check:secrets` | git checkout | credential patterns, tracked `.env`/keys/dumps (reported without values) |
| Workflows | `npm run check:workflows` | nothing (`DEFAULT_BRANCH` in CI) | pinned actions, permissions, timeouts, no `pull_request_target`/secrets/`continue-on-error`, default branch triggers CI |
| Restore drill | `npm run ops:restore-check` | PostgreSQL + a role with CREATEDB | backup → restore into a disposable database → migrate → counts, triggers, reconciliation |
| Extended | `.github/workflows/extended.yml` | nothing | seeded 2M-round Monte Carlo per exact-game scenario against independently derived RTPs (fails beyond 4σ), blackjack estimate re-check, risk model self-consistency ([ci.md](ci.md)) |

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
  (published figures derived exactly), `admin-guards`, `contrast`, `risk-model`,
  `action-timing` (cash-out ordering rule), `independent-rtp` (engine theory vs published
  rules), `safe-next` (post-login redirect).
* **Integration** (`tests/integration`): `ledger-invariants`, `rounds`, `interactive`,
  `blackjack`, `expiry`, `reconciliation-faults`, `schema-and-reconciliation`,
  `privileges`, `auth`, `password-recovery`, `responsible`, `responsible-hardening`,
  `fairness`, `admin`, `api`, `audit-regressions`, `crash-ordering` (13 required
  cash-out/settlement scenarios incl. both lock orders), `financial-integrity`
  (account-state races, void vs payout, bonus claims, cross-user access),
  `auth-hardening` (route-level rate limits, sessions, reset-link invalidation).
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
| Password-reset response waited for the token write (existing accounts only) | `password-recovery.test.ts` (old code still blocked after 3 s) |
| Concurrent reset requests left two usable links | `password-recovery.test.ts` (old code: 2 of 3 links usable) |

Also covered since: the `/api/metrics` policy (optional; unset, empty or blank token
disables it and every request gets 403; a token that is set must be ≥ 24 header-safe
characters in production) in `env.test.ts` and `api.test.ts`; and the wager rate-limit
test, which failed when its burst straddled a 10-second window boundary (a few percent of
runs), now sends 2 × limit + 1 requests so one window always overflows.

## Regression tests for defects fixed in the hardening pass

| Defect | Test | Confirmed on the old code |
|---|---|---|
| A time-based settlement started after the crash could take the locks first and bust a cash-out received before it | `crash-ordering.test.ts` (3a, both lock orders) | yes: a settlement started 200 ms after the crash settled the round and the in-time cash-out was refused |
| The cash-out receipt time was taken only after session lookup and rate limiting | `crash-ordering.test.ts` (HTTP) | yes: a 1.5 s rate-limiter delay priced the cash-out at 1.09× instead of ≤ 1.00× |
| Account deletion did not serialise with a wager waiting on the wallet (orphaned open round on a deleted account) | `financial-integrity.test.ts` | yes: the account was deleted while its new round stayed OPEN |
| Wagers and actions did not re-check the account status after the session check | `financial-integrity.test.ts` | yes: a wager and an action were accepted after the suspension or deletion had committed |
| Changing the password left outstanding reset links usable | `auth-hardening.test.ts` | yes: the link still worked after the change |
| Post-login open redirect: `/\evil.example` and `/<tab>/evil.example` passed the guard | `safe-next.test.ts`, `security.spec.ts` (e2e) | shown with the WHATWG URL parser: the old guard kept all three payloads, which resolve to another origin |
| Production accepted a weak password-hashing cost (`SCRYPT_LOG_N` < 17) | `env.test.ts` | new rule (the server now exits 1; verified against the standalone build) |
| Self-review, never committed: the first version of the ordering clock parsed PostgreSQL's text timestamp, which is `Invalid Date` under a non-ISO DateStyle, so the deadline would never have been reached | `crash-ordering.test.ts` (clock under three DateStyles) | yes: `SQL, DMY` and `German` output parse to `Invalid Date` |

Hardening without a prior failure:
* Metrics are blocked at the edge proxy, and the malformed-credential cases are tested.
* Rate limits on manual reconciliation runs and on analytics.
* The bundle check now rejects published source maps.
* CI actions are pinned to SHAs, and the workflow policy is enforced.
* The extended simulations are seeded, use independently derived expectations, and record
  their provenance.
* The backup and restore scripts are tested by the restore drill.
* New `casino_rate_limited_total` and `casino_login_failures_total` metrics.

## Results of the final run (2026-10-26, this repository's environment)

Clean `npm ci` (Node 22.22.0, npm 10.9.4), PostgreSQL 16.15. These runs used the working
tree that became the commit following `fa68f7f`.

| Command | Result |
|---|---|
| `npm ci` | pass, 0 vulnerabilities |
| `DEFAULT_BRANCH=ccr-c301db4d-y6lhy2 npm run check:workflows` | pass (2 workflows) |
| `npm run check:secrets` | pass (327 tracked files) |
| `npm run typecheck` / `npm run lint` | pass / 0 problems |
| `npm run test:unit` | **186 passed** (21 files) |
| `npm run test:integration` | **164 passed** (19 files, 37 s); the Crash ordering race scenarios also passed 7 consecutive runs |
| `npm run ops:restore-check` (on the integration database) | pass: counts and 16 triggers identical, reconciliation OK (17 checks, 0 mismatches), copy dropped. Negative control (one ledger entry altered) failed with exit 1 |
| `npm run test:stats` | **18 passed** (4 files, 51 s) |
| `npm run build` (no `.env` present, as in CI) | pass; no `.env` in the artifact |
| `npm run check:bundle` | pass (103 files, no server secrets, no source maps) |
| `npm run test:e2e` | **20 passed** (chromium desktop + Pixel 7 mobile, 1.1 min) |
| `npm run check:docs` / `npm audit --audit-level=moderate` | pass / 0 vulnerabilities |
| Extended verification, full size, run locally (same commands as `extended.yml`, seed `local-final-2026-10-26`) | **pass** in 874 s. 17 exact-game scenarios × 2,000,000 rounds: max \|z\| 0.64 (roulette), 2.11 (dice), 1.22 (mines), 1.17 (crash). Blackjack: 4,000,000 hands, edge 0.476 % vs published 0.419 %, z = 0.93. Risk model `--check`: 2,000 paths, P&L z = 0.27, largest payout 116,763 chips ≤ 1,000,000 cap. Negative control: a +0.5 % Dice payout bias failed with \|z\| up to 48 and exit 1 |
| Standalone server, `NODE_ENV=production` | `METRICS_TOKEN` unset or empty: starts and refuses every metrics request (403). A 19-character token or `SCRYPT_LOG_N=12`: exits with status 1 and the `Unsafe production configuration` message |
| `deploy/nginx*.conf` with nginx 1.24 | `nginx -t` passes. The TLS config needed `http2 on;` rewritten to the listen form for 1.24; Compose uses 1.27. Live proxy in front of the standalone build: `/api/metrics`, `/api/metrics/`, `/api/%6detrics` and `/api//metrics` return 404 at the edge, `/api/health` returns 200 |
| `npm run ops:backup` with a throwaway GPG key | encrypted mode-0600 dump plus checksum; it decrypts and lists |

**Not run here:**
* `npm audit signatures`: this sandbox blocks the Sigstore trust-root download. It runs in CI.
* GitHub secret scanning: the API answered "Advanced Security not enabled".
* Docker Compose: the Docker daemon is not available in this session. Compose was
  exercised in the previous pass, and no Compose file changed.
* `actionlint`: not downloadable here. The workflow policy check ran, and the YAML parses.
* A real SMTP provider and real TLS certificates.

The GitHub Actions results for this commit are linked from the final report.
