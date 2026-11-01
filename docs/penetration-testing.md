# Penetration-test preparation

This is a brief for the **independent** security professional who will test
Aurovane before its public launch. No independent penetration test has been
performed yet. The internal review that preceded this brief is in
[security-review.md](security-review.md).

## 1. What Aurovane is

Aurovane is a free social casino. It has casino-style games (roulette, dice,
mines, crash, blackjack, limbo, keno, plinko, hi-lo) and a football prediction
simulator, played with **virtual chips that have no monetary value**: no
deposits, withdrawals, purchases, transfers or prizes. Even so, the chip
ledger is treated with financial-grade integrity, and accounts hold personal
data.

## 2. Architecture

- **Next.js 15 (App Router) on Node 22**, standalone server. All game
  outcomes, payouts and balances are computed on the server.
- **PostgreSQL 16:**
  - the runtime role `casino_app` has no ownership or DDL;
  - migrations run as `casino_migrator`;
  - append-only tables are guarded by triggers;
  - the double-entry ledger has deferred balance checks.
- **nginx reverse proxy:**
  - TLS and HSTS;
  - overwrites `X-Forwarded-For`;
  - per-IP rate limits;
  - `/api/metrics` refused at the edge.
- **Docker Compose:** the database is on an internal network. App containers
  are non-root, with read-only filesystems and no capabilities.
- **Outbound connections:** the SMTP provider; optionally football-data.org
  and The Odds API (live sports mode); the off-site backup storage.
- Docs: [architecture.md](architecture.md), [deployment.md](deployment.md),
  [threat-model.md](threat-model.md).

## 3. Scope

**In scope**
- The web application at the agreed **staging** URL (a production-identical
  deployment with its own database and secrets): every page and every
  `/api/*` route. There are 100 HTTP handlers; [api.md](api.md) lists them.
- Authentication and sessions, registration, e-mail verification,
  onboarding, password reset, e-mail change, MFA, phone verification (if an
  SMS provider is configured on staging).
- Authorisation: player vs staff, the role hierarchy (owner, admin,
  moderator, risk manager, auditor), object-level access, the four-eyes
  approvals.
- Game and ledger integrity:
  - outcome manipulation, replay and idempotency;
  - race conditions, double settlement;
  - balance manipulation;
  - provably-fair commitments.
- Responsible-play enforcement: limits, cool-off, self-exclusion,
  delayed increases.
- Headers, CSP, cookies, CSRF, CORS, rate limiting, account enumeration,
  data exposure (export, admin views).
- The reverse proxy and container configuration on the staging host,
  including network exposure, TLS and the backup encryption design.

**Out of scope** (unless agreed in writing)
- Production systems and real player data.
- Denial-of-service, load or stress tests beyond rate-limit checks.
- Social engineering and physical attacks.
- The third-party providers themselves: the e-mail and SMS providers, the
  sports data APIs, the hosting provider and the off-site storage.
- Source-code supply chain beyond dependency review. The repository is
  available on request for white-box testing.

## 4. Test accounts

The operator creates these on **staging** before the test. Never use
production. Send credentials through a separate secure channel; never put
them in tickets or this document.

| Account | Role | Notes |
|---|---|---|
| player-a, player-b | Player | Two players, for cross-account (IDOR) tests |
| player-new | — | Fresh registrations made by the tester through the real flow |
| moderator | Moderator (SUPPORT) | Read access, suspensions, personal-data view |
| risk | Risk manager | Games, sports, rounds, risk settings |
| auditor | Auditor | Read-only, audit log |
| admin-a, admin-b | Admin | Two admins, to test four-eyes corrections |
| owner-a, owner-b | Owner | Two owners, for grants above the threshold, house funding and the MFA policy |

- Staff accounts must have TOTP set up. Give the tester the TOTP secrets for
  the staging accounts.
- Provide a mailbox reachable by the tester for the staging e-mail
  transport (e.g. a staging SMTP sink with a web UI), so codes and reset
  links can be read.

## 5. Critical assets

1. Integrity of the virtual-chip ledger and game outcomes (no
   minting, double payout or retroactive change).
2. Account takeover resistance (passwords, sessions, reset, e-mail change,
   MFA).
3. Personal data: e-mail, names, date of birth, country, phone, IP hashes.
4. Staff privileges and the audit trail.
5. Server secrets: the seed encryption key, `IP_HASH_SECRET`, database
   credentials, SMTP credentials, and the backup key (only its public half is
   on the server).

## 6. Trust boundaries

- **Browser ↔ proxy:** the internet, untrusted.
- **Proxy ↔ app:** the trusted edge network. The app trusts exactly one
  forwarded hop.
