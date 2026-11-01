# Production readiness

The state of Aurovane after the public-launch pass of 2026-11-01. It is based
on code, test runs and a real run of the production containers, not on
documentation alone. For the item-by-item launch gate, see
[public-launch-checklist.md](public-launch-checklist.md).

## Verdict

**TECHNICALLY READY: the code is ready, and external operator tasks remain.**

- The application, its deployment configuration, backups and monitoring hooks
  are implemented and verified in this repository's environment.
- The site is **not ready to open to the public** until the P0 items of
  sections B, C and D of the launch checklist have evidence:
  - a domain with TLS;
  - a real e-mail provider passing SPF, DKIM and DMARC;
  - off-site encrypted backups with a restore drill from them;
  - monitoring with alert routing;
  - an independent penetration test;
  - a legal review;
  - published operator details;
  - a second owner.
- **Nothing has been deployed publicly.** No external provider (e-mail, SMS,
  storage, monitoring, certificate) is configured, and no independent
  security or legal review has taken place.

## What this pass added (summary)

| Area | Change | Docs |
|---|---|---|
| E-mail | Failure classification; same-message retries; connection checks at start-up, in `/admin/health` and in `ops:mail-check`; branded templates; status and metrics; `SUPPORT_EMAIL` required | [email-setup.md](email-setup.md) |
| Staff security | Four-eyes approvals for large grants, corrections, house funding and relaxing staff MFA | [admin.md](admin.md#four-eyes-approvals) |
| Verification | SMS phone-verification machinery behind a provider interface (inactive by default); age-verification interface | [onboarding.md](onboarding.md) |
| Browser security | Per-request nonce CSP: no inline scripts | [security-review.md](security-review.md) |
| Deployment | Internal database network; non-root, read-only, capability-free containers; limits; log rotation; TLS override; nginx logs without query strings; auth rate limits | [deployment.md](deployment.md) |
| Backups | Mandatory encryption; no plaintext left on failure; integrity checks; upload hook; heartbeat; verify script; restore from an encrypted file; scheduled backup service | [backup-recovery.md](backup-recovery.md) |
| Monitoring | Job, database, reconciliation, alert and mail gauges; Prometheus alert rules | [deployment.md](deployment.md#7-monitoring) |
| Responsible play | Active breaks shown on every page; grants refused during breaks | [responsible-play.md](responsible-play.md) |
| Public pages | Help & support page; free-to-play statements; accurate Privacy Notice and Terms with the operator contact | `/help`, `/privacy`, `/terms` |
| Dependencies | `minimatch` override for GHSA-g3hv-75wg-m249 (dev tooling) | [dependency-security.md](dependency-security.md) |
| Reviews | Security review, penetration-test brief, legal checklist, launch checklist | linked above |

## Evidence

| Check | Result (2026-11-01) |
|---|---|
| Typecheck, lint | pass, 0 problems |
| Unit | 277 passed (29 files) |
| Integration (PostgreSQL 16) | 286 passed (30 files) |
| Statistical | 24 passed (5 files) |
| Production build, client-bundle secret check | pass, 158 files, no server secrets |
| End-to-end (desktop + mobile, production build, real SMTP to a loopback sink) | 35 passed |
| `npm audit` | 0 vulnerabilities after the `minimatch` override |
| Docker images built; hardened Compose stack run | healthy. The checks: readiness, nonce CSP, `/api/metrics` refused at the edge, database unreachable from outside and with no outbound route, app uid 1000 with a read-only FS and no capabilities, reset token absent from proxy logs, unsafe configuration → exit 1 |
| Encrypted backup from the Compose `backup` service → verify → restore → reconcile | PASSED, 22 checks, 0 mismatches |
| Migration 0010 on existing data (development database) | applied; 528 accounts and 91,216 ledger entries unchanged; reconciliation OK |
| CI on the final commit | see [testing.md](testing.md) (recorded after the run) |

## Known limitations (accepted for launch, tracked)

- **P1:** the audit log is append-only for the application, not tamper-proof
  against a database superuser. Ship backups and logs off-host.
- **P1:** the RPO is up to 24 hours with daily dumps; add point-in-time
  recovery.
- **P2:**
  - mail delivery has no durable queue;
  - styles allow `'unsafe-inline'`;
  - the register form reveals a taken e-mail address;
  - phone verification needs an SMS provider adapter;
  - age is self-declared;
  - TOTP is the only second factor (no passkeys).
