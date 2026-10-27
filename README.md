# Aurovane

A casino website played with **non-redeemable virtual chips**: European Roulette, Dice,
Mines, Crash, Blackjack, Limbo, Keno, Plinko and Hi-Lo, plus a football **prediction
simulator** (pre-match 1X2, demo fixtures by default). Outcomes are decided on the server
from provably fair seeds, every chip movement is recorded in an append-only double-entry
ledger, and every game publishes its rules, payouts and house edge.

> **Virtual currency only.** Chips have no monetary value. They cannot be bought, sold,
> transferred, withdrawn or exchanged for anything. There are no deposits, payments,
> crypto, prizes or cash-outs, and this repository contains no code for any of them.
> Players must confirm they are 18+. Nothing here is a licensed gambling product, and the
> repository makes no claim of legal compliance in any jurisdiction
> ([compliance checklist](docs/compliance-checklist.md)).

## What is in the box

* **Games** with documented, tested mathematics ([docs/math](docs/math/)): Roulette
  (97.30 % RTP, exact), Dice, Mines, Crash, Limbo and Plinko (99 %, exact), Keno (98.98–99 %
  by number of picks, exact), Hi-Lo (≤ 99 % for every strategy, exact), Blackjack (house
  edge ≈ 0.42 % under basic strategy — a **simulation estimate** with a 95 % CI, labelled
  as such).
* **Lobby**: search, categories, favourites, recently played, "new" badges and a details
  view for each game; every card opens a playable game.
* **Profile**: preset avatars, display name, balance, rounds, wins/losses/pushes, staked,
  returned and net per game (turnover is never shown as profit), recent activity,
  favourites, cosmetic achievements (awarded only by the server, never for losses or
  volume), and a server-side re-check of any settled round.
* **Sports prediction simulator** (virtual chips): fixtures, 1X2 prices, a bet slip with
  potential return and confirmation, open/settled predictions, stats and followed teams.
  **Demo mode** (default, no credentials) uses fictional teams, a published 6 %-margin house
  model and results drawn from committed seeds; optional **live mode** reads
  football-data.org and The Odds API with server-side keys — [docs/sports.md](docs/sports.md).
* **Provably fair RNG** (HMAC-SHA256, committed seeds, in-browser verifier) — [docs/fairness.md](docs/fairness.md).
* **Ledger and wallet**: integer minor units, append-only tables, database-enforced
  invariants, 22-check independent reconciliation (casino and sports) — [docs/database.md](docs/database.md).
* **Risk engine**: decides from the worst case *before* randomness is used; never sees the
  player's identity or history — [docs/risk.md](docs/risk.md).
* **Responsible play**: loss/wager/session limits, cool-off, self-exclusion, delayed
  loosening, reality checks — enforced server-side — [docs/responsible-play.md](docs/responsible-play.md).
* **Back office**: RBAC (support, risk manager, auditor, admin), audited actions with
  reasons, analytics (theoretical vs realised), alerts, reconciliation, health.
* **Operations**: least-privilege database roles, health/readiness/metrics endpoints,
  background jobs under advisory locks, Docker Compose deployment —
  [docs/operations.md](docs/operations.md).

Architecture: [docs/architecture.md](docs/architecture.md) · API: [docs/api.md](docs/api.md) · CI: [docs/ci.md](docs/ci.md) ·
Threat model: [docs/threat-model.md](docs/threat-model.md) · Testing: [docs/testing.md](docs/testing.md) ·
Dependencies: [docs/dependency-security.md](docs/dependency-security.md) ·
Product spec: [docs/product-spec.md](docs/product-spec.md) · Sports: [docs/sports.md](docs/sports.md) ·
Market research: [docs/research.md](docs/research.md).

## Technology

Next.js 15 (App Router, standalone output) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
PostgreSQL 16 · Drizzle ORM · Zod · nodemailer (SMTP) · Vitest · Playwright · Docker.

## Prerequisites

* Node.js 22 (`node -v`) and npm 10
* PostgreSQL 16 (local install or a container)
* For end-to-end tests: Chromium for Playwright (`npx playwright install chromium`)
* For the Compose deployment: Docker with Compose v2

## Local development

```bash
npm ci
cp .env.example .env        # then edit .env (see below)
```

**Databases.** As a PostgreSQL superuser, create a development user and three databases,
plus the least-privilege role the tests use:

