# HTTP API

JSON over HTTPS. Authentication: an HttpOnly session cookie (`__Host-aurovane_session` on
HTTPS). All responses carry `X-Request-Id` and `Cache-Control: no-store`.

**State-changing requests** (POST/PUT/PATCH/DELETE) must
* come from the application's own origin (`Origin` checked; `Sec-Fetch-Site: cross-site` rejected),
* send `Content-Type: application/json` (bodies ≤ 64 KB, unknown fields rejected),
* for wagers and actions, send an `Idempotency-Key` header (8–100 chars `[A-Za-z0-9_-]`).
  Repeating a key returns the original response with `Idempotent-Replayed: true`; reusing
  it with a different body returns `409 IDEMPOTENCY_CONFLICT`.

**Errors** — `{"error": {"code", "message", "details", "requestId"}}`

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed input (`details.issues[]`) |
| 401 | `UNAUTHENTICATED` | No/expired session, wrong credentials |
| 403 | `FORBIDDEN` / `CSRF_REJECTED` / `RESPONSIBLE_GAMING` | Permission, cross-site request, player limit |
| 403 | `EMAIL_NOT_VERIFIED` | Sign-in with the right password before the e-mail code was entered (`details.next = "/verify-email"`; sets the signup-flow cookie) |
| 403 | `ONBOARDING_REQUIRED` | Signed in, profile step not completed (`details.next = "/onboarding"`); every route except those marked *onboarding* below |
| 404 | `NOT_FOUND` | Unknown resource (or not yours) |
| 409 | `CONFLICT` / `IDEMPOTENCY_CONFLICT` | State conflict, duplicate key misuse |
| 422 | `INSUFFICIENT_FUNDS` / `RISK_LIMIT` / `GAME_RULE` | Wager rejected before the round started |
| 423 | `ACCOUNT_LOCKED` | Too many failed sign-ins |
| 429 | `RATE_LIMITED` | `Retry-After` header set |
| 503 | `GAME_UNAVAILABLE` / `SERVICE_UNAVAILABLE` | Game suspended or platform kill switch; registration while no e-mail transport is configured |
| 500 | `INTERNAL` | Unexpected; no partial effects (transaction rolled back) |

Amounts are integers in minor units (100 = 1 chip).

