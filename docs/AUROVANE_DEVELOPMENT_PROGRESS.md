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

### P3. Admin campaigns, levels, leaderboard (done)

- **Admin promotions (`/admin/promotions`).**
  - New permission `promotions:manage` for admins and owners; other staff can view the
    page.
  - Campaign list with claims, active claims, credits granted and released; the claims
    of each campaign (player, amount, wagering, status); a create form; pause, resume
    and end now.
  - Every change is an audited admin action with a reason.
  - A campaign's money terms (match %, fixed amount, cap, wagering multiple, expiry)
    are locked once anyone has claimed it. Claims fix their own terms anyway.
  - APIs: `GET/POST /api/admin/promotions`, `GET/PATCH /api/admin/promotions/:id`.
- **Levels (cosmetic, `src/server/users/levels.ts`).**
  - Experience: 2 XP per settled round, at most 30 rounds per UTC day (at most 60 XP a
    day); 40 XP per different game tried; 150 XP per achievement.
  - Level L+1 needs 50·L·(L+1) XP. Tiers: Bronze, Silver, Gold, Platinum, Diamond.
  - Derived from existing records: nothing new is stored. Levels unlock nothing.
  - Shown on the profile.
- **Leaderboard (`/leaderboard`).**
  - Two boards: best multiplier this week, and highest level.
  - Only opted-in players are named. The viewer sees their own standing privately.
  - No prizes, and no board for "most wagered" or "most played".
- **Navigation.** Leaderboard and Fairness appear in the header from 1280px and in the
  account menu and footer below that; header links never wrap. The footer gains
  Promotions and Leaderboard.
- **Fix.** The home-page cover collage was stacking because the cover's
  `position: relative` overrode `absolute`; each cover now sits in its own positioned
  wrapper.
- **Tests.**
  - Unit `levels` (thresholds, the daily cap, the permission matrix).
  - Integration `community-admin-promotions`, 5 tests:
    - the XP daily cap;
    - leaderboard privacy: hidden players are never shown to others and see only
      themselves;
    - the live feed: only opted-in names, no ids;
    - admin create (audited), claims list, terms locked after a claim, pause blocks
      claims;
    - invalid campaigns refused.
  - e2e `platform`: an owner creates a promo code in the back office, a player redeems
    it, and the leaderboard renders.
  - The accessibility (axe) and mobile sweeps now cover `/`, `/promotions` and
    `/leaderboard`.
  - The onboarding-gate test lists `/api/live` as an intended public route.
  - Results: unit 357 passed; integration 321 passed; e2e accessibility, mobile,
    platform, owner-admin and expansion 19 passed.

### P4. Security review, documentation, full verification

**Security review of everything added in this pass.**

- **Authentication.** Every player endpoint needs a session (401) and a completed
  profile.
- **CSRF.** The existing same-origin rules apply to every new write:
  - a foreign `Origin` → 403;
  - `Sec-Fetch-Site: cross-site` → 403;
  - JSON body only (a form cannot send it) → 400;
  - SameSite session cookie.

  Requests with no `Origin` (non-browser clients) are allowed by design, as before.
- **Authorisation.** Campaign management needs `promotions:manage` (admin and owner);
  other staff can view.
- **Ownership.** Forfeit acts only on the caller's own active claim; another player's
  claim id gives 409 and changes nothing.
- **Trust.** Bodies are strict schemas: an `amount` sent by the client is rejected (400),
  and every bonus amount, progress figure and balance is computed on the server.
- **Abuse.**
  - Promo-code attempts: 10 per 10 minutes per player (then 429).
  - Live feed: 60 connections per minute per address and at most 500 streams per
    process; one cached snapshot is shared.
- **Concurrency.** Claims serialise on the player's wallet lock and the campaign row: a
  triple concurrent claim gives exactly one. The partial unique index enforces one active
  bonus per player.
- **Privacy.** The leaderboard and live feed show names only for opted-in players, with
  no ids or balances; the home page shows only aggregate counts.
- **Injection and XSS.** All SQL is parameterised; campaign text is rendered as React
  text.

New test file `tests/integration/platform-security.test.ts` (7 tests) covers the above.
Already covered by earlier tests, re-run here: insufficient balance, duplicate bets and
settlements, refresh and disconnect recovery, failed rounds, simultaneous actions, admin
adjustments and unauthorised API calls.

**Documentation.** New `docs/promotions.md`; `docs/api.md` (promotions, wallet summary,
live feed, admin promotions); `docs/testing.md`; README.

**Verification on this commit.**
- Typecheck, lint, docs/secrets/workflows checks, audio check (52 files), build and
  `check:bundle` (176 files) passed.
- Unit tests: 357 passed. Integration tests: 328 passed. Statistical tests: 44 passed.
- Full e2e: recorded below.

## Not built in this pass (recommendations)

- **Private multiplayer rooms with invitations.** The shared automatic roulette table,
  the live feed and online counts are the real-time multiplayer surface for now.
  Invite-only rooms need their own design: room ownership, signed invite tokens, presence
  and moderation.
- **Session history list.** Sessions are listed under Settings, and sign-ins appear in
  account activity. No separate page was added.
- **Phone testing.** Rendering performance on real phones has not been measured.