```sql
CREATE ROLE casino LOGIN PASSWORD 'casino';            -- local development only
CREATE DATABASE casino_dev  OWNER casino;
CREATE DATABASE casino_test OWNER casino;              -- wiped by every integration run
CREATE DATABASE casino_e2e  OWNER casino;              -- wiped by every e2e run
CREATE ROLE casino_app NOLOGIN;                        -- runtime role (see docs/operations.md)
GRANT casino_app TO casino;
```

**Secrets for `.env`** (development still works without the first two — it falls back to
a fixed development key, which production refuses):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SEED_ENCRYPTION_KEY
openssl rand -hex 32                                                         # IP_HASH_SECRET
```

Set `MAIL_TRANSPORT=console` locally if you want password-reset links printed in the
server console.

**Sports.** `SPORTS_MODE=demo` (the default) needs nothing else: the background job
creates fictional fixtures every 20 minutes for the next 24 hours and settles them ten
minutes after kick-off. `SPORTS_MODE=off` hides the section. `SPORTS_MODE=live` needs
`FOOTBALL_DATA_API_KEY` and `THE_ODDS_API_KEY` (plus the competition, sport and region
lists in `.env.example`); without both keys the section shows that it is unavailable and
production refuses to start. Keys are read only on the server. Live mode has not been run
against the real providers ([docs/sports.md](docs/sports.md#live-providers)).

**Schema, reference data and demo accounts** (migrations are forward-only SQL files in
`migrations/`, applied in order and checksummed; `0005` adds favourites, profile fields and
achievements, `0006` the sports tables):

```bash
npm run db:migrate          # migrations + reference data (games, limits, house bankroll)
npm run db:seed             # local only: one account per staff role + a demo player
npm run dev                 # http://localhost:3000
```

`db:seed` refuses production, non-local URLs and remote databases. It has no built-in
passwords: set `SEED_<ROLE>_PASSWORD` variables, or it generates random passwords and
prints them once.

## Tests

```bash
npm run typecheck && npm run lint
npm run test:unit
npm run test:integration    # needs DATABASE_URL_TEST (…/casino_test)
npm run test:stats          # ~1 minute
npm run build && npm run check:bundle && npm run test:e2e   # e2e needs DATABASE_URL_E2E (…/casino_e2e) or the default
npm run check:docs && npm run check:secrets && npm run check:workflows
DATABASE_URL=… RESTORE_ADMIN_URL=…/postgres npm run ops:restore-check   # backup → restore → reconcile drill
```

Results of the latest full run and what each suite covers: [docs/testing.md](docs/testing.md).
CI (`.github/workflows/ci.yml`) runs all of these on every pull request and every push to
the default branch (`ccr-c301db4d-y6lhy2`), with disposable PostgreSQL services, pinned
actions and least-privilege tokens; `extended.yml` runs large seeded simulations weekly.
Policy and procedures: [docs/ci.md](docs/ci.md).

Simulations (results are **simulated** and never mixed with live data):

```bash
npm run sim:game -- dice --rounds 1000000            # exact games: realised vs analytical RTP
npm run sim:game -- blackjack --rules 6-S17-3:2-DAS --hands 4000000 --check
npm run sim:risk -- --paths 1000                     # bankroll / reserve model (docs/risk.md)
```

## Production build, locally

```bash
npm run build               # .next/standalone (no .env is copied into the artifact)
npm start                   # loads ./.env if present, then serves on PORT (default 3000)
```

With `NODE_ENV=production` (set by the build) the server **refuses to start** on an
unsafe configuration: missing or weak `SEED_ENCRYPTION_KEY`/`IP_HASH_SECRET`, a
`METRICS_TOKEN` that is set but short or not header-safe, implicit or non-HTTPS public
`APP_URL`, default database passwords, `SCRYPT_LOG_N` below 17, or `MAIL_TRANSPORT=console`, or `SPORTS_MODE=live` without both provider keys. `METRICS_TOKEN` itself
is optional: left empty, `/api/metrics` is disabled and refuses every request (there is no
unauthenticated mode). Readiness additionally fails if the database role is a
superuser or the schema owner.

## Docker deployment

```bash
cp .env.example .env
# fill in: APP_URL, SEED_ENCRYPTION_KEY, IP_HASH_SECRET,
#          POSTGRES_SUPERUSER_PASSWORD, DB_MIGRATOR_PASSWORD, DB_APP_PASSWORD
docker compose up -d --build
curl -s localhost:3000/api/health/ready
```

Compose starts PostgreSQL (no published port), creates separate migration-owner and
least-privilege app roles, runs migrations once, starts the app as a non-root user, and
puts nginx in front as the only published port. Every secret is required; nothing falls
back to a default. Behind a TLS-intercepting proxy, build the images with
`docker build --secret id=extra_ca,src=<ca.crt> …` (see the `Dockerfile`).

TLS, backups, secret rotation, monitoring, incident response and e-mail:
[docs/operations.md](docs/operations.md).

## Production security requirements

1. Terminate TLS at the edge with a real certificate; `APP_URL=https://…`
   (`deploy/nginx-tls.conf` is a validated template). The repository ships no certificate.
