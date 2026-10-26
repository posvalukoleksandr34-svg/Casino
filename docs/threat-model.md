# Threat model

Method: STRIDE over the main assets and trust boundaries, followed by controls, residual
risk and a remediation checklist. Performed before hardening; updated with test evidence.

## Assets
Ledger integrity (balances, stakes, payouts) · game outcome integrity · server seeds ·
session tokens · password hashes · personal data (e-mail) · admin capabilities · audit trail.

## Trust boundaries
Browser ↔ API (untrusted input) · API ↔ PostgreSQL (application role) · staff ↔ admin API ·
operator infrastructure (env secrets, DB superuser).

## Threats and controls

| # | Threat (STRIDE) | Attack | Controls | Evidence |
|---|---|---|---|---|
| T1 | Tampering — stake | Modify amount/selection, negative or fractional stake | Strict Zod schemas (unknown keys rejected), integer minor units, server recomputes stake, risk limits | API/e2e tests reject `-5`, `1.5`, `0`, extra keys |
| T2 | Tampering — result | Submit an outcome or payout field | Outcomes only from server RNG; schemas are `.strict()`; no client-supplied results anywhere | API test `client cannot inject an outcome` |
| T3 | Repudiation / duplication | Double-submit or replay a wager or payout | `Idempotency-Key` stored in the same transaction; unique ledger business keys; `payouts.round_id` unique | concurrency + replay tests |
| T4 | Replay of sessions | Stolen cookie reused | HttpOnly, SameSite=Lax, `Secure` + `__Host-` on HTTPS; idle (2 h) and absolute (24 h) expiry; revocation on logout/password change/suspension; tokens stored hashed | auth tests |
| T5 | Race conditions | Parallel wagers to overdraw, parallel claims | Row locks (wallet, house), deterministic lock order, non-negative CHECK, unique claim keys | 20-way parallel wager test |
| T6 | SQL injection | Crafted input in queries | Parameterised queries only (Drizzle `sql` templates); no string-built SQL with user data | code review; reconciliation SQL has no user input |
| T7 | XSS | Script in username/descriptions | React escaping; no `dangerouslySetInnerHTML`; username regex; CSP `script-src 'self'` (+inline needed by Next), `object-src 'none'`, `frame-ancestors 'none'` | headers verified in curl output |
| T8 | CSRF | Cross-site POST with ambient cookie | Origin/`Sec-Fetch-Site` check on every write, JSON-only bodies, SameSite cookie | API + e2e tests |
| T9 | Brute force | Password guessing, incl. many parallel guesses | scrypt N=2¹⁷; per-IP rate limit (20/5 min; without a trusted client IP all clients share one bucket); account lock after 8 failures (15 min) with each attempt **reserved atomically before verification** — parallel requests cannot exceed 8 checked passwords (previously 24 parallel guesses were all checked); generic errors; dummy hash for unknown accounts (timing) | `password-recovery.test.ts` (parallel lockout) |
| T10 | Enumeration | Probe e-mails via reset/login | Identical reset responses for every address (they state only the deployment's delivery capability); everything that depends on the account — lookup, token write, audit, e-mail — runs after the response (previously the token write was awaited for existing accounts only, a measurable timing signal); silent per-address throttle; per-IP limits on login (20/5 min) and reset requests (5/15 min). Residual: a locked account answers `ACCOUNT_LOCKED`; registration answers "already exists" for a taken e-mail (rate-limited 10/h per IP; closing it needs e-mail verification, not implemented) | `password-recovery.test.ts` (response does not wait for a blocked token write), `auth-hardening.test.ts` (route-level rate limits) |
| T11 | Privilege escalation | Player calls admin API; staff self-promotion | Server-side RBAC on every admin route and page (404 for pages); no self role/status change; least-privilege matrix | API/e2e/admin tests |
| T11b | Account-state races | A wager or action committed after the account was suspended or deleted (session checked only on arrival); an open round orphaned by a concurrent deletion; an old reset link undoing a password change | Account status re-checked under the wallet lock in every wager and action; deletion takes the user row and wallet locks in the wager's order and refuses with open rounds; password change invalidates outstanding reset links; production refuses `SCRYPT_LOG_N` < 17 | `financial-integrity.test.ts`, `auth-hardening.test.ts`, `env.test.ts` |
| T12 | Unauthorised config change | Lower edge, raise limits silently | Permission checks; configs versioned & immutable; non-positive edge refused; mandatory reason; audit with before/after | admin tests |
| T13 | Secret leakage | Seeds/keys in responses or logs | Seeds encrypted at rest (AES-GCM, key rotation); never serialised while active; logger redacts `seed|token|password|secret|cookie|session|hash`; env validation; no secrets in client bundle | API test checks response; crypto tests |
| T14 | Outcome prediction | Learn the server seed early | Seed revealed only on rotation; rotation refused while a round on it is open | fairness tests |
| T15 | Biased mapping | Modulo bias, float bias | Rejection sampling; 52-bit floats; statistical tests | rng + statistical tests |
| T16 | API abuse / DoS | Flood wagers, huge bodies, spoofed client IPs | Per-user and per-IP rate limits (shared in DB), 64 KB body cap, statement timeout 15 s, pool limits; `X-Forwarded-For` honoured only through `TRUST_PROXY_HOPS` trusted proxies, and the provided nginx configs overwrite it (spoofed headers previously bypassed per-IP limits) | rate-limit + `client-ip` tests |
| T17 | Rounding errors | Fractional chips accumulate | Integer arithmetic; multiplications in BigInt; floor rounding toward the house < 1 minor unit; never in favour of fabricating money | money tests |
| T18 | Inconsistent game/ledger state | Crash between steps | Single transaction; deferred balance check; reconciliation (17 checks, owner-aware posting verification) | fault-injection + tamper tests |
| T19 | Insider / compromised-app tampering | Edit ledger/audit rows or balances in SQL | Least-privilege runtime role `casino_app` (owns nothing; insert-only on history; no TRUNCATE/TRIGGER/TEMP/CREATE); balance guard requires the SECURITY DEFINER posting trigger (a session flag alone used to suffice); append-only triggers; reconciliation detects edits even with triggers disabled; readiness fails in production on a privileged role | `privileges.test.ts`, tamper test |
| T20 | Operator manipulation of a player | Change odds for a specific player | Risk engine has no player identity/history inputs; config is global and audited; outcomes from committed seeds | code structure, fairness tests |
| T21 | Clickjacking | Frame the UI | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | headers |
| T22 | Dependency vulnerabilities | Vulnerable packages | Pinned exact versions; per-advisory review incl. Next's vendored RSC runtime and sharp (`docs/dependency-security.md`); unused image optimiser disabled; CI `npm audit --audit-level=moderate` | `npm audit`, CI |
| T23 | Delayed settlement | Non-expiring rounds starve the expiry queue so busted/finished Crash rounds stay open | Explicit per-round `expires_at` from the engine; due-only queue with partial index; failure backoff; overdue check in reconciliation | `expiry.test.ts` |
| T24 | Timing manipulation / races | Lock contention changes a crash cash-out price or lets a settlement pre-empt an in-time cash-out | Receipt time taken before authentication and rate limiting; ordering decided under the wallet and round locks with the database clock; no settlement by time before end + 1 s (`action-timing.ts`); late requests never change state before then. Client timestamps never used. Residual: a request whose processing exceeds the 1 s grace is settled by time (counted and logged) | `crash-ordering.test.ts`, `action-timing.test.ts`, `audit-regressions.test.ts` |
| T25 | Default credentials | Seeded staff accounts with a published password on a public server | Seed refuses production / non-local targets, no built-in passwords; Compose and production config fail closed on missing/default secrets | `seed-plan.test.ts`, `env.test.ts` |

## Residual risks and remediation checklist

- [x] Run the app with a dedicated DB role without table ownership or trigger privileges; migrations under a separate owner role (migration 0004, `docs/operations.md` §4).
- [ ] **(operator)** Put the app behind a TLS-terminating proxy with a real certificate; set `APP_URL` to the HTTPS origin and `TRUST_PROXY_HOPS` (template: `deploy/nginx-tls.conf`).
- [ ] **(operator)** Store `SEED_ENCRYPTION_KEY` / `IP_HASH_SECRET` in a secret manager; rotate the seed key yearly (supported via `SEED_ENCRYPTION_KEYS_PREVIOUS`).
- [ ] Replace `'unsafe-inline'` in `script-src` with a nonce-based CSP (Next.js middleware nonce).
- [x] E-mail delivery for password resets (SMTP transport; honest "unavailable" state without a provider). **(operator)** configure a provider.
- [ ] E-mail address verification at registration (not implemented).
- [ ] Optional TOTP 2FA, mandatory for staff roles (not implemented).
- [ ] **(operator)** Ship logs/metrics to a central system; alert on CRITICAL alerts and reconciliation mismatches.
- [x] Dependency scanning in CI (`npm audit`); [ ] external penetration test.
- [ ] Independent RNG/game certification before any regulated use (see compliance checklist).
