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
| `METRICS_TOKEN` | ≥ 24 characters when set |
| `MAIL_TRANSPORT` | `smtp` (with `SMTP_URL`, `MAIL_FROM`) or `disabled`; `console` is refused |

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
| `METRICS_TOKEN` | Replace in the app and in the scraper. | scrape gap |
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
* **Zero-downtime-ish restarts:** in-flight requests are short; open interactive rounds
  survive restarts (state is in PostgreSQL); the expiry job resumes and settles any Crash
  round that ended while the app was down, using the round's own end time.
* Background jobs (expiry every 5 s, reconciliation, anomaly detection, cleanup) run in the
  app process under PostgreSQL advisory locks, so several app instances never run the same
  job concurrently. Set `BACKGROUND_JOBS=false` to run them elsewhere
  (`npm run job:expire-rounds`, `npm run job:reconcile` from cron).

## 6. Backups and tested restoration

**(external)** Schedule backups off-host (object storage with versioning and retention).
A logical backup is enough at this scale; for point-in-time recovery use the provider's
PITR / WAL archiving.

```bash
# Backup (any role with read access; the owner role is simplest)
pg_dump --format=custom --no-owner --no-privileges \
        --file=casino-$(date +%F).dump "$MIGRATOR_DATABASE_URL"

# Restore into a NEW, empty database owned by casino_migrator
pg_restore --no-owner --no-privileges --exit-on-error \
           --dbname="postgresql://casino_migrator:…@host/casino_restore" casino-YYYY-MM-DD.dump
DATABASE_URL=postgresql://casino_migrator:…@host/casino_restore npm run db:migrate   # verifies checksums, re-applies grants
DATABASE_URL=postgresql://casino_migrator:…@host/casino_restore npm run job:reconcile # must print "status": "OK"
```

Tested in this environment on 2026-10-26 with the development database (18,272 rounds,
91,122 ledger entries, 8 MB custom-format dump, 2 s): the restored copy had identical
round/entry counts, balances summing to 0, the same escrow balance, all append-only
triggers present, applied the pending migration cleanly, and reconciliation returned OK.
Repeat a restore drill after every schema change and at least quarterly; keep the dump's
checksum with it.

## 7. Health checks and monitoring

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness (process up). Used by the Docker `HEALTHCHECK`. |
| `GET /api/health/ready` | readiness: least-privilege DB role, DB reachable, migrations applied, reference data present. Public; returns only check names and pass/fail (details are logged server-side). |
| `GET /api/metrics` | Prometheus text, requires `Authorization: Bearer $METRICS_TOKEN`. |
| `/admin/health` | staff view: readiness details, pool, memory, error rate, reconciliation, password-recovery delivery state. |

Alert on **(external)**: readiness failing for > 1 min; `casino_round_expiry_failures_total`
increasing; `casino_mail_failed_total` increasing; any `RECONCILIATION_MISMATCH` alert
(CRITICAL); 5xx rate; database connection saturation. Logs are JSON lines on
stdout/stderr — ship them to your log platform.

## 8. Reconciliation alerts and incident response

Reconciliation (every `RECONCILE_INTERVAL_MINUTES`, or `npm run job:reconcile`, or
*Run now* in `/admin/reconciliation`) re-derives 17 invariants from raw rows in one
snapshot (`docs/database.md` lists them). A mismatch stores the failing checks with
samples and raises a CRITICAL alert.

1. **Contain.** Engage the platform kill switch (`/admin/risk` → disable new rounds, with
   an incident message). Open rounds can still be completed; balances stay visible.
2. **Preserve evidence.** Take a backup now. Do not edit rows: history is append-only and
   reconciliation output is the evidence.
3. **Diagnose** with the check's samples (round ids, transaction ids) and the audit log
   (`/admin/audit`). `expiry_queue_not_overdue` alone means the expiry job is not keeping
   up (check the scheduler/advisory lock and `error_events`); it is not a money error.
4. **Correct** only with compensating entries: `ADJUSTMENT` via `/admin/users/<id>` (reason
   required, audited, visible to the player) or voiding an OPEN round. Settled rounds are
   immutable by design.
5. **Verify** with a new reconciliation run, then lift the kill switch and acknowledge the
   alert with a reason.

## 9. Password-recovery e-mail **(external provider)**

* `MAIL_TRANSPORT=smtp`, `SMTP_URL=smtps://user:pass@smtp.provider:465` (or `smtp://…:587`,
  STARTTLS is then required for non-loopback hosts), `MAIL_FROM="Aurovane <no-reply@your.domain>"`.
* Configure SPF, DKIM and DMARC for the sending domain with your provider.
* Delivery is asynchronous; failures increment `casino_mail_failed_total` and are logged
  without the link or address. Reset links are single-use, expire after 30 minutes, are
  stored only as SHA-256 hashes, are throttled per address (3/hour, silently) and per IP.
* Without a provider (`disabled`, the default) the site says so honestly: the
  forgot-password page explains that recovery is unavailable and asks players to contact
  support; no reset token is created. `/admin/health` shows the state.
* Verified here against an in-test SMTP server (`tests/integration/password-recovery.test.ts`);
  **not** verified against a real provider (none is configured in this environment).

## 10. Staff accounts

`npm run db:seed` is for local development only (it refuses production, non-local
`APP_URL` and non-local databases, and has no built-in passwords). In production create
the first administrator deliberately: register normally, then as `casino_migrator`
`UPDATE users SET role = 'ADMIN' WHERE email = '…';` and record why. Further role changes
happen in `/admin/users/<id>` (reason required, audited, sessions revoked).

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
