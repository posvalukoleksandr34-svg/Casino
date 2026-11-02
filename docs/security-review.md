# Security review (public-launch pass, 2026-11-01)

This is an internal engineering review of the code in this repository, done
with code reading, automated inventories, tests and a real run of the
production containers. It is **not** an independent penetration test and
replaces none. External testing by a qualified independent party is still
required: see [penetration-testing.md](penetration-testing.md).

## Method

1. **Route inventory.** Every `src/app/api/**/route.ts` handler was enumerated
   from source, with its authentication mode, onboarding access and rate
   limits:

   | Authentication mode | Handlers |
   |---|---|
   | staff permission | 36 |
   | signed-in player | 46 |
   | public | 11 |
   | optional sign-in | 4 |
   | health and metrics (own checks) | 3 |
   | **Total** | **100** |

   Automated guards keep the inventory honest:
   - `tests/unit/admin-guards.test.ts`: every admin page checks a permission;
     every admin API declares a staff permission; no route calls the four-eyes
     executors directly.
   - `tests/unit/account-policy.test.ts`: no page bypasses the onboarding
     gate; the onboarding allow-list is pinned.
   - `tests/integration/registration.test.ts` calls **every** API route with a
     half-onboarded session.
2. **Object-level checks.** Every route taking an id (rounds, round actions,
   history, fairness re-verification, sports tickets, admin targets) scopes
   its query to the session's user, or requires a staff permission plus the
   rank rules.
3. **Client-controlled values.** Request schemas are strict
   (`z.object().strict()`; unknown fields are refused). Clients never supply:
   - game outcomes or payouts (outcomes come from server seeds);
   - balances (computed from the ledger);
   - roles, account status or verification timestamps (registration and
     onboarding refuse such fields; tested);
   - published game mathematics (only the reference configuration can be
     activated).
4. **Cryptography and secrets.**
   - Passwords use scrypt with N=2^17. Session tokens are 256-bit, stored as
     SHA-256.
   - E-mail and SMS codes are stored as HMACs keyed from `IP_HASH_SECRET`.
     The signup-flow cookie and MFA challenges are HMAC-signed.
   - Provably-fair seeds are encrypted with AES-256-GCM and a key ring.
   - Backups are encrypted with GPG, with only the public key on the server.
   - The client bundle is scanned for server secret names and values. The
     repository is secret-scanned.
5. **Infrastructure run.** The Compose stack was built and started, and
   checked from outside:
   - users and capabilities;
   - read-only filesystems;
   - network isolation;
   - headers and CSP;
   - logs;
   - fail-closed start-up;
   - the backup → restore → reconciliation cycle.

## Defects found and fixed in this pass

| # | Severity (CVSS-style judgement) | Finding | Fix | Regression evidence |
|---|---|---|---|---|
| 1 | High | **Password-reset tokens in proxy logs.** nginx's default access log recorded the full request line, so `/reset-password?token=…` wrote a usable single-use secret to disk | Access log format with `$uri` (no query string), JSON, no cookies | Running stack: a request with `?token=SECRET…` → 0 log matches |
| 2 | High | **Backups could be unencrypted, and a failed encryption left a plaintext dump** | Encryption required by default; key checked before dumping; plaintext and partial outputs removed on any failure | Drill with a bad key → no files left; encrypted cycle restored and reconciled |
| 3 | Medium | **CSP allowed `'unsafe-inline'` scripts** (an XSS would execute) | Per-request nonce + `'strict-dynamic'` for pages; static policy for APIs and assets | `security.spec.ts`: nonce present, no `unsafe-inline`/`unsafe-eval`, fresh per request, zero violations through a full journey |
| 4 | Medium | **Single-person sensitive operations**: one admin could correct any balance, one owner could fund the house, grant any amount or switch staff MFA off | Four-eyes approvals; requester ≠ approver (code + CHECK); atomic single execution; expiry; immutable decided requests | `approvals.test.ts` (13 tests incl. concurrency, expiry, failure, demotion, immutability) |
| 5 | Medium | **Database reachable from the proxy container** (one default network) and app containers with a writable root filesystem and default capabilities | Internal `backend` network; read-only root, `cap_drop: ALL`, `no-new-privileges`, limits | Running stack: db has no outbound route, port not published, app uid 1000, CapEff 0, write to `/app` refused |
| 6 | Low | **Staff chip grants reached players on a cool-off or self-exclusion** (a play incentive during a break) | Grants refused during breaks; corrections still possible | `launch-hardening.test.ts` |
| 7 | Low | Auth endpoints shared the general proxy rate limit | Dedicated 2 req/s zone (burst 10) for `/api/auth`, e-mail and phone endpoints, plus the app's own limits | config validated with `nginx -t` (1.27) |

Found during this pass, in code written during this pass, and fixed before
release:
- A 451 SMTP deferral was classified as a permanent failure. It is now
  temporary (`mail.test.ts`).
- A Dockerfile `ARG` was declared after `FROM`, which broke the build.
- The backup service could run before migrations had finished.

## Controls confirmed (unchanged, already tested)