## Public
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/health/ready` | DB, migrations, reference data (503 when degraded) |
| GET | `/api/metrics` | Prometheus text; `Authorization: Bearer $METRICS_TOKEN`. Optional: 403 for every request when no token is configured |
| GET | `/api/games` | Catalogue: status, config version, limits, theoretical RTP |
| GET | `/api/games/:gameId` | One game |

## Authentication & account

Registration journey and code rules: [onboarding.md](onboarding.md). Routes marked
*onboarding* are the only ones a signed-in player may use before completing the
profile step; every other route answers `403 ONBOARDING_REQUIRED` (optional-auth routes
treat such a session as signed out).
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, username, password, confirmPassword, ageConfirmed: true, chipsAcknowledged: true, termsAccepted: true}` | 201 `{status: "verification_required", next, sent, verification}`; creates a **pending** account (no session, wallet or chips) and e-mails a 6-digit code; sets the HttpOnly signup-flow cookie. 10/h per IP, 5/h per address. 409 with `details.field` for a taken username or e-mail; 503 when no e-mail transport is configured |
| GET | `/api/auth/verify-email` | — | Pending registration named by the flow cookie: `{verification: {email, delivery, sent, expiresAt, attemptsLeft, resendAvailableAt}}`; 401 without a valid cookie. Never the code |
| POST | `/api/auth/verify-email` | `{code}` | Correct code → activates the account once (wallet, seeds, limits, welcome chips), sets the session cookie, clears the flow cookie, `{verified, next: "/onboarding"}`. 400 `details.reason`: `incorrect` (with `attemptsLeft`), `too_many_attempts`, `expired`, `no_code`, `format`; 409 `already_verified`. 30 / 10 min per IP |
| POST | `/api/auth/verify-email/resend` | `{}` | New code (previous one stops working); 429 with `retryAfterSeconds` inside the 60 s cooldown or after 5 codes/hour |
| POST | `/api/auth/verify-email/change-email` | `{email}` | Corrects the pending address and sends a code there (same limits) |
| POST | `/api/auth/login` | `{email, password}` | sets cookie, `{user, onboardingRequired}`; 20 / 5 min per IP; lockout after 8 failures. With MFA on: 401 `MFA_REQUIRED` with `details.challenge` (valid 5 min) and no cookie. Unverified e-mail: 403 `EMAIL_NOT_VERIFIED`, flow cookie, a new code if none is usable |
| POST | `/api/onboarding` | `{firstName, lastName, dateOfBirth: "YYYY-MM-DD", countryCode, phoneRegion, phoneNumber, displayName?, avatar?}` | *onboarding*. Completes the profile step (18+ checked on the server, ISO 3166-1 alpha-2 country, phone stored as unverified E.164); 409 when already complete |
| GET · PATCH | `/api/account/details` | `{firstName?, lastName?, dateOfBirth?, countryCode?, phoneRegion?, phoneNumber?}` | Personal details; the date of birth can be set only when none is stored; a changed number stays unverified |
| GET · POST · DELETE | `/api/account/email` | POST `{email, password}` (or `{}` to resend) | *onboarding*. Pending e-mail change: start (code to the new address), resend, cancel |
| POST | `/api/account/email/confirm` | `{code}` | *onboarding*. Switches to the new address; other sessions and reset links revoked; old address notified |
| POST | `/api/auth/login/mfa` | `{challenge, code}` | TOTP or recovery code → sets cookie (session marked MFA-verified); 5 attempts / 5 min per account |
| GET | `/api/account/mfa` | — | `{enabled, recoveryCodesLeft, sessionVerified}` |
| POST | `/api/account/mfa/setup` · `/confirm` `{code}` · `/verify` `{code}` · `/disable` `{code}` | | set-up returns the secret and `otpauth://` URI once; confirm returns recovery codes once and signs out other sessions |
| POST | `/api/auth/logout` | `{}` | *onboarding*. Revokes the session and clears the signup-flow cookie |
| GET | `/api/auth/me` | — | *onboarding*. `{user (with onboardingPending), balance}` or `{user: null}` |
| POST | `/api/auth/password/forgot` | `{email}` | always 200 (no enumeration) |
| POST | `/api/auth/password/reset` | `{token, password}` | revokes all sessions |
| POST | `/api/account/password` | `{currentPassword, newPassword}` | *onboarding*. Revokes other sessions |
| PATCH | `/api/account/preferences` | `{reducedMotion?, hideBalance?}` | |
| GET | `/api/account/export` | — | *onboarding*. JSON download of all personal data, including profile details and the verification-code history (never codes) |
| GET | `/api/account/activity` | — | security events |
| DELETE | `/api/account` | `{password, confirm: "DELETE"}` | *onboarding*. Anonymises (including names, birth date, country, phone); financial records retained |

## Wallet
| Method | Path | Notes |
|---|---|---|
| GET | `/api/wallet` | balance, daily-bonus status |
| GET | `/api/wallet/transactions?before&limit&type` | ledger statement (keyset pagination by entry id) |
| POST | `/api/wallet/daily-bonus` | once per UTC day while balance below threshold |

