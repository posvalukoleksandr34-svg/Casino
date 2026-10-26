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
| 404 | `NOT_FOUND` | Unknown resource (or not yours) |
| 409 | `CONFLICT` / `IDEMPOTENCY_CONFLICT` | State conflict, duplicate key misuse |
| 422 | `INSUFFICIENT_FUNDS` / `RISK_LIMIT` / `GAME_RULE` | Wager rejected before the round started |
| 423 | `ACCOUNT_LOCKED` | Too many failed sign-ins |
| 429 | `RATE_LIMITED` | `Retry-After` header set |
| 503 | `GAME_UNAVAILABLE` | Game suspended or platform kill switch |
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
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, username, password, ageConfirmed: true, termsAccepted: true}` | 201, sets cookie; welcome chips; 10/h per IP |
| POST | `/api/auth/login` | `{email, password}` | sets cookie; 20 / 5 min per IP; lockout after 8 failures |
| POST | `/api/auth/logout` | `{}` | revokes session |
| GET | `/api/auth/me` | — | `{user, balance}` or `{user: null}` |
| POST | `/api/auth/password/forgot` | `{email}` | always 200 (no enumeration) |
| POST | `/api/auth/password/reset` | `{token, password}` | revokes all sessions |
| POST | `/api/account/password` | `{currentPassword, newPassword}` | revokes other sessions |
| PATCH | `/api/account/preferences` | `{reducedMotion?, hideBalance?}` | |
| GET | `/api/account/export` | — | JSON download of all personal data |
| GET | `/api/account/activity` | — | security events |
| DELETE | `/api/account` | `{password, confirm: "DELETE"}` | anonymises; financial records retained |

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
| POST | `/api/rounds/:roundId/actions` | `{action}` + `Idempotency-Key` | interactive games |
| GET | `/api/rounds/active` | — | open rounds (recovery after reload) |
| GET | `/api/rounds?game&before&limit` | — | history |
| GET | `/api/rounds/:roundId` | — | detail incl. fairness inputs (server seed once revealed) |

Bet payloads per game are defined by the engine schemas, e.g.
* roulette `{"bets":[{"type":"straight","number":17,"amount":500},{"type":"red","amount":1000},{"type":"dozen","index":2,"amount":300}]}`
* dice `{"amount":1000,"target":4950,"direction":"under"}`

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
| GET | `/api/stats` | realised results per game |

## Admin (permission in brackets; all writes require `reason` and are audited)
| Method | Path | |
|---|---|---|
| GET | `/api/admin/overview` | [admin:access] KPIs, reserves, exposure, errors, alerts |
| GET | `/api/admin/analytics?days&series` | [analytics:read] actual vs theoretical, z-scores, daily series |
| GET | `/api/admin/users?q&limit&offset`, `/api/admin/users/:id` | [users:read] |
| POST | `/api/admin/users/:id/status` | [users:suspend] `{status, reason}` |
| POST | `/api/admin/users/:id/role` | [roles:manage] `{role, reason}` |
| POST | `/api/admin/users/:id/adjust` | [ledger:adjust] `{amount, reason, reversesTransactionId?}` + `Idempotency-Key` |
| GET | `/api/admin/rounds`, `/api/admin/rounds/:id` | [rounds:read] |
| POST | `/api/admin/rounds/:id/void` | [rounds:void] OPEN rounds only; full refund |
| GET | `/api/admin/games` | [admin:access] |
| POST | `/api/admin/games/:id/status` | [games:manage] |
| POST | `/api/admin/games/:id/config` | [games:manage] new immutable version; house edge must be > 0 |
| PUT | `/api/admin/games/:id/limits` | [risk:manage] |
| GET/PATCH | `/api/admin/platform` | [risk:manage] kill switch, exposure, reserve, caps, bonuses |
| POST | `/api/admin/house/fund` | [house:fund] + `Idempotency-Key` |
| GET | `/api/admin/audit` | [audit:read] |
| GET/POST | `/api/admin/alerts`, `/api/admin/alerts/:id/ack` | [system:read] / [system:operate] |
| GET/POST | `/api/admin/reconciliation` | [system:read] / [system:operate] run now |
| GET | `/api/admin/health` | [system:read] |

Role → permission matrix: `src/server/auth/rbac.ts`.