- **Authentication:**
  - generic sign-in errors and a dummy hash for unknown accounts;
  - lockout after 8 failures, with attempts reserved atomically;
  - optional TOTP for everyone; an owner policy can make it mandatory for
    staff;
  - recovery codes, and replay protection on time steps.
- **Sessions:** HttpOnly, SameSite=Lax, `__Host-` on HTTPS. Idle and absolute
  expiry. All sessions revoked on a password change or reset, and other
  sessions on an e-mail change.
- **CSRF:** Origin / Sec-Fetch-Site checks on every state-changing route, and
  JSON-only bodies.
- **Enumeration:** password recovery gives identical responses whatever the
  address. The verification flows act only on the browser's own pending
  registration. The register form still reveals a taken address (accepted;
  rate-limited per IP and per address).
- **Codes:** single use, 5 attempts, 10-minute expiry, cooldowns and hourly
  caps, concurrency-safe.
- **Integrity:**
  - an append-only ledger with database triggers;
  - a balanced-transaction check, gapless sequences and unique business
    keys;
  - an idempotency store;
  - risk decisions made before randomness is used;
  - 22 independent reconciliation checks.
- **Database privileges:** the runtime role owns nothing and cannot disable
  triggers. Readiness fails in production if the role is privileged.
- **SSRF:** no endpoint fetches a URL taken from a request. The outbound
  calls (SMTP, sports providers) use operator-configured hosts.
- **File uploads:** none. Avatars are built-in presets.
- **SQL injection:** queries use Drizzle with parameters; raw `sql` template
  tags bind every value; `LIKE` patterns are escaped.

## Residual risks and limitations

| Risk | Priority | Notes |
|---|---|---|
| No independent penetration test | P0 | Required before launch |
| Real e-mail provider untested | P0 | Registration is closed without one |
| Styles allow `'unsafe-inline'` | P2 | React style attributes. Low risk: no script execution |
| No durable mail queue | P2 | In-process retries; the player can resend |
| Registration reveals a taken e-mail | P2 | Usability trade-off, rate-limited |
| Audit log is append-only for the app, not tamper-proof | P1 | A database superuser can alter it. Ship logs/backups off-host for an external copy |
| Single-instance in-process scheduler | P2 | Advisory locks make it safe with several instances; a separate worker is optional |
| Phone and age verification need external providers | P1/P2 | Phone numbers stay unverified; age is self-declared |
| Dependencies | — | `npm audit`: 0 vulnerabilities on 2026-11-01. Dependabot is configured |

## Addendum — cashier, verification and support (2026-11-02)

New attack surface reviewed for the sandbox cashier, identity verification and support
pass ([payments.md](payments.md)), with the test that covers each control:

| Surface | Control | Test |
|---|---|---|
| Wallet credit from a browser "success" | Only a verified settlement webhook credits; the return page only reads the status | `payments.test.ts` (deposit credited only after settlement), e2e `cashier.spec.ts` A |
| Forged / tampered / replayed webhooks | HMAC over the raw body (constant-time), ±5-minute timestamp, event-id de-duplication under an advisory lock and a unique index; rejected deliveries logged and inert | `payments.test.ts` (forged, tampered, stale, replay, concurrent duplicates) |
| Client-chosen money fields | Strict schemas refuse `credited`, `fee`, `status`; the server computes fees, bonuses and limits | `payments.test.ts` (API strict bodies) |
| Over-withdrawal by racing requests | Wallet row lock; amount held at request time | `payments.test.ts` (concurrent requests) |
| Insider abuse | Nobody decides their own withdrawal, verification, ticket or flag; two different approvers above the threshold (application check and DB constraints); staff cannot credit a deposit by hand; every decision audited | `payments.test.ts`, `kyc-support-vip.test.ts` |
| Silent ledger manipulation | Three new reconciliation checks; fault injection proves detection | `payments.test.ts` (tamper test) |
| Malicious uploads | Content sniffing (JPEG/PNG/PDF only), active-content PDFs refused, 5 MB cap, safe names, random keys outside `public/`, mode 600, attachment download with `nosniff` and a sandbox CSP | `kyc-support-vip.test.ts` |
| Document / attachment IDOR | Owner or permissioned staff only; 404 otherwise; internal-note attachments hidden from players | `kyc-support-vip.test.ts` |
| CSRF on multipart uploads | Same-origin check (Origin / Sec-Fetch-Site) on every state change; the webhook alone is exempt and signature-authenticated | `payments.test.ts`, `platform-security.test.ts` |
| Sensitive data in e-mail | Notifications never carry passwords or support message content | `kyc-support-vip.test.ts` |

Defect found and fixed: dialogs opened inside cards were clipped by the card's
`backdrop-filter` containing block (covered buttons on large screens); the modal now
renders through a portal.

Residual risks: no virus scanning of uploads; local-disk upload storage (single instance);
no automated KYC/AML; the sandbox webhook secret must be strong and private in any
deployment where `PAYMENTS_MODE=sandbox`. None of this is a live-payments review: a live
provider integration needs its own penetration test.
