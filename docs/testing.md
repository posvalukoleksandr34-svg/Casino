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
  rules), `safe-next` (post-login redirect), `limbo`, `keno`, `plinko`, `hilo` (tables,
  exact RTP, strategy bound, hidden card sequence), `catalog` (categories, "new" window,
  limits), `sports` (price model and its RTP bound, committed demo results, settlement
  and correction maths, provider payload mapping, rate-limit and error sanitising),
  `owner-admin` (permission matrix, rank rules, e-mail masking, TOTP against the RFC 6238
  vectors, reporting periods, prediction windows), `account-policy` (Unicode names, strict
  calendar dates, 18+ by calendar date incl. 29 February, code pasting, shared password
  policy; static guards: no page reads the raw session, the onboarding allow-list of API
  routes is exactly the expected one).
* **Integration** (`tests/integration`): `ledger-invariants`, `rounds`, `interactive`,
  `blackjack`, `expiry`, `reconciliation-faults`, `schema-and-reconciliation`,
  `privileges`, `auth`, `password-recovery`, `responsible`, `responsible-hardening`,
  `fairness`, `admin`, `api`, `audit-regressions`, `crash-ordering` (13 required
  cash-out/settlement scenarios incl. both lock orders), `financial-integrity`
  (account-state races, void vs payout, bonus claims, cross-user access),
  `auth-hardening` (route-level rate limits, sessions, reset-link invalidation),
  `new-games` (Limbo, Keno, Plinko, Hi-Lo through the round service and HTTP, incl.
  verifier replay), `lobby` (favourites, recently played), `profile-achievements`
  (profile validation and audit, idempotent server-awarded badges, server-side round
  verification), `sports` (placement, idempotency, stale/changed odds, limits, settlement,
  void refunded once, credit-only corrections, reconciliation and a ledger tamper test),
  `owner-admin` (API authorisation for anonymous/player/moderator/admin incl. denied-access
  events, malformed input, role escalation via registration, rank rules, last-owner
  protection incl. concurrent demotion and the database trigger, owner provisioning,
  suspension enforcement across sign-in/sessions/rounds/predictions/bonus, user search and
  masking, chip grants: replay, key reuse, invalid amounts, balance cap, concurrency,
  rollback, reconciliation of an unaudited grant; game limit bounds and engine
  enforcement, maintenance with open rounds, client-supplied outcomes refused; sports
  prediction window, settlement preview vs actual credit, duplicate settlement, demo
  fixtures; MFA enrolment, two-step sign-in, replay, recovery codes, staff policy;
  dashboard metrics), `registration` (pending accounts without session/wallet/chips, the
  HTTP response and cookie, server-side validation incl. smuggled role/verification
  fields, duplicate username/e-mail, stale-registration reclaim, registration refused
  without an e-mail transport, delivery failure and resend, wrong-code counting and
  lock-out, malformed codes, expiry, cooldown and hourly cap, superseded and consumed
  codes, six concurrent correct submissions → one activation, signed flow cookie
  tamper/expiry, address correction, unverified sign-in, onboarding validation and 18+,
  phone normalisation, **every API route called with a pending session** → 403,
  grandfathered and operator accounts, e-mail change, export and deletion of the new
  fields, no codes or personal data in audit records or process output),
  `migration-0009` (a scratch database at 0008 with an existing account, then 0009:
  nothing lost or invented, legacy flags, new-row defaults, constraints). Every test
  player is created through the real journey (register → code from the in-memory capture
  mailer → verify → onboarding) by `newPlayer`.
* **Statistical** (`tests/statistical`): `roulette-dice`, `mines`, `crash`, `blackjack`,
  `new-games`.
* **E2E** (`tests/e2e`): `player-journey`, `blackjack`, `security`, `resilience-access`
  (interrupted request recovery, admin API authorisation, honest states),
  `fairness-admin`, `accessibility`, `mobile`, `expansion` (lobby search and favourites,
  one round of each new game, profile save, a demo sports prediction), `owner-admin`
  (owner dashboard, user search, chip grant, suspension and its effect on the player's
  session, audit log and ledger; moderator limits incl. 404/403; admin pages on a phone
  with labelled controls), `registration` (register → code read from the SMTP sink →
  wrong code → verify → every page and API closed until the profile is done → profile →
  lobby → dice round → balance, transactions, history and profile; unverified sign-in;
  address correction; server-side under-age refusal). The e2e server sends real SMTP to
  a loopback sink started by `global-setup.ts` (messages saved as JSON for the specs);
  `registerPlayer` takes every e2e player through the full journey, and
  `resilience-access` now exercises a real password reset through it.

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

## Results of the owner-administration run (2026-10-27, this repository's environment)

Migrations 0007 and 0008 applied to the development, test and e2e databases.