## Games and rounds
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/games/:gameId/rounds` | `{bet}` + `Idempotency-Key` | 201 `{round, balance}` |
| POST | `/api/rounds/:roundId/actions` | `{action}` + `Idempotency-Key` | interactive games. Time-decided rounds (Crash) add `resolution` to the response; a late cash-out answers 422 `GAME_RULE` (`details.rule: ROUND_ENDED`) and changes nothing; a finished round answers 409 (`details.resolution: already_settled`) — `docs/math/crash.md` § Ordering |
| GET | `/api/rounds/active` | — | open rounds (recovery after reload) |
| GET | `/api/rounds?game&before&limit` | — | history |
| GET | `/api/rounds/:roundId` | — | detail incl. fairness inputs (server seed once revealed) |

Bet payloads per game are defined by the engine schemas, e.g.
* roulette `{"bets":[{"type":"straight","number":17,"amount":500},{"type":"red","amount":1000},{"type":"dozen","index":2,"amount":300}]}`
* dice `{"amount":1000,"target":4950,"direction":"under"}`
* limbo `{"amount":1000,"targetE2":250}` (target 2.50×)
* keno `{"amount":1000,"picks":[3,7,19,22,31]}` (1–10 distinct numbers from 1–40)
* plinko `{"amount":1000,"rows":16,"risk":"high"}` (rows 8/12/16; risk low/medium/high)
* hilo `{"amount":1000}`; actions `{"type":"guess","direction":"higher"|"lower"}`, `{"type":"skip"}`, `{"type":"cashout"}`

A round view: `{id, gameId, status, stake, payout, maxPayout, startedAt, settledAt, actionCount, state, fairness: {serverSeedHash, clientSeed, nonce, serverSeed|null}}`.
`state` is the game's client-safe view (secrets hidden while the round is open).

## Fairness, responsible play, statistics
| Method | Path | Body |
|---|---|---|
| GET | `/api/fairness` | active commitment, client seed, next nonce; revealed seeds |
| POST | `/api/fairness/rotate` | `{clientSeed?}` → reveals the old seed (409 while a round on it is open) |
| GET/PUT | `/api/responsible` | limits `{dailyLossLimit, weeklyLossLimit, dailyWagerLimit, sessionLimitMinutes, realityCheckMinutes}` (null = none) |
| POST | `/api/responsible/cool-off` | `{hours: 24 \| 72 \| 168 \| 720}` |
| POST | `/api/responsible/self-exclusion` | `{months: 6 \| 12 \| 60 \| null, confirm: "EXCLUDE"}` |
| GET | `/api/stats` | realised results per game (wins, losses, pushes, staked, returned, net) |
| POST | `/api/fairness/verify-round` | `{roundId}` → the server recomputes one of your settled rounds from its revealed seed and compares it with the stored result |

## Lobby, profile, achievements
| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/favorites` | `{favorites: gameId[], recent: [{gameId, lastPlayedAt}]}` |
| PUT / DELETE | `/api/favorites/:gameId` | idempotent; unknown or disabled games → 404 |
| PATCH | `/api/account/profile` | `{displayName?: string \| null, avatar?: presetId \| null}`; audited; *onboarding* |
| GET | `/api/achievements` | re-derives cosmetic badges from recorded facts and lists them |

