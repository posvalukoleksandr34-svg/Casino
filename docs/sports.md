# Sports prediction simulator

Pre-match football 1X2 predictions with **virtual chips**. Chips have no monetary value and
cannot be bought, sold, transferred or withdrawn; this is not real-money betting and the
repository contains no payment, deposit or withdrawal code.

Code: `src/engine/sports` (pure maths), `src/server/sports` (placement, settlement, sync,
providers, read models), `src/app/sports` and `src/components/sports` (UI),
`src/app/api/sports`, `src/app/api/admin/sports`. Migration: `migrations/0006_sports.sql`.
Tests: `tests/unit/sports.test.ts`, `tests/integration/sports.test.ts`, `tests/e2e/expansion.spec.ts`.

## Modes

| `SPORTS_MODE` | Fixtures and results | Odds | Credentials |
|---|---|---|---|
| `demo` (default) | fictional teams and competitions, results simulated from committed seeds | published house model, 6 % margin | none |
| `live` | football-data.org (`FOOTBALL_DATA_API_KEY`) | The Odds API (`THE_ODDS_API_KEY`) | both required |
| `off` | — | — | — |

Demo and live data never mix: each event carries `is_demo`, the board shows only the current
mode's events, and a placement on an event of the other mode is rejected. In `live` mode
without both keys the section says it is unavailable and offers **no** events (it never falls
back to demo data presented as real); production refuses to start in that state.

Every demo event is labelled "Demo" on the board and the event page; the page header explains
that teams are fictional, odds come from a house model and results are simulated.

## Lifecycle

| Status | Meaning | Money |
|---|---|---|
| Draft | a pick in the browser's slip (not stored) | none |
| `REJECTED` | refused at placement: market suspended/closed, event started, selection not offered, live odds stale, or price changed (and the player did not accept changes) | none; the reason is stored |
| `ACCEPTED` | placed; stake held in the `SPORTS_IN_PLAY` escrow | wallet −stake, escrow +stake |
| `SUSPENDED` | the event is suspended or postponed; awaiting resumption, a result or a void | none |
| `WON` / `LOST` | settled to a result | escrow −stake; house +stake −return; wallet +return |
| `VOIDED` | event cancelled, abandoned, awarded off the pitch, postponed > 48 h, or voided by an operator | escrow −stake; wallet +stake |

A ticket stores: user, slip id, idempotency key and leg, event/market/selection ids, the
selection code, **the market version and odds at placement (snapshot)**, integer stake,
potential return `⌊stake × odds⌋`, status, rejection reason, total credited (`payout`),
settlement source and version, and timestamps.

## Placement (`POST /api/sports/tickets`)

One request places a slip of 1–10 single predictions (each ticket settles on its own; there
are no accumulators). It requires a session, a same-origin request and an `Idempotency-Key`;
the same key with the same slip returns the original answer, the same key with a different
slip is refused. In one transaction:

1. platform kill switch (`new_rounds_enabled`), account status, wallet lock;
2. per selection, under a shared lock on its market: market `OPEN`, before kick-off, odds
   offered, live odds confirmed within `SPORTS_ODDS_MAX_AGE_MINUTES`, and the server price
   equal to the price the client saw unless `acceptOddsChanges` is true — **the client's odds
   are never used to price a ticket**;
3. per-ticket limits (stake 0.10–1,000 chips; potential return ≤ 100,000 chips);
4. responsible play (`assertCanWager`: cool-off, self-exclusion, session, wager and loss
   limits — sports stakes and returns count toward the same limits as casino rounds);
5. under the house-bankroll lock (`sports_risk_snapshot`): per-event liability ≤ 5,000,000
   chips, total open exposure (casino rounds + sports) ≤ the platform cap, house reserve
   after the worst case ≥ the minimum reserve, and the player balance cap;
6. tickets inserted; one `SPORTS_STAKE` ledger transaction per accepted ticket.

## Settlement

Results are stored as versions in `sports_result_log` (append-only): `RESULT` (first score),
`CORRECTION` (a later, different score) or `VOID`. Repeating the current result is a no-op.
Each ticket is then brought up to the event's latest version in its own transaction (wallet
lock first, then the ticket row), recording one `sports_settlements` row per (ticket, version)
— a unique key, so re-running settlement cannot pay twice.

* First settlement releases the escrow under the ledger key `sports:<ticket>:release`, so a
  stake is released — and a void refunded — **at most once**.
* **Correction policy (credit-only).** Under a corrected result each ticket's entitlement is
  recomputed (won: potential return; void: stake; lost: 0). If it exceeds everything credited
  so far, the difference is credited (`SPORTS_CORRECTION`, house → wallet). If it is lower,
  **nothing is taken back**. A ticket's status shows the latest result; its `payout` is the
  total credited, which equals the highest entitlement it ever had. Every version is listed
  on the event page and every operator correction is audited with its reason.
* A settlement job (`sports-sync`, every minute) settles due demo events, closes markets at
  kick-off and catches up any ticket behind its event's version (e.g. after a crash).

## Demo model and fairness

