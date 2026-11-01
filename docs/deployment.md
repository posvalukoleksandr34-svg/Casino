# Production deployment

This is the procedure to put Aurovane on a public host with Docker Compose.
The same architecture works on any container platform; the sections say what
each part needs.

**Status:** the configuration below was **built and run** in this repository's
environment on 2026-11-01. Images were built from the Dockerfile, the full
Compose stack was started (including the backup profile), and it was checked
from outside: readiness, headers, network isolation, users, capabilities, logs,
fail-closed start-up, and an encrypted backup that was restored and reconciled.
That was a local test host with plain HTTP. **Nothing has been deployed to a
public domain**, and no real certificate, e-mail provider, off-site storage or
monitoring system has been connected.

## Architecture

```
 Internet ──HTTPS──▶ proxy (nginx 1.27; TLS, HSTS, rate limits, no query strings in logs)
                       │  network "edge"
                       ▼
                     app (Next.js standalone, uid 1000, read-only FS, no capabilities)
                       │  network "backend" (internal: no route to the internet)
                       ▼
                     db (PostgreSQL 16, no published port)  ◀── migrate (one-shot, migrator role)
                       ▲
                     backup (profile "backup": encrypted pg_dump, public key only)
```

| Concern | How |
|---|---|
| TLS | at the proxy (`deploy/nginx-tls.conf` + `docker-compose.tls.yml`) or at a load balancer in front of it; `APP_URL=https://…`; HSTS at the TLS terminator |
| Trusted proxy | the proxy **overwrites** `X-Forwarded-For`; the app trusts exactly one hop (`TRUST_PROXY_HOPS=1`), so per-IP limits cannot be spoofed. With a load balancer in front of nginx, make nginx take the client address from it (`set_real_ip_from` + `real_ip_header`) and keep `TRUST_PROXY_HOPS=1` |
| Least privilege (database) | the app connects as `casino_app` (no ownership, no DDL; readiness fails in production if it is privileged); migrations run as `casino_migrator`; the superuser is used only to initialise |
| Containers | app and migrate: non-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, tmpfs for `/tmp`; memory/CPU/PID limits, log rotation (10 MB × 5), `restart: unless-stopped` |
| Network exposure | only the proxy publishes a port; the database is on an internal network; `/api/metrics` is refused at the proxy (scraped inside the network with a bearer token) |
| Headers | per-request nonce CSP (no `'unsafe-inline'` scripts), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS (TLS) |
| Rate limits | nginx: 30 req/s per IP (burst 60), 2 req/s for auth/code endpoints (burst 10), 50 concurrent connections; the app: per-route and per-account limits in PostgreSQL |
| Configuration | validated at start-up; production **refuses to start** (exit 1) when anything is missing or unsafe (keys, secrets, https `APP_URL`, strong database password, mail settings, `SUPPORT_EMAIL`) |
| Health | `GET /api/health` (liveness), `GET /api/health/ready` (database, role, migrations, reference data; 503 when degraded); container health checks for db, app and proxy |
| Logs | JSON on stdout. The app logs request id, route, status and duration, with no bodies. The proxy logs paths without query strings |
| Backups | see [backup-recovery.md](backup-recovery.md) |

## 1. Host

- A Linux VM with Docker Engine and the Compose plugin; 2 vCPU, 4 GB RAM and
  20 GB SSD are enough to start.
- Firewall: allow 80/443 inbound (22 from your admin IPs only); allow
  outbound to the SMTP provider, the off-site storage and, in live sports
  mode, the sports APIs.
- Keep the host patched (unattended security upgrades), and turn on
  provider-level disk encryption and snapshots.

## 2. Secrets

```bash
git clone https://github.com/posvalukoleksandr34-svg/Casino.git aurovane && cd aurovane
git checkout <release commit>
cp .env.example .env && chmod 600 .env
# generate (never reuse example values):
openssl rand -hex 24       # POSTGRES_SUPERUSER_PASSWORD, DB_MIGRATOR_PASSWORD, DB_APP_PASSWORD (each different)
openssl rand -base64 32    # SEED_ENCRYPTION_KEY
openssl rand -hex 32       # IP_HASH_SECRET, METRICS_TOKEN
```

