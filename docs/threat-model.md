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
| T9 | Brute force | Password guessing | scrypt N=2¹⁷; per-IP rate limit (20/5 min); account lock after 8 failures (15 min); generic errors; dummy hash for unknown accounts (timing) | auth tests |
| T10 | Enumeration | Probe e-mails via reset/login | Identical responses; reset always 200 | auth tests |
| T11 | Privilege escalation | Player calls admin API; staff self-promotion | Server-side RBAC on every admin route and page (404 for pages); no self role/status change; least-privilege matrix | API/e2e/admin tests |
| T12 | Unauthorised config change | Lower edge, raise limits silently | Permission checks; configs versioned & immutable; non-positive edge refused; mandatory reason; audit with before/after | admin tests |
| T13 | Secret leakage | Seeds/keys in responses or logs | Seeds encrypted at rest (AES-GCM, key rotation); never serialised while active; logger redacts `seed|token|password|secret|cookie|session|hash`; env validation; no secrets in client bundle | API test checks response; crypto tests |
| T14 | Outcome prediction | Learn the server seed early | Seed revealed only on rotation; rotation refused while a round on it is open | fairness tests |
| T15 | Biased mapping | Modulo bias, float bias | Rejection sampling; 52-bit floats; statistical tests | rng + statistical tests |
| T16 | API abuse / DoS | Flood wagers, huge bodies | Per-user and per-IP rate limits (shared in DB), 64 KB body cap, statement timeout 15 s, pool limits | rate-limit test |
| T17 | Rounding errors | Fractional chips accumulate | Integer arithmetic; multiplications in BigInt; floor rounding toward the house < 1 minor unit; never in favour of fabricating money | money tests |
| T18 | Inconsistent game/ledger state | Crash between steps | Single transaction; deferred balance check; reconciliation (13 checks) | fault-injection + tamper tests |
| T19 | Insider tampering | Edit ledger/audit rows in SQL | Append-only triggers; balance only via entries; reconciliation detects edits even with triggers disabled; recommend non-owner app role | tamper test |
| T20 | Operator manipulation of a player | Change odds for a specific player | Risk engine has no player identity/history inputs; config is global and audited; outcomes from committed seeds | code structure, fairness tests |
| T21 | Clickjacking | Frame the UI | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | headers |
| T22 | Dependency vulnerabilities | Vulnerable packages | Pinned exact versions; `npm audit` clean at build (patched Next/Zod/PostCSS) | `npm audit` |

## Residual risks and remediation checklist

- [ ] Run the app with a dedicated DB role without table ownership or trigger privileges; keep migrations under a separate owner role.
- [ ] Put the app behind a TLS-terminating proxy; set `APP_URL` to the HTTPS origin (enables `Secure`, `__Host-` cookie and HSTS) and `TRUST_PROXY_HOPS`.
- [ ] Store `SEED_ENCRYPTION_KEY` / `IP_HASH_SECRET` in a secret manager; rotate the seed key yearly (supported via `SEED_ENCRYPTION_KEYS_PREVIOUS`).
- [ ] Replace `'unsafe-inline'` in `script-src` with a nonce-based CSP (Next.js middleware nonce).
- [ ] Add e-mail delivery for password resets (currently development console only) and e-mail verification.
- [ ] Add optional TOTP 2FA, mandatory for staff roles.
- [ ] Ship logs/metrics to a central system; alert on CRITICAL alerts and reconciliation mismatches.
- [ ] External penetration test and dependency scanning in CI.
- [ ] Independent RNG/game certification before any regulated use (see compliance checklist).