## Sports predictions (virtual chips; see docs/sports.md)
| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/sports/events` | public; `{mode, upcoming[], recent[], favorites}` for the configured mode |
| GET | `/api/sports/events/:eventId` | public; market, provenance, demo fairness data, result history |
| POST | `/api/sports/tickets` | `{selections: [{selectionId, stake, oddsE2}], acceptOddsChanges?}` + `Idempotency-Key`; 201 `{slipId, tickets[], balance}`; refused picks come back as `REJECTED` with `rejectReason` and move no chips |
| GET | `/api/sports/tickets?status=open\|settled\|all&before&limit` | own tickets |
| GET | `/api/sports/stats` | own ticket counts, staked, returned, net |
| PUT / DELETE | `/api/sports/favorites/:kind/:refId` | `kind` = `team` or `competition` |

## Admin (permission in brackets; all writes require `reason` and are audited)
| Method | Path | |
|---|---|---|
| GET | `/api/admin/overview` | [admin:access] KPIs, reserves, exposure, errors, alerts (the `/admin` page uses the period dashboard in `src/server/admin/overview.ts`) |
| GET | `/api/admin/analytics?days&series` | [analytics:read] actual vs theoretical, z-scores, daily series |
| GET | `/api/admin/users?q&status&role&from&to&sort&dir&page&pageSize` | [users:read] `{rows, total, page, pageSize}`; e-mail masked and not searchable without users:pii |
| GET | `/api/admin/users/:id` | [users:read] detail incl. `allowed` actions for the caller; no secrets |
| POST | `/api/admin/users/:id/status` | [users:suspend] `{status: "ACTIVE"\|"SUSPENDED", reason}`; lower-ranked accounts only; suspension revokes sessions |
| DELETE | `/api/admin/users/:id/sessions` | [users:suspend] `{reason}` sign out everywhere |
| POST | `/api/admin/users/:id/role` | [roles:manage] `{role, reason}`; ADMIN/OWNER only by owners; never the last active owner |
| POST | `/api/admin/users/:id/grant` | [ledger:grant] `{amount (1…100,000,000 minor units), reason}` + `Idempotency-Key` → 201 `{transactionId, balance}`; retries replay (`Idempotent-Replayed: true`) |
| POST | `/api/admin/users/:id/adjust` | [ledger:adjust] `{amount, reason, reversesTransactionId?}` + `Idempotency-Key` → 201; retries replay |
| GET | `/api/admin/ledger?type&userId&transactionId&from&to&before&limit` | [ledger:read] `{rows, nextBefore}` |
| GET | `/api/admin/ledger/:id` | [ledger:read] transaction with entries |
| GET | `/api/admin/rounds`, `/api/admin/rounds/:id` | [rounds:read] |
| POST | `/api/admin/rounds/:id/void` | [rounds:void] OPEN rounds only; full refund |
| GET | `/api/admin/games` | [admin:access] |
| POST | `/api/admin/games/:id/status` | [games:manage] `{status, reason, confirmOpenRounds?}`; pausing with open rounds needs `confirmOpenRounds: true` (409 otherwise) |
| POST | `/api/admin/games/:id/config` | [games:manage] new immutable version; only the published reference configuration is accepted |
| PUT | `/api/admin/games/:id/limits` | [risk:manage] `{limits, reason}` within the hard bounds ([admin.md](admin.md#games)) |
| GET/PATCH | `/api/admin/platform` | [risk:manage] kill switch, exposure, reserve, caps, bonuses |
| POST | `/api/admin/house/fund` | [house:fund] (owner) + `Idempotency-Key`; retries replay |
| GET | `/api/admin/audit?action&actorId&actorName&resourceId&outcome&from&to&before&limit` | [audit:read] `{items, nextBefore}` |
| GET, POST | `/api/admin/security` | [security:manage] staff MFA overview; `{staffMfaRequired, reason}` |
| GET/POST | `/api/admin/alerts`, `/api/admin/alerts/:id/ack` | [system:read] / [system:operate] |
| GET/POST | `/api/admin/reconciliation` | [system:read] / [system:operate] run now |
| GET | `/api/admin/health` | [system:read] |
| GET | `/api/admin/sports/events/:id` | [admin:access] prices, predictions by selection, results, settlements, operator actions |
| POST | `/api/admin/sports/events/:id` | [sports:manage] `{action: "suspend"\|"resume"\|"void", reason}`, `{action: "result", home, away, reason}` (after kick-off; corrections only credit players) or `{action: "window", opensAt, closesAt, reason}` (ISO or null; close ≤ kick-off) |
| GET | `/api/admin/sports/events/:id/preview?home&away` or `?void=1` | [sports:manage] read-only settlement preview |
| POST | `/api/admin/sports/fixtures` | [sports:manage] demo mode: `{competitionId, homeId, awayId, kickoffAt, reason}`; priced by the demo model |

Role → permission matrix: `src/server/auth/rbac.ts`.
