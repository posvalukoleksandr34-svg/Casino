# Public launch checklist

Every item states where its evidence is. **Configuration support in the
repository does not complete an external item.** An item is ticked only with
evidence from the real production environment, recorded in the last column
by the person who checked it.

Priorities:
- **P0** blocks public launch.
- **P1** is done before or immediately after launch.
- **P2** is an improvement that can follow.

## A. Implemented and verified in code

These have automated evidence in this repository; see [testing.md](testing.md)
for the runs.

| Item | Evidence |
|---|---|
| Free-to-play virtual chips only: no purchase, deposit, withdrawal, transfer, prize or payment code | Code review; Terms, Help and landing page; no payment dependencies in `package.json` |
| Registration → e-mailed code → onboarding → lobby; no session or chips before verification; the onboarding gate on every API route | `registration.test.ts`, `registration.spec.ts` |
| 18+ checked on the server by calendar date | `account-policy.test.ts`, `registration.test.ts`, e2e under-age refusal |
| E-mail: TLS, timeouts, temporary/permanent classification, same-message retries, connection checks, status, templates, safe logs | `mail.test.ts` (13 tests) |
| Password recovery, e-mail change, session revocation | `password-recovery.test.ts`, `registration.test.ts`, `resilience-access.spec.ts` |
| Staff MFA (TOTP), owner policy, last-owner protection, rank rules | `owner-admin.test.ts`, `owner-admin.spec.ts` |
| Four-eyes approvals (large grants, corrections, house funding, relaxing MFA) | `approvals.test.ts`, `admin-guards.test.ts` |
| Phone verification machinery (inactive without a provider) and the age-verification seam | `phone-verification.test.ts` |
| Server-authoritative games, provably fair, published RTP | `rounds`, `fairness`, `new-games`, statistical suite |
| Ledger integrity: double entry, append-only, idempotency, concurrency, 22-check reconciliation | `ledger-invariants`, `financial-integrity`, `reconciliation-faults`, `crash-ordering` |
| Responsible play across games, sports and bonuses; breaks visible; grants refused during breaks | `responsible*.test.ts`, `launch-hardening.test.ts`, `registration.spec.ts` |
| Nonce CSP (no inline scripts), security headers, CSRF, rate limits | `security.spec.ts`, `api.test.ts`, `auth-hardening.test.ts` |
| Data export and deletion cover every personal field | `registration.test.ts`, `phone-verification.test.ts`, `auth.test.ts` |
| Production refuses unsafe or incomplete configuration | `env.test.ts`; container started with a bad configuration → exit 1 |
| Hardened containers and networks; logs without query strings; encrypted backups; restore + reconciliation | Running-stack verification on 2026-11-01 ([deployment.md](deployment.md), [backup-recovery.md](backup-recovery.md)); CI restore drill |
| Accessibility and mobile layout of every main page, including registration | `accessibility.spec.ts`, `mobile.spec.ts` |
| Dependencies | `npm audit`: 0 vulnerabilities (2026-11-01); Dependabot |

## B. Requires production infrastructure or external provider configuration

| # | Item | Priority | How to verify | Evidence |
|---|---|---|---|---|
| B1 | Domain, DNS and a valid TLS certificate at the edge; HTTP→HTTPS; HSTS | P0 | [deployment.md §3–5](deployment.md); external TLS scan with no warnings | |
| B2 | Production host with the hardened Compose stack (or equivalent); secrets in a secret store; `.env` mode 600 | P0 | `docker compose ps` all healthy; `curl https://<domain>/api/health/ready`; `nc -zv <host> 5432` fails | |
| B3 | Transactional e-mail provider with SPF, DKIM and DMARC aligned for the `MAIL_FROM` domain | P0 | [email-setup.md](email-setup.md) validation steps 1–6, including inbox placement and `dmarc=pass` | |
| B4 | `SUPPORT_EMAIL` mailbox that someone reads, with a response process | P0 | Send a test message and get a reply | |
| B5 | Off-site, access-restricted backup storage (`BACKUP_UPLOAD_COMMAND`), with object lock or versioning | P0 | A backup file present off-site; the server credential cannot delete it | |
| B6 | Backup key pair generated offline; private key stored in two places; decryption tested | P0 | `ops:backup-verify` with the private key on the restore workstation | |
| B7 | A restore drill from an **off-site** backup on a disposable host | P0 | `RESTORE_FROM=… npm run ops:restore-check` → PASSED, reconciliation OK | |
| B8 | Monitoring: external uptime probe; Prometheus with `deploy/monitoring/alerts.yml`; alert routing to a person; a dead-man's switch for backups | P0 | A test alert reaches the on-call person; stop the backup → alert | |
| B9 | Log shipping and retention | P1 | Container JSON logs searchable off-host | |
| B10 | Point-in-time recovery (WAL archiving or a managed database) to cut the RPO below 24 h | P1 | Provider console / restore test to a timestamp | |
| B11 | SMS provider adapter for phone verification, if phone verification is wanted | P2 | Adapter implemented and reviewed; `phone-verification.test.ts` pattern against staging | |
| B12 | Third-party age verification, if the legal review requires it | P1/P2 | Depends on C2 | |

## C. Requires independent professional review

| # | Item | Priority | Evidence |
|---|---|---|---|
| C1 | Independent penetration test on a production-identical staging host; all Critical and High findings fixed and retested | P0 | Report, fix commits, retest confirmation ([penetration-testing.md](penetration-testing.md)) |
| C2 | Legal review by a qualified lawyer: social-casino classification, age, Terms, Privacy Notice, Swiss revFADP and GDPR applicability, processors, retention | P0 | Signed-off [legal-review-checklist.md](legal-review-checklist.md) |
| C3 | Operator identity and contact details published as the lawyer advises (imprint, controller) | P0 | Pages updated after C2 |
| C4 | Responsible-play content (help organisations per market) reviewed | P1 | Reviewed copy on `/responsible-play` |
| C5 | Independent RNG/game-mathematics certification | P2 (only if a market or partner requires it) | Certificate |

## D. Requires explicit operator action

| # | Item | Priority | Command / place | Evidence |
|---|---|---|---|---|
| D1 | Generate every production secret; never reuse the examples | P0 | [deployment.md §2](deployment.md) | |
| D2 | Provision the first owner; appoint a **second owner**; require MFA for staff | P0 | `admin:provision-owner`, `/admin/users`, `/admin/security` | |
| D3 | Set `MAIL_TRANSPORT=smtp` only after B3 passes; until then registration stays closed | P0 | `.env`, then `/admin/health → E-mail delivery` | |
| D4 | Start the backup service; confirm the first encrypted backup and the heartbeat | P0 | `docker compose --profile backup up -d backup` | |
| D5 | Decide whether staff and player accounts already in the database are kept. Pre-existing accounts are marked `LEGACY_MIGRATION` and are exempt from onboarding | P0 | [onboarding.md](onboarding.md#existing-accounts-migration-0009) | |
| D6 | Check `SPORTS_MODE` (demo by default) and, for live mode, the provider keys and terms | P1 | `.env` | |
| D7 | Incident response: who is on call, how players are told, the breach-notification owner | P0 | [operations.md §8](operations.md#8-reconciliation-alerts-and-incident-response), legal review | |
| D8 | Run the full pre-launch smoke test on production: register with a real mailbox, verify, onboard, play, wallet, history, profile, settings, password reset, e-mail change; staff sign-in with MFA; one four-eyes approval | P0 | Record date, tester and results | |
| D9 | Schedule monthly restore drills and quarterly access reviews | P1 | Calendar | |

**The site may open to the public only when every P0 row in B, C and D has
evidence.**
