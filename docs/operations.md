# Operations guide

How to run Aurovane in production and what the operator must provide. Everything below
was exercised in this repository's environment unless marked **(external)** — those parts
depend on infrastructure this repository cannot provide (a domain, certificates, a mail
provider, a secret manager, off-site storage).

Aurovane uses **non-redeemable virtual chips only**. There are no deposits, withdrawals,
purchases or cash-outs, and nothing in this guide changes that.

## 1. Topology

```
Internet ──TLS──▶ reverse proxy (nginx: deploy/nginx-tls.conf, or a TLS load balancer
                   in front of deploy/nginx.conf)
                    │  overwrites X-Forwarded-For with the TCP peer
                    ▼
                 app (Next.js standalone, non-root, TRUST_PROXY_HOPS=1, port 3000 not published)
                    │  role casino_app (least privilege)
                    ▼
                 PostgreSQL 16 (no published port; owner role casino_migrator)
```

`docker-compose.yml` implements this for a single host: `db`, a one-shot `migrate`,
`app`, and `proxy` (the only published port). It was brought up end to end in this
environment with generated secrets: migrations ran as `casino_migrator`, the app reported
ready with `database_role: least privilege`, and registration and wagers worked through
the proxy.

## 2. Secrets and configuration

All configuration is environment variables (`.env.example` documents each one).
Production refuses to start with missing, short or default values (`src/server/env.ts`,
`productionProblems`, unit-tested):

| Variable | Requirement in production |
|---|---|
| `APP_URL` | set explicitly; `https://` unless the host is loopback |
| `DATABASE_URL` | least-privilege role; non-default password ≥ 16 chars for a non-local host |
| `SEED_ENCRYPTION_KEY` | 32 bytes (base64 or 64 hex) |
| `IP_HASH_SECRET` | ≥ 32 characters |
| `SCRYPT_LOG_N` | ≥ 17 (password hashing cost; lower values are for tests only) |
| `METRICS_TOKEN` | optional (see §7); when set, ≥ 24 characters of `[A-Za-z0-9._~+/=-]` |
| `MAIL_TRANSPORT` | `smtp` (with `SMTP_URL`, `MAIL_FROM`) or `disabled`; `console` is refused |
| `SPORTS_MODE` | `demo` (default), `off`, or `live`; `live` is refused unless both `FOOTBALL_DATA_API_KEY` and `THE_ODDS_API_KEY` are set |

**Sports providers** (only with `SPORTS_MODE=live`; see [sports.md](sports.md)):
`FOOTBALL_DATA_API_KEY` and `FOOTBALL_DATA_COMPETITIONS` (comma-separated competition codes),
`THE_ODDS_API_KEY`, `THE_ODDS_API_SPORTS` (sport keys), `THE_ODDS_API_REGIONS`,
`THE_ODDS_API_BOOKMAKER` (optional), `SPORTS_SYNC_MINUTES` (provider refresh interval) and
`SPORTS_ODDS_MAX_AGE_MINUTES` (older prices refuse predictions). The keys stay server-side:
they are read only by `src/server/sports/providers`, never logged (errors carry the URL path
only) and never sent to the browser. The providers' terms, quotas and costs are the
operator's responsibility; the adapters have **not** been run against the real services.