Each fictional team has attack and defence ratings (arbitrary model inputs, `src/engine/sports/demo-data.ts`).
For a fixture, expected goals are λ_home = 1.45 × attack_home × defence_away and
λ_away = 1.15 × attack_away × defence_home. Home and away goals are independent Poisson
variables tabulated for every score 0–0 … 9–9 as **integer weights** (scale 10⁹); the table is
stored with the event and shown on the event page.

* Price: `odds = ⌊100 · W · 10⁴ / (W_outcome · (10⁴ + 600))⌋ / 100`, i.e. 1 ÷ (P × 1.06)
  rounded down. Every selection's long-run return is P × odds ≤ 1/1.06 = **94.34 %**
  (checked with exact integer arithmetic for every demo pairing). Prices below 1.01 would
  be withheld (none occur with the shipped ratings).
* Result: when the fixture is created the server draws a 32-byte secret seed, stores it
  encrypted (AES-256-GCM, the same key ring as casino seeds) and publishes its SHA-256 before
  any prediction can be placed. Ten minutes after kick-off it draws
  `u = nextInt(W)` from the HMAC-SHA256 stream (server seed = the event seed, client seed =
  `sports-demo-<event id>`, nonce 0) and picks the scoreline at `u` in the cumulative table,
  then reveals the seed. The event page recomputes the score in the browser and checks the
  hash. Fixtures are scheduled every 20 minutes, 24 hours ahead.

## Live providers

* **football-data.org v4** (`GET /v4/matches?competitions=…&dateFrom=…&dateTo=…`, header
  `X-Auth-Token`): fixtures 3 days back to 7 days ahead. Status mapping: SCHEDULED/TIMED →
  scheduled; IN_PLAY/PAUSED → live (market closed); FINISHED → result (regular-time score:
  `score.regularTime` when the match went beyond 90 minutes, otherwise `score.fullTime`);
  POSTPONED/SUSPENDED → suspended (postponed > 48 h → void); CANCELLED/AWARDED → void;
  unknown → suspended. Requests are spaced ≥ 6.5 s (free tier: 10/minute).
* **The Odds API v4** (`GET /v4/sports/{sport}/odds?regions=…&markets=h2h&oddsFormat=decimal`,
  `apiKey` query parameter): the configured bookmaker's (or the first bookmaker's) h2h prices;
  `Draw` is the draw outcome; prices are rounded **down** to 0.01. Remaining quota
  (`x-requests-remaining`) is shown to operators.
* **ID mapping**: odds events are matched to fixtures by kick-off within ±3 hours and both
  normalised team names (accents, punctuation and common suffixes removed); the match is
  stored in `sports_external_refs`. Ambiguous or missing matches are ignored (prices are never
  guessed).
* **Freshness and caching**: provider data is cached in the database; providers are called at
  most every `SPORTS_SYNC_MINUTES`. Each odds refresh stamps the market's `odds_updated_at`;
  a market not confirmed within `SPORTS_ODDS_MAX_AGE_MINUTES` shows "odds out of date" and
  rejects predictions. A changed price creates a new market version and odds-history rows.
* **HTTP**: 8 s timeout, two retries with backoff on network errors, 5xx and 429 (honouring
  `Retry-After` up to 30 s), redirects refused, payloads validated with Zod. Error messages
  and logs carry the provider and URL path only — never the query string or headers where
  keys live; `sports_provider_status` stores the last success and a sanitised last error.
* **Not scraping**: only the two documented APIs are called, with the operator's own keys.

**Not verified against the real services.** The adapters follow the providers' public v4
documentation and are tested with synthetic payloads; this environment could not reach the
providers. Before enabling `live`, run them against real responses (both providers' terms,
quotas and coverage apply) and check the status and score mapping.

## Reconciliation

Five checks join the existing seventeen (`src/server/jobs/reconciliation.ts`):

* `sports_escrow_matches_open_tickets` — escrow = stakes of ACCEPTED/SUSPENDED tickets;
* `sports_ticket_ledger` — per ticket: rejected tickets moved nothing; one stake transaction
  (wallet −stake, escrow +stake); open tickets nothing more; settled tickets exactly one
  escrow release and in total wallet = payout − stake, escrow = 0, house = stake − payout;
* `sports_settlements_consistent` — payout = Σ credited = max entitlement; status and version
  are the latest settlement's; entitlements match outcomes; credits link to the ticket's ledger
  transactions;
* `sports_transactions_linked` — every sports transaction belongs to a ticket of the same player;
* `sports_results_settled` — no ticket lags its event's result by more than 10 minutes.

`risk_snapshot` (used by every casino wager) includes open sports liability, so casino and
sports exposure share one cap and one reserve check.

## Operators

`/admin/sports` (staff) shows open liability, provider health and recent events. Users with
`sports:manage` (risk managers, admins) can suspend/resume an event, record or correct a
result (only after kick-off) and void an event; each action requires a reason and is written
to `admin_actions` and the audit log in the same transaction.

## Limitations

* Singles only (no accumulators), one market (1X2), football only.
* Live mode is untested against the real providers (see above); provider terms and costs are
  the operator's responsibility.
* Live results are trusted from one provider; there is no second-source confirmation. The
  credit-only correction policy bounds the cost of a provider error to the house.
* Demo match "duration" is 10 minutes of wall-clock time so results arrive quickly.
