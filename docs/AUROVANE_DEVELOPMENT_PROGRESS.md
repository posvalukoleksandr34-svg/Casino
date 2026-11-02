# Aurovane development progress — casino platform pass

This log covers the "complete casino platform" pass, which started on 2026-11-02. It
continues `docs/AUTONOMOUS_DEVELOPMENT_PROGRESS.md`, which covers batches 1–13: the design
system, game stages and slots. Each batch is committed with its test results.

**Boundaries that hold throughout.**
- Every balance, top-up, bonus, wager and payout is virtual credits. Credits have no
  monetary value and cannot be bought, withdrawn, transferred or exchanged.
- No payment provider, card form, bank, crypto or cash-out is connected or imitated.
- Outcomes and balances are decided on the server only.

## Audit (before changes)

Already in place and kept:
- **Money:**
  - one wallet per player on a double-entry ledger, with strict reconciliation (22
    checks before this pass; 24 with the two added in P1);
  - idempotent rounds, server-authoritative games, a stake reserved before the outcome,
    settlement exactly once, and exactly-once refunds on void;
  - responsible-play limits enforced on the server.
- **Admin:** users, restrictions (suspend), chip grants and adjustments with four-eyes
  approval, game configuration, round inspection and void, audit log, security events,
  reconciliation, risk, health and sports.
- **Games:** 9 table and instant games and 5 slots, provably fair; the lobby has search,
  categories, favourites and recently played.

Missing, and addressed in this pass:
- campaigns and promo codes;
- bonus balance and wagering progress;
- a cashier;
- a promotions page;
- levels and leaderboards;
- a live feed;
- a casino-style home page and navigation;
- admin campaign management.

## Decisions

- **Bonus balance without a second wallet.**
  - Claimed bonus credits sit in one system account, `BONUS_LOCKED`. The player still has
    exactly one wallet.
  - A bonus is released to the wallet when the stakes settled since the claim reach its
    wagering requirement. It returns to promotions on expiry or forfeit.
  - Reconciliation proves `BONUS_LOCKED` = the sum of active claims, and that every bonus
    transaction has exactly the right postings.
- **Moderate defaults.** The welcome offer is 100% of the starting credits, up to 20,000,
  wagered ×1, with 30 days to use it. Without withdrawals, a high wagering multiple would
  only push play volume. Admins can configure campaigns, within the database limits
  (×20 at most).
- **No payment imitation.** The cashier's "top-up" is the existing free daily allocation,
  presented as a step-by-step flow. It is labelled free virtual credits everywhere and
  never asks for financial details.

## Batches

### P1. Bonus engine (done)

- **Migration `0012_promotions.sql`** (additive only):
  - account type `BONUS_LOCKED`;
  - transaction types `BONUS_CLAIMED`, `BONUS_RELEASED`, `BONUS_FORFEITED`;
  - table `bonus_campaigns` (welcome or promo code, match % or fixed amount, cap, wagering
    multiple, expiry, account-age eligibility, schedule, claim cap) with CHECK
    constraints;
  - table `bonus_claims`: unique per player and campaign; at most one active per player;
    a guard trigger keeps terms immutable, lets progress only grow, never reopens a
    closed claim, and blocks deletion and truncation.
- **Service** (`src/server/promotions/campaigns.ts`):
  - claim by welcome-offer id or promo code (case-insensitive);
  - eligibility: active, scheduled, account age, account status, claim cap, not
    self-excluded and not in cool-off;
  - wagering is counted inside the settlement transaction of every casino round; expired
    claims never progress;
  - release, forfeit, and an expiry job every 5 minutes.
  - Lock order is the platform's: the player's wallet, then the campaign or claim row,
    then system accounts by rank (`BONUS_LOCKED` is rank 7).
- **APIs:** `GET /api/promotions`, `POST /api/promotions/claim` (promo-code attempts are
  rate-limited to 10 per 10 minutes), `POST /api/promotions/forfeit`,
  `GET /api/wallet/summary` (available, reserved in play, locked bonus, lifetime totals,
  all from the ledger).
- **Reconciliation:** two new checks, `bonus_locked_matches_active_claims` and
  `bonus_claims_match_ledger`.
- **Tests:** `tests/integration/promotions.test.ts`, 10 tests:
  - welcome match, locking, progress and release;
  - a concurrent triple claim (exactly one succeeds);
  - eligibility: account age, cool-off;
  - promo codes: case, per-player, cap, one active at a time;
  - zero-wagering immediate release; ended and inactive codes;
  - forfeit; expiry (no progress after the deadline);
  - an interactive round counts once, at settlement;
  - database guards;
  - injected ledger faults caught by both new checks.
- **Results:** integration 316 passed (33 files); unit 354 passed; lint clean.

### P2. Cashier, promotions, navigation, casino home page, live feed (done)

- **Cashier (`/wallet`).** Sections:
  - **Overview:** available credits, credits in play (open rounds and predictions),
    locked bonus, and lifetime totals (received, wagered, won, refunded), all from the
    ledger via `walletSummary`.
  - **Free top-up:** a three-step flow, choose → review → receipt, for the existing
    daily free allocation. The review says "Free — nothing to pay" and "Payment details:
    none needed". The flow has no input fields.
  - **Bonus:** the active bonus with a progress bar, or the welcome offer.
  - **Transactions.**
  - **Account activity.**
- **Promotions (`/promotions`).**
  - Signed in: the active bonus with progress and Forfeit, welcome offers with their
    eligibility, promo-code entry, and a history of claims and simple grants.
  - Signed out: the welcome offer with a call to register.
- **Navigation.**
  - Header: Casino, Sports, Promotions, Fairness, Responsible play.
  - Account menu: Profile, Cashier, Bonuses, Transactions, Game history, My predictions,
    Statistics, Settings, Rules & odds.
  - Phone tab bar: Casino, Sports, Bonuses, Wallet, Profile.
- **Home page (`/`).**
  - A hero for guests (join, welcome offer) and for players (welcome back, balance).
  - Search into the lobby, category chips, and three promotional banners.
  - Rows: continue playing, popular this week (aggregate round counts only), and new
    games.
  - The live feed, the live roulette table, and trust and responsible-play cards.
- **Live feed.** `GET /api/live` is server-sent events (`?once=1` returns JSON). It
  carries players online (distinct users with a session active in the last 5 minutes),
  notable wins of at least 5× in the last 24 hours, and the latest table spin.
  - One snapshot is shared and cached for 4 seconds; at most 500 streams per process; 60
    connections per minute per address.
  - Names appear only with the new opt-in preference "Show my name on leaderboards and
    the live feed" (off by default), otherwise "A player". No round ids or balances.
- **Labels.** The signup grant is now "Starting credits" and the daily one "Free daily
  top-up"; the transaction type is shown as "Free credits". Activity labels are shared,
  with the new bonus events.
- **Tests.**
  - New `tests/e2e/platform.spec.ts`, 3 tests:
    - claim → play → wagering progress and locked credits in the cashier; repeat claim
      refused;
    - free top-up: refused above the threshold; three steps; no input fields; receipt;
      history;
    - live stream and JSON shape.
  - `player-journey` updated for the new labels.
  - Results: 5 passed (platform and player-journey). Lint clean.

## Next

- P3: levels, leaderboards, live feed, admin campaign management.
- P4: security review of the new endpoints, end-to-end journeys, full verification.