Generate values locally, never in a shared terminal log:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SEED_ENCRYPTION_KEY
openssl rand -hex 32                                                         # IP_HASH_SECRET, METRICS_TOKEN
openssl rand -hex 24                                                         # database passwords (URL-safe)
```

**(external)** Store them in a secret manager (AWS Secrets Manager, GCP Secret Manager,
Vault, Doppler, 1Password Connect, Kubernetes secrets with encryption at rest…) and inject
them as environment variables. `.env` files are for local use only and are gitignored.
`scripts/check-client-bundle.mjs` (CI) fails the build if a server secret appears in a
browser bundle; the logger redacts keys matching password/token/secret/cookie/seed.

### Secret rotation

| Secret | Procedure | Impact |
|---|---|---|
| `SEED_ENCRYPTION_KEY` | Put the new key in `SEED_ENCRYPTION_KEY`, the old one in `SEED_ENCRYPTION_KEYS_PREVIOUS`, redeploy. New seeds use the new key; old ciphertexts carry a key id and still decrypt. Remove the old key once every pair encrypted with it has been revealed (players rotate seeds; old pairs are revealed on rotation). | none |
| `IP_HASH_SECRET` | Replace and redeploy. | audit IP hashes before/after no longer correlate |
| `METRICS_TOKEN` | Replace in the app and in the scraper. Setting it empty disables `/api/metrics`. | scrape gap |
| DB passwords | `ALTER ROLE casino_app PASSWORD '…'` (as an admin), update the secret, rolling restart. Same for `casino_migrator`. | brief reconnects |
| SMTP credentials | Update `SMTP_URL`, restart. | none |

## 3. TLS and domain **(external)**

TLS is **not** enabled by anything in this repository until you provide a certificate.

* Point the domain's DNS at the host or load balancer.
* Either terminate TLS at a load balancer that forwards HTTP to `deploy/nginx.conf`, or use
  `deploy/nginx-tls.conf` (validated with `nginx -t`): mount `fullchain.pem` /
  `privkey.pem` at `/etc/nginx/tls/`, publish 80 and 443. It redirects HTTP to HTTPS, uses
  TLS 1.2/1.3 only, and sends HSTS (2 years).
* Set `APP_URL=https://your.domain`. The session cookie then becomes
  `__Host-aurovane_session` with `Secure; HttpOnly; SameSite=Lax`, and CSRF origin checks
  use that origin.
* HSTS from the app itself (`next.config.ts`) is evaluated at **build** time; rely on the
  TLS terminator for it.
* Exactly one trusted proxy must overwrite `X-Forwarded-For`; set `TRUST_PROXY_HOPS` to the
  number of proxies that do so (1 with the provided configs). With 0 the app ignores
  forwarded headers and all clients share one per-IP rate-limit bucket (login and
  registration stay throttled, per account as well). Never set it higher than the real
  number of proxies — clients could then spoof their address.

### Behind Cloudflare (or another CDN)