2. Exactly one trusted proxy must overwrite `X-Forwarded-For`; `TRUST_PROXY_HOPS` must
   match the number of such proxies.
3. Run the app as the least-privilege `casino_app` role; migrations as `casino_migrator`.
4. Keep secrets in a secret manager; never commit `.env`.
5. Configure an SMTP provider for password recovery, or staff a support path (without one
   the site states that recovery is unavailable).
6. Ship logs and metrics; alert on readiness, reconciliation mismatches, expiry and mail
   failures. Metric-based alerts need `METRICS_TOKEN` set (metrics are disabled without it).
7. Off-site backups with a tested restore (procedure in `docs/operations.md` §6).

## Status

Implemented and tested: everything listed under "What is in the box". The
production-readiness pass (expiry queue, reconciliation, game/money audit, dependency
review, deployment hardening, password recovery, CI, responsible-play and accessibility
fixes) is summarised in [docs/testing.md](docs/testing.md) with the regression test for
each defect.

### Must be resolved before a public launch (operator, external)

* Domain, DNS and TLS certificate at the edge.
* Secret manager, off-site backups with a restore drill, log/metric shipping and alerting.
* An SMTP provider for password recovery (or an explicit support process).
* Legal review for each target jurisdiction: terms, privacy notice, age gating,
  virtual-currency rules (`docs/compliance-checklist.md`).
* An external penetration test.

### Known limitations / optional enhancements

* Sports: singles only (no accumulators), one market (1X2), football only; live mode is
  untested against the real providers and trusts one results source (corrections are
  credit-only, so a provider error cannot take chips back from players).
* Not implemented yet (planned): Baccarat, slots, further sports markets.
* Achievements are cosmetic badges only; there are no rewards of any kind.

* No e-mail address verification and no TOTP 2FA (recommended for staff accounts).
* CSP still allows `'unsafe-inline'` scripts (Next.js bootstrap); a nonce-based CSP is a
  planned hardening step.
* Next.js 15.5 is in backport-only maintenance; plan the 16.x upgrade.
* Session time limits are per login session; exclusions are per account (no shared
  register).
* Blackjack's house edge is an estimate (exact for the 16 rule sets only to within their
  confidence intervals).
* Single hot rows (house bankroll, wagers-in-play) bound wager throughput at roughly
  70–90 wagers/s on one PostgreSQL instance; sharded system accounts are the scaling path.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server exits at start with `Unsafe production configuration: …` | The message lists every problem; fix the variables (no values are printed). |
| `/api/health/ready` returns 503 with `database_role` failing | The app connects as a superuser or the schema owner; use `casino_app`. |
| Integration/e2e setup asks for `casino_app` | Run the two SQL statements it prints once as a superuser. |
| `refusing to reset non-test database` | `DATABASE_URL_TEST` must end in `_test` (e2e: contain `e2e`). |
| `migration … was modified after being applied` | An applied migration file was edited; restore it and add a new migration instead. |
| `db:seed` refuses to run | It only seeds local development databases; create production staff accounts deliberately (`docs/operations.md` §10). |
| Everyone gets "Too many requests" on login/registration | The app cannot see client IPs: put the proxy in front and set `TRUST_PROXY_HOPS`. |
| Forgot-password page says recovery is unavailable | No mail provider is configured (`MAIL_TRANSPORT=disabled`); see `docs/operations.md` §9. |
| `npm ci` fails with `SELF_SIGNED_CERT_IN_CHAIN` in Docker | Pass your proxy CA as the `extra_ca` build secret. |
| A Crash round never settles | Check `/admin/health` and `error_events`; the expiry job retries with backoff and reconciliation flags rounds overdue by 5 minutes. |