Fill in `.env`. Every variable is described in `.env.example`, marked
required or optional. At minimum:
- `APP_URL=https://<domain>`
- the three database passwords
- `SEED_ENCRYPTION_KEY` and `IP_HASH_SECRET`
- `SUPPORT_EMAIL`
- `MAIL_TRANSPORT=smtp` with `SMTP_URL` and `MAIL_FROM` (see
  [email-setup.md](email-setup.md))
- `BACKUP_GPG_RECIPIENT`

Keep a copy of `.env` in your secret manager. Losing `SEED_ENCRYPTION_KEY`
makes unrevealed provably-fair seeds unreadable.

## 3. TLS certificate

Get a certificate for the domain, for example with certbot in webroot mode
using `./deploy/acme`, or from your CA. Place `fullchain.pem` and `privkey.pem`
in `./deploy/tls` (git-ignored). Renewal must reload nginx:
`docker compose exec proxy nginx -s reload`.

## 4. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
docker compose ps                     # db, app, proxy healthy; migrate exited 0
docker compose logs migrate | tail -3 # {"msg":"migrations","applied":[…]} {"msg":"reference data bootstrapped"}
docker compose logs app | grep -i mail   # "mail transport verified (SMTP connection and authentication OK)"
docker compose --profile backup up -d backup
```

With a TLS load balancer instead, drop the override and publish `APP_PORT`
only to the load balancer's network.

## 5. Verify from outside

```bash
curl -fsS https://<domain>/api/health/ready      # {"status":"ok",…}
curl -sI https://<domain>/ | grep -iE 'strict-transport|content-security|x-frame'
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/metrics   # 404 at the edge
nc -zv <host> 5432                               # must FAIL (database not exposed)
```

- Check the certificate chain and protocols with an external TLS test. TLS
  1.2+ only, no warnings.
- The security-headers checks above should match what this repository's
  `security.spec.ts` asserts.

## 6. First owner and staff

1. Register the owner account on the site (e-mail code, profile step).
2. Promote it:
   `docker compose run --rm migrate npm run admin:provision-owner -- --email <owner e-mail> --reason "Initial owner"`
3. Sign in and turn on two-factor authentication at `/admin/security`.
4. Appoint a **second owner**. Four-eyes operations — grants above 10,000
   chips, house funding, switching the staff MFA requirement off — need two
   owners; corrections need two admins or owners.
5. Require MFA for all staff.

Details: [admin.md](admin.md#first-owner).

## 7. Monitoring

- **Uptime:** probe `https://<domain>/api/health/ready` from outside, every
  minute, alerting after 2 failures.
- **Metrics:**
  - Prometheus scrapes `app:3000/api/metrics` inside the Docker network (or
    through a private tunnel), with `Authorization: Bearer $METRICS_TOKEN`.
  - Load `deploy/monitoring/alerts.yml`. It alerts on:
    - instance down, database unreachable;
    - 5xx rate, latency;
    - reconciliation mismatch or staleness, open CRITICAL alerts;
    - failing jobs, stalled round expiry;
    - mail transport down, mail failures.
  - Route the alerts to a person.
- **Backups:** a dead-man's switch on `BACKUP_HEARTBEAT_URL` (no success in
  26 h = alert).
- **Logs:** ship container stdout (JSON) to your log system, and keep it for
  as long as your policy says.

## 8. Updates

```bash
git fetch && git checkout <new release commit>
docker compose run --rm --build migrate     # forward-only migrations first
docker compose up -d --build app
docker compose ps && curl -fsS https://<domain>/api/health/ready
```

- Migrations are forward-only and additive. Back up before every release
  (`docker compose exec backup bash /opt/aurovane/ops/backup.sh`).
- Rolling back means redeploying the previous image. A schema rollback means
  a restore ([backup-recovery.md](backup-recovery.md)).

## Building in restricted networks

The Dockerfile accepts a CA certificate for TLS-intercepting proxies
(`--secret id=extra_ca,src=…`). The backup stage installs `curl` for the
monitoring pings; pass `--build-arg BACKUP_APT_PACKAGES=` where no Debian
mirror is reachable. Pings then log a warning and are skipped; backups still
run.