- **App ↔ database:** the internal network, with least-privilege
  credentials.
- **Player ↔ staff:** permission checks on every page and API; rank rules
  for actions against other staff.
- **Staff ↔ staff:** four-eyes approval on sensitive operations.
- **Server ↔ external providers:** SMTP, SMS and sports APIs. Their
  responses are treated as untrusted input.

## 7. Main attack surfaces

- Sign-in, MFA step, registration, verification code entry and resend,
  address correction, password reset, e-mail change, phone verification.
- Wager and round-action APIs: idempotency keys, concurrent requests, timing
  (crash cash-out), round expiry.
- Sports predictions: odds staleness, settlement, corrections.
- The admin API: user search, status and role changes, grants, the
  correction and house-funding approval flow, game status and limits, sports
  operations, audit, health and mail checks.
- Data export and account deletion.
- The public pages, and the CSP or HTML injection risk in any reflected
  value (usernames, display names, names, reasons in the admin).

## 8. Existing controls to verify

See [security-review.md](security-review.md#controls-confirmed-unchanged-already-tested)
and [threat-model.md](threat-model.md). In short:
- strict schemas;
- server-authoritative outcomes;
- the append-only ledger and reconciliation;
- idempotency;
- per-route and per-account rate limits;
- the nonce CSP;
- the onboarding gate on every route;
- HMAC-stored codes;
- the last-owner protection;
- four-eyes approvals;
- MFA policies.

## 9. Known limitations (no need to report them as new)

- The register form says when an e-mail address is already registered.
- Style attributes are allowed by the CSP (`style-src 'unsafe-inline'`).
- The audit log is append-only for the application role, not against a
  database superuser.
- Phone numbers are unverified unless an SMS provider is configured. Age is
  self-declared.
- Mail delivery is best effort, with in-process retries.

## 10. Suggested scenarios

1. IDOR on rounds, history, fairness re-verification, sports tickets, admin
   user and approval ids.
2. Privilege escalation: role fields in registration or onboarding, role
   changes by lower ranks, demoting the last owner, a requester approving
   their own request, approval by a role without the permission.
3. Ledger abuse:
   - concurrent wagers with one Idempotency-Key;
   - replay with a changed body;
   - races between settlement and actions;
   - negative or huge amounts;
   - correction approval executed twice;
   - a grant during self-exclusion.
4. Verification bypass:
   - using the product before entering the code;
   - calling APIs before onboarding;
   - brute-forcing codes against the limits;
   - reusing codes;
   - changing the flow cookie.
5. Session attacks: fixation, a session kept alive after a password or
   e-mail change, CSRF on state-changing routes, cookie flags.
6. XSS through every user-controlled string (usernames, display names,
   names, admin reasons, sports team names in live mode), and CSP
   effectiveness.
7. Enumeration through password reset, resend and timing.
8. Responsible-play bypass: wagering or predicting during a cool-off; raising
   limits without the delay.
9. Proxy and headers: `X-Forwarded-For` spoofing against the rate limits,
   reachability of `/api/metrics`, TLS configuration, cache headers on
   authenticated responses.
10. Data exposure: export completeness and scoping, masking of e-mail
    addresses for staff without personal-data access, error messages.

## 11. Severity classification

The tester uses **CVSS v3.1** (or v4.0) base scores, adjusted by this
platform's context:

| Severity | Examples in this context |
|---|---|
| Critical | Account takeover at scale; arbitrary chip minting or balance change; executing staff operations without permission; reading other users' personal data at scale; remote code execution |
| High | Single-account takeover; bypass of four-eyes, MFA or verification; responsible-play bypass; stored XSS; ledger inconsistency that reconciliation does not detect |
| Medium | Limited IDOR, reflected XSS blocked only by the CSP, CSRF on a low-impact action, rate-limit bypass enabling brute force |
| Low | Information disclosure without personal data, missing hardening headers, verbose errors |
| Informational | Best-practice deviations without exploitability |

Critical and High findings block the launch. Medium findings are fixed before
launch or come with a dated plan the operator accepts. Low and Informational
findings are tracked.

## 12. Remediation evidence required

For each finding, provide:
- the commit that fixes it;
- an automated regression test (unit, integration or e2e) that fails before
  the fix and passes after;
- the CI run on the fixing commit;
- the tester's retest confirmation on staging;
- for configuration findings, the changed configuration file and an outside
  check, such as a `curl`, TLS scan or `nc` output.

Record everything in the launch checklist
([public-launch-checklist.md](public-launch-checklist.md)) before
production goes public.