* **Lock the origin to the CDN.** Accept connections on 80/443 only from the CDN's
  published address ranges (firewall or security group), or use an authenticated tunnel
  (e.g. Cloudflare Tunnel) or authenticated origin pulls (mTLS client certificate at
  nginx). Take the ranges from the provider at deploy time (Cloudflare publishes them at
  https://www.cloudflare.com/ips/); do not copy a list into the repository, because they
  change.
* **Client addresses.** In nginx, trust the CDN's real-IP header only from those ranges:
  `set_real_ip_from <each CDN range>;` and `real_ip_header CF-Connecting-IP;`. nginx then
  sees the client address, overwrites `X-Forwarded-For` with it, and the app keeps
  `TRUST_PROXY_HOPS=1`. Do **not** raise `TRUST_PROXY_HOPS` to count the CDN instead:
  if the origin were reachable directly, clients could then forge their address.
* Use *Full (strict)* TLS between the CDN and the origin, with a certificate the origin
  trusts. Keep `APP_URL` at the public `https://` origin.
* Never cache `/api/*` or `/admin/*` at the CDN. The app sends `Cache-Control: no-store`
  on API responses and pages are dynamic; add a bypass rule anyway.
* PostgreSQL must never be published (Compose publishes no database port). The proxy
  answers 404 for `/api/metrics*`.

## 4. Database roles and permissions

| Role | Privileges | Used by |
|---|---|---|
| bootstrap superuser | everything | first-time initialisation and break-glass only |
| `casino_migrator` | owns the database and schema; `NOSUPERUSER NOCREATEROLE NOCREATEDB` | `npm run db:migrate` |
| `casino_app` | `CONNECT`, `USAGE` on schema; per-table grants from migration 0004 | the web app and jobs |

`casino_app` owns nothing, has no `TEMPORARY`/`CREATE`, cannot `TRUNCATE`, disable
triggers or alter tables, can only `SELECT, INSERT` on append-only tables (ledger, bets,
payouts, bonuses, audit) and may `DELETE` only from tables the code prunes. Account
balances change only through the ledger posting trigger, which runs with the owner's
privileges. The migration runner re-applies these grants after every run
(`casino_apply_app_grants()`), so new tables are covered automatically. Readiness
(`/api/health/ready`) fails in production if the app connects as a superuser or a role
that can act as the schema owner. `tests/integration/privileges.test.ts` runs every
application flow through this role and tries the known tampering paths.

Compose creates the roles in `deploy/postgres/init/01-roles.sh`. For a managed database,
run the equivalent once as an administrator:

```sql
CREATE ROLE casino_migrator LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE casino_app      LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE casino OWNER TO casino_migrator;
REVOKE ALL ON DATABASE casino FROM PUBLIC;
GRANT CONNECT ON DATABASE casino TO casino_app;
\c casino
ALTER SCHEMA public OWNER TO casino_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO casino_app;
```

then run migrations as `casino_migrator`. For a remote database use TLS
(`?sslmode=verify-full` with the provider's CA) in both connection strings.

## 5. Deployment, restart and migrations

```bash
docker compose up -d --build          # db → migrate (one-shot) → app → proxy
docker compose logs -f app
docker compose restart app            # safe: sessions, rounds and jobs live in PostgreSQL
```

* **Migrations are forward-only.** `migrations/NNNN_name.sql` files are applied once, in
  order, each in its own transaction, recorded with a SHA-256 checksum; an edited applied
  migration is refused. Never edit an applied file: add a new one.
* **Rollback strategy.** Code rolls back by redeploying the previous image. Schema changes
  must be backward compatible with the previous release (expand → migrate → contract over
  two releases). A migration that must be reversed is reversed by a *new* forward
  migration; restoring a backup is the last resort because it loses every round, wager and
  ledger entry since the backup.
* **Restarts and shutdown:** requests are short; open interactive rounds survive restarts
  because their state is in PostgreSQL. There is no drain hook. A stop (SIGTERM or a
  crash) interrupts in-flight transactions, and PostgreSQL rolls each one back completely:
  every wager, action and settlement commits atomically with its ledger postings and its
  idempotency record. The browser client retries with the same `Idempotency-Key`, which
  replays a committed result and never repeats one. After the restart, the expiry job
  settles any Crash round that ended while the app was down, using the round's own end
  time.
* **Connection pool:** `DB_POOL_MAX` (default 10) connections per instance, 10 s connect
  timeout, 15 s statement timeout. Keep `instances × DB_POOL_MAX` plus migration,
  backup and admin connections below PostgreSQL's `max_connections`, or put PgBouncer in
  transaction mode in front. Each wager holds one connection for its whole transaction.
  The single house-bankroll row serialises wagers (about 70–90 per second on one primary,
  see the README), so a larger pool does not raise throughput.
* **Retries:** transactions run at READ COMMITTED with explicit row locks in one global
  order: wallet → round → seed pair → house bankroll → system accounts. Serialisation
  failures and deadlocks (40001, 40P01) are retried up to 3 times with jittered backoff.
  The whole transaction is re-run, so a retry cannot apply half an effect.
* Background jobs (expiry every 5 s, reconciliation, anomaly detection, cleanup, sports
  sync every minute) run in the app process under PostgreSQL advisory locks, so several app
  instances never run the same job concurrently. Set `BACKGROUND_JOBS=false` to run them
  elsewhere (`npm run job:expire-rounds`, `npm run job:reconcile`, `npm run job:sports-sync`
  from cron).

## 6. Backups and tested restoration

**(external)** Schedule backups off-host: object storage with versioning, retention and
access limited to the backup and restore roles. A logical backup is enough at this scale.
For point-in-time recovery, use the provider's PITR / WAL archiving
(`archive_mode`, `archive_command` or a managed equivalent). PITR is not configured by
this repository, because it depends on where PostgreSQL runs.

**Backup** (`scripts/ops/backup.sh`, provider-neutral):

```bash
DATABASE_URL=<read access, e.g. casino_migrator> \
BACKUP_DIR=/var/backups/casino BACKUP_GPG_RECIPIENT=<ops public key> \
BACKUP_RETENTION_DAYS=35 npm run ops:backup
```

* Writes a custom-format `pg_dump` (no owners/privileges) with `umask 077` and checks
  that the archive is readable.
* Uses client tools of the **server's major version** (`scripts/ops/pg-tools.sh`) and
  refuses otherwise. A newer `pg_dump` writes settings that an older server rejects on
  restore. CI hit exactly this: the runner's default client was newer than the
  PostgreSQL 16 service, and its `SET transaction_timeout` aborted the restore.
* With `BACKUP_GPG_RECIPIENT` set, encrypts to that public key and deletes the plaintext,
  so neither the backup host nor the off-site copy can read it. Without it, encrypt at the
  storage layer.
* Writes a `.sha256` file next to every dump, and prunes local copies older than
  `BACKUP_RETENTION_DAYS`. Off-site retention is the storage provider's lifecycle rule.
* Run it from cron or a scheduled job, for example hourly or daily, with retention
  matching your recovery-point objective. `backups/` is gitignored, and the secret scan
  rejects tracked dumps.

**Restore drill** (`scripts/ops/restore-check.sh`; CI runs it after every integration
run):

```bash
DATABASE_URL=<source> RESTORE_ADMIN_URL=<role with CREATEDB>/postgres npm run ops:restore-check
```

The drill:

1. dumps the source;
2. creates a **new** database `casino_restore_check_<time>_<random>`. It never restores
   over an existing database, and drops only the one it created;
3. restores into it with `--exit-on-error` and runs `db:migrate`, which verifies
   migration checksums and re-applies grants and reference data;
4. verifies that append-only row counts lie between the source's counts before and after
   the dump, that the trigger sets are identical, and that **reconciliation (22 checks)
   returns OK**;
5. drops the copy. Set `KEEP_RESTORE_DB=1` to inspect it.

It exits non-zero on any difference.

To restore a real backup, do it into a NEW database first and never over production:

```bash
gpg --decrypt casino-<stamp>.dump.gpg > casino.dump && sha256sum -c casino-<stamp>.dump.gpg.sha256
createdb casino_restore      # as an admin; owner casino_migrator
pg_restore --no-owner --no-privileges --exit-on-error --dbname=<casino_restore URL as casino_migrator> casino.dump
DATABASE_URL=<casino_restore URL> npm run db:migrate      # checksums, grants, reference data
DATABASE_URL=<casino_restore URL> npm run job:reconcile   # must print "status": "OK"
```

Then point the application at the verified copy: update `DATABASE_URL`, then do a rolling
restart.

**Tested on 2026-10-26** in this environment:

* **Drill:** `npm run ops:restore-check` on the integration database (301 rounds, 1,828
  ledger entries) passed. Every append-only count matched, 16 user triggers were identical,
  reconciliation was OK (22 checks, 0 mismatches), and the copy was dropped.
* **Negative control:** a copy of the source with one ledger entry altered failed the drill
  ("reconciliation of the restored copy failed", exit 1).
* **Backup:** `npm run ops:backup` with a throwaway GPG key produced mode-0600 files. The
  checksum verified, the dump decrypted, and `pg_restore --list` read it.
* **Earlier drill:** the development database (18,272 rounds, 91,122 ledger entries)
  restored with identical counts and reconciled OK.

Repeat the drill against a production backup, in an isolated environment, after every
schema change and at least quarterly.

**Recovery after interrupted settlement.** Each round settles in one transaction
together with its ledger postings, so a crash or restart never leaves a half-settled
round. A round is either still OPEN (its stake held in `WAGERS_IN_PLAY`), or settled
exactly once, enforced by the unique settlement key `round:<id>:settle` and the unique
`payouts.round_id`. After a restore or restart:

* the expiry job settles OPEN time-decided rounds that are past their deadline (or run
  `npm run job:expire-rounds`);
* players finish other OPEN rounds;
* admins can void OPEN rounds with a full refund.

All of these are idempotent: running them again changes nothing that has already
committed. Then run `npm run job:reconcile`.

## 7. Health checks and monitoring

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness (process up). Used by the Docker `HEALTHCHECK`. |
| `GET /api/health/ready` | readiness: least-privilege DB role, DB reachable, migrations applied, reference data present. Public; returns only check names and pass/fail (details are logged server-side). |
| `GET /api/metrics` | Prometheus text, requires `Authorization: Bearer $METRICS_TOKEN`. **Optional:** with no token configured (unset, empty or blank) the endpoint is disabled and answers 403 to every request — there is no unauthenticated mode. The startup log states which (`metrics endpoint enabled` / `disabled`). The public proxy (`deploy/nginx*.conf`) answers 404 for `/api/metrics*`: scrape `app:3000` on the private network. |
| `/admin/health` | staff view: readiness details, pool, memory, error rate, reconciliation, password-recovery delivery state. |

Metrics are optional so that a deployment without Prometheus does not have to invent a
token, but the metric-based alerts below need `METRICS_TOKEN` set and a scraper using it.
Without them, `/admin/health`, the alerts table and the logs are the only signals.

Alert on **(external)**:

| Signal | Meaning | First action |
|---|---|---|
| readiness failing > 1 min | database unreachable, wrong role, migrations missing | `/admin/health`, app logs |
| `casino_round_expiry_failures_total` increasing; `error_events` with route `job:expire-rounds` | a time-decided round failed to settle; it is retried with backoff | logs by `roundId`; reconciliation `expiry_queue_not_overdue` |
| reconciliation `expiry_queue_not_overdue` mismatch | OPEN rounds more than 5 minutes past their deadline (stuck) | check the scheduler is running (`BACKGROUND_JOBS`) or run `npm run job:expire-rounds` |
| `casino_round_actions_total{resolution="processing_deadline_passed"}` increasing | cash-outs received in time but not processed within the 1 s grace (overloaded database or long locks), settled by time instead (`docs/math/crash.md` § Ordering) | warning logs carry `processingDelayMs`; check database latency and locks |
| any `RECONCILIATION_MISMATCH` alert (CRITICAL) | ledger, wallet, round or payout records disagree | §8 incident response |
| `casino_mail_failed_total` increasing; `error_events` route `background:password_reset` | password-reset mail or token issue failed | §9 |
| `casino_rate_limited_total{rule}` / `http_requests_total{status="429"}` spikes | rate-limit abuse, or a misconfigured proxy (`TRUST_PROXY_HOPS`) putting every client in one bucket | access logs (`requestId`, hashed IP) |
| `casino_login_failures_total{reason}` spikes (`wrong_password`, `unknown_account`, `locked_now`) | credential stuffing or guessing | `/admin/audit` (`auth.login_failed`, `auth.account_locked` with hashed IPs) |
| `http_requests_total{status=~"401|403"}` spikes on `/api/admin/*` | authorisation probing | audit log, access logs |
| 5xx rate; `casino_errors_total` | unexpected errors (stored in `error_events` without request payloads) | `/admin/health` error list; logs by `requestId` |
| connection saturation | pool exhausted or database overloaded | pool stats in `/admin/health` |
| `sports_provider_status` last error, or `/admin/sports` showing a provider not refreshed within twice `SPORTS_SYNC_MINUTES` (live mode) | fixtures, results or odds are not being refreshed; stale markets refuse predictions automatically | provider status page and quota in `/admin/sports`; app logs for `job:sports-sync` |
| reconciliation `sports_results_settled` mismatch | a prediction is more than 10 minutes behind its event's result | check the `sports-sync` job; settlement catches up idempotently |
| Extended verification workflow failed | a Monte Carlo or risk-model check failed | the run's job summary and `simulation-reports` artifact (seed, commit); reproduce with the same seed |

Logs are JSON lines on stdout/stderr; ship them to your log platform. Every request log
line carries `requestId`, which is also returned as `X-Request-Id`. Passwords, reset
tokens, cookies, authorisation headers and message bodies are never logged, and keys
matching password/token/secret/cookie/seed are redacted.

## 8. Reconciliation alerts and incident response

Reconciliation (every `RECONCILE_INTERVAL_MINUTES`, or `npm run job:reconcile`, or
*Run now* in `/admin/reconciliation`) re-derives 22 invariants from raw rows in one
snapshot (`docs/database.md` lists them). A mismatch stores the failing checks with
samples and raises a CRITICAL alert.

1. **Detect.** Any of these signals a financial inconsistency:
   * a CRITICAL `RECONCILIATION_MISMATCH` alert;
   * a failing check in `/admin/reconciliation` (or `npm run job:reconcile` exiting with
     code 2);
   * `casino_round_expiry_failures_total` increasing;
   * a player report of a wrong balance.

   Note the time, the failing check names and their samples (round ids, transaction ids,
   account ids).
2. **Pause safely.** Engage the platform kill switch (`/admin/risk` → disable new rounds,
   with an incident message), or suspend only the affected game (`/admin/games`). Both are
   audited. They stop *new* wagers only: players can still finish open rounds, and
   balances and history stay visible. Do not stop the expiry job. It is idempotent and
   keeps time-decided rounds from piling up.
3. **Preserve evidence.**
   * Take a backup now (`npm run ops:backup`) and keep it with its checksum.
   * Do not edit or delete rows. Ledger, bets, payouts, settled rounds and the audit log
     are append-only and protected by triggers, and the reconciliation run, with its
     samples, is itself stored evidence.
   * Export the relevant `/admin/audit` and `error_events` entries and the app logs by
     `requestId` and `roundId`.
4. **Reconcile** ledger, wallet, wager and round records using the failing check's
   samples. Run the drill on the fresh backup in an isolated environment to experiment
   safely (`npm run ops:restore-check`, `KEEP_RESTORE_DB=1`). [database.md](database.md)
   lists what each of the 22 checks compares. `settled_rounds_have_one_payout`,
   `voided_rounds_refunded_exactly` and `round_transactions_linked` pinpoint which
   round's postings disagree; `account_balances_match_entries` and
   `escrow_matches_open_rounds` cover wallets and escrow.
   `expiry_queue_not_overdue` alone means the expiry job is not keeping up: check the
   scheduler, advisory lock and `error_events`. It is not a money error.
   The `sports_*` checks cover predictions: escrow (`sports_escrow_matches_open_tickets`),
   per-ticket postings (`sports_ticket_ledger`), settlements versus payouts
   (`sports_settlements_consistent`) and the `sports-sync` job keeping up
   (`sports_results_settled`).
5. **Recover interrupted settlements without double payment.**
   * A round is never half-settled: it is OPEN (stake held in `WAGERS_IN_PLAY`) or settled
     exactly once (unique `round:<id>:settle` key and unique `payouts.round_id`).
   * For OPEN time-decided rounds, run `npm run job:expire-rounds`; it only settles rounds
     past their deadline.
   * For other OPEN rounds, the player finishes them, or an admin voids them with a full
     refund.
   * Re-running any of these is safe: a second settlement or void of the same round is
     refused by the database.
   * Sports predictions: the `sports-sync` job brings every ticket up to its event's latest
     result version; a second settlement of the same (ticket, version) and a second escrow
     release are refused by unique keys. To stop new predictions only, suspend the event in
     `/admin/sports` or set `SPORTS_MODE=off` and restart (open tickets stay visible; settle
     or void them before turning the section off for good).
   * Correct balances only with compensating entries: an `ADJUSTMENT` via
     `/admin/users/<id>`, which needs a reason, is audited and is visible to the player,
     using the original transaction id as `reversesTransactionId`. Settled rounds are
     immutable by design.
6. **Restore service after verification.** Run reconciliation again; it must return OK
   with 0 mismatches. Lift the kill switch or reactivate the game, acknowledge the alert
   with a reason, and record the incident: cause, affected rounds and players, and the
   corrections with their transaction ids.

## 9. Password-recovery e-mail **(external provider)**

* `MAIL_TRANSPORT=smtp`, `SMTP_URL=smtps://user:pass@smtp.provider:465` (or `smtp://…:587`,
  STARTTLS is then required for non-loopback hosts), `MAIL_FROM="Aurovane <no-reply@your.domain>"`.
* Configure SPF, DKIM and DMARC for the sending domain with your provider.
* Delivery is asynchronous, and so is everything that depends on the account (lookup,
  token write), so response times do not reveal whether an address has an account.
  Delivery failures increment `casino_mail_failed_total` and are logged without the link
  or address; a failure before sending (e.g. the database) is recorded as an error event
  for `background:password_reset` (`/admin/health`).
* **Delivery guarantee: best effort, in process, at most once.** There is no durable queue.
  If the process stops between the response and the send, or the provider rejects the
  message, no link arrives and the player simply asks again (3 per address per hour).
  A token is only usable from the e-mail, so a lost message never leaves a usable secret
  anywhere. If you need guaranteed delivery, put a durable queue or the provider's API with
  retries in place of `sendInBackground`. Reset links are single-use, expire after 30 minutes, are
  stored only as SHA-256 hashes, are throttled per address (3/hour, silently) and per IP.
* Without a provider (`disabled`, the default) the site says so honestly: the
  forgot-password page explains that recovery is unavailable and asks players to contact
  support; no reset token is created. `/admin/health` shows the state.
* Verified here against an in-test SMTP server (`tests/integration/password-recovery.test.ts`);
  **not** verified against a real provider (none is configured in this environment).

## 10. Staff accounts

`npm run db:seed` is for local development only (it refuses production, non-local
`APP_URL` and non-local databases, and has no built-in passwords). In production, create
the first **owner** deliberately: register the account on the site, then run
`npm run admin:provision-owner -- --email … --reason …` (with Compose:
`docker compose run --rm migrate npm run admin:provision-owner -- …`). The command
refuses while an owner exists and is audited. The owner then turns on two-factor
authentication, can require it for all staff, and appoints admins and other staff in
`/admin/users/<id>` (reason required, audited, sessions revoked). Details, the role
matrix and break-glass recovery: [admin.md](admin.md#first-owner).

Backup credentials (`BACKUP_GPG_RECIPIENT`'s private key, storage write keys) must be
separate from the application's: the app role cannot read backups, and the backup role
cannot change the application database.

## 11. Known production blockers

Must be resolved by the operator before a public launch (see the README for the full list):

1. Domain, DNS and a real TLS certificate at the edge (section 3).
2. Secrets in a secret manager (section 2).
3. Off-site backups with a restore drill (section 6).
4. A mail provider for password recovery, or an explicitly staffed support path (section 9).
5. Log/metric shipping and alerting (section 7).
6. Legal review of terms, privacy notice, age gating and the virtual-currency disclosures
   for each target jurisdiction (`docs/compliance-checklist.md`) — this repository makes
   no claim of licensing or legal compliance.