| Command | Result |
|---|---|
| `npm run typecheck` / `npm run lint` | pass / 0 problems |
| `npm run test:unit` | **257 passed** (28 files) |
| `npm run test:integration` | **219 passed** (24 files); the full suite also passed twice more in a row after the sports tests were given their own fixtures (see below) |
| `npm run test:stats` | **24 passed** (5 files) |
| `npm run build` / `npm run check:bundle` | pass / 140 files, no server secrets |
| `npm run test:e2e` | **27 passed** (chromium desktop + Pixel 7 mobile, 2.0 min) |
| `npm run check:docs` / `check:secrets` / `check:workflows` | 46 links OK / 438 tracked files, no findings / 2 workflows OK |
| `npm audit` | 0 vulnerabilities |
| `npm run ops:restore-check` (development database) | pass: counts identical, 25 triggers identical (incl. `users_keep_an_owner`), reconciliation OK (22 checks, 0 mismatches) |
| `npm run admin:provision-owner` (development database) | refused without `--break-glass` while an owner existed; promoted with it; audited |

**Defects found and fixed in this pass:**
* `/admin/users` failed on every request: the balance subquery compared `uuid` to
  `bigint` (a correlated column rendered unqualified bound to the inner table). Now
  covered by the owner e2e test and the user-search integration test.
* The published rules are generated from each game's reference configuration, but an
  administrator could activate a different configuration (e.g. another house edge),
  making the rules and payout tables shown to players wrong. Only the reference
  configuration is accepted now (`admin.test.ts`).
* A constant exported from a client component was imported by a server page and rendered
  as nothing (empty status badge); a `loading.tsx` boundary made staff-only pages answer
  200 instead of 404 for staff without the permission. Both caught by e2e and fixed.
* The first version of the new sports tests shared demo events with `sports.test.ts` and
  failed depending on file order; each now uses its own fixture.

**GitHub Actions.** CI runs 27, 30 and 31 failed in the end-to-end job only. Run 27's
game-suspension test still used the old games page layout. In runs 30 and 31, the owner
workflow checked a suspension's effect before the change had committed (the reason text it
waited for was already visible in the dialog). After fixing both tests, CI run 32
(commit `a6ad8ae`) passed all five jobs. Extended verification run 2 (seed
`github-d4e6fd9`, 2,000,000 rounds per scenario, including Limbo, Keno, Plinko and
Hi-Lo) passed in 12 minutes.

## Results of the expansion run (2026-10-27, this repository's environment)

New games, lobby, profile and achievements, and the sports simulator (migrations 0005 and
0006). Node 22, PostgreSQL 16, on the working tree committed after `18a7afb`.

| Command | Result |
|---|---|
| `npm run typecheck` / `npm run lint` | pass / 0 problems |
| `npm run test:unit` | **246 passed** (27 files) |
| `npm run test:integration` | **196 passed** (23 files, 41 s) |
| `npm run test:stats` | **24 passed** (5 files, 82 s) |
| `npm run build` / `npm run check:bundle` | pass / 120 files, no server secrets |
| `npm run test:e2e` | **24 passed** (chromium desktop + Pixel 7 mobile, 1.3 min) |
| `npm run check:docs` / `check:secrets` / `check:workflows` | 39 links OK / 397 tracked files, no findings / 2 workflows OK |
| `npm audit` | 0 vulnerabilities |
| `npm run ops:restore-check` (on the development database, which holds sports tickets and settlements) | pass: counts identical incl. `sports_tickets`, `sports_result_log`, `sports_settlements`; 24 triggers identical; reconciliation OK (22 checks, 0 mismatches); copy dropped |

**CI defect found and fixed:** CI run 22 failed one integration test, "a payout edited
behind the ledger … is flagged". The test bet on the home side and then set the ticket to
`WON` with its full return. When the random demo result was a home win, that update changed
nothing, so no check could fire. Locally the old test failed 3 of 6 runs. The tamper now
always flips the settled outcome and asserts that a row changed; it then passed 8 of 8 runs.
The reconciliation checks themselves were not at fault.

**Not run in this pass:** the negative control of the restore drill (unchanged script logic
apart from the table list), a clean `npm ci`, Docker Compose (no daemon here), the
extended 2M-round simulations locally (the new games' scenarios run in `extended.yml`), and
the sports live mode against the real providers (no network access to them here; see
[sports.md](sports.md#live-providers)).

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

**GitHub Actions.** On the first push of this pass (CI run 2), everything passed except the
new restore drill: typecheck, lint, unit tests, `npm audit signatures`, the workflow-policy
and secret-scan steps, integration, statistical, build, bundle and e2e. The drill failed
because the runner's newer `pg_dump` wrote a PostgreSQL 17 setting into the archive. The
ops scripts now require version-matched client tools. The next run showed that
`ubuntu-latest` is Ubuntu 26.04, which has no `postgresql-client-16`, so the integration job
is pinned to `ubuntu-24.04`. On commit `19d8fe5`, CI run 40400081898 passed **all five
jobs**, including the restore drill on `ubuntu-24.04` and `npm audit signatures`.

Extended verification on GitHub (`workflow_dispatch`, run 40398789589, commit `cc61d0b`,
seed `github-cc61d0b`, 2,000,000 rounds per scenario) passed in 8.5 min. The risk model
gave P&L z = 0.18, the largest payout was 120,965 chips (within the cap), and the six
reports were uploaded as `simulation-reports`. Later commits did not touch simulation code.
