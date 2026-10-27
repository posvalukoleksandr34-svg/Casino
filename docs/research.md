# Market and provider research

**Date:** 27 October 2026. **Purpose:** inform Aurovane's lobby, games, fairness features
and sports simulator, and record what was adopted and why. Aurovane has **no partnership,
integration or licence** with any company named here; none of their code, artwork, logos or
game designs is used.

## Method and confidence

Research used a web search engine. Direct page fetching was **not possible** from the
development environment (DNS resolution of the providers' hosts failed), so every statement
below comes from search-result summaries of the pages listed, not from reading the pages in
full. Each item is marked:

* **Observed (official)** — summarised from a page on the company's own domain or
  documentation site.
* **Observed (third party)** — summarised from press, reviews, catalogues, court reporting or
  community code. Treated as less reliable; conflicts between sources are noted.
* **Assumption** — not supported by a source found here; stated only to explain a design
  choice, and never used as a fact in the product.

Search results included many low-quality or spam pages (keyword-stuffed blogs on unrelated
domains). They were discarded. Nothing found here should be cited as authoritative without
reading the primary source.

## Data and odds providers

### The Odds API

* **Observed (official, error-code guide):** quota headers `x-requests-remaining`,
  `x-requests-used`, `x-requests-last`; example calls to `/v4/sports/{sport}/odds` with
  `regions` and `markets=h2h`.
* **Observed (third party, client libraries):** `markets` accepts `h2h`, `spreads`, `totals`;
  responses list events with bookmakers, markets and outcomes; credit cost scales with
  markets × regions. The cost formula and the behaviour at zero quota were **not** confirmed on
  an official page.
* **Adopted:** `src/server/sports/providers/the-odds-api.ts` requests `markets=h2h`,
  `oddsFormat=decimal`, reports `x-requests-remaining`, refreshes at most every
  `SPORTS_SYNC_MINUTES` to limit quota use, and keeps the key server-side.
* **Assumption to verify before going live:** response field names (`commence_time`,
  `home_team`, `away_team`, `bookmakers[].markets[].outcomes[]`, outcome `Draw`), which match
  widely used client libraries but were not read from the official reference here.

### football-data.org

* **Observed (official docs, "Dealing with scores"):** `score.fullTime` doubles as the running
  score during play; once a match is FINISHED it holds the final result; since v4,
  `score.regularTime` holds the goals after 90 minutes; `score.duration` distinguishes regular
  time, extra time and penalty shoot-outs.
* **Observed (official quickstart):** `/v4/matches` with filters; token in the `X-Auth-Token`
  header; the free plan allows ten calls per minute.
* **Not found:** the complete list of `status` values (only `IN_PLAY` and `FINISHED` were
  confirmed). The adapter maps the commonly documented values and treats anything unknown as
  "suspended" (no settlement), which fails safe.
* **Adopted:** 1X2 settles on the regular-time score; requests spaced ≥ 6.5 s; a 10-day window
  per request.

### Sportmonks

* **Observed (official docs):** v3 football fixtures (`/v3/football/fixtures`, by id and by
  date range); pre-match odds by fixture (`/v3/football/odds/pre-match/fixtures/{id}`, with
  bookmaker and market filters); rate limits counted **per entity per hour** by plan, a
  `rate_limit` object (`remaining`, `resets_in_seconds`) in each response, and HTTP 429 when
  exceeded. Official pages disagree on the default hourly figure (2,000 vs 3,000), and the
  odds URL format differs between doc sets.
* **Not adopted (yet):** one fixtures provider and one odds provider are enough for the
  simulator. The provider interface (`FixturesProvider`, `OddsProvider` in
  `src/server/sports/providers/types.ts`) is where a Sportmonks adapter would plug in; it would
  need its own per-entity rate-limit handling.

## Operators and game studios

### Stake

* **Observed (official blog, "What is provably fair?"):** results combine a hidden server
  seed, a player-controlled client seed and a nonce; the server seed's hash is shown first and
  the seed revealed later; players can set their own client seed; a verifier takes game,
  client seed, server seed and nonce; covers in-house games such as Dice, Crash, Plinko, Mines.
* **Observed (third party):** HMAC-SHA256 over server seed and `clientSeed:nonce` (plus a
  "cursor"); not confirmed on an official page.
* **Adopted (already in Aurovane before this work):** committed server seed, editable client
  seed, per-round nonce, HMAC-SHA256 stream, in-browser verifier. **New here:** a
  server-side recomputation of a player's own round ("Check this round on the server") and
  committed seeds for demo sports results. Aurovane's Plinko, Limbo, Keno and Hi-Lo are
  original designs with their own published tables and proofs (`docs/math/`), not copies.

### Roobet

* **Observed (third party only):** provably fair checks for in-house games such as Crash,
  Dice and Mines; crash games commonly use a hash chain (a seed hashed many times, revealed in
  reverse). No official Roobet document was found.
* **Not adopted:** Aurovane's Crash and Limbo draw each round from the player's own committed
  seed pair (per-player, per-round), which needs no shared chain.

### SPRIBE (Aviator)

* **Observed (third party only, conflicting):** a published server-seed hash, revealed
  afterwards; client seeds reportedly contributed by the first three bettors of a round —
  other sources say the player's own seed. No official SPRIBE technical document was found.
* **Not adopted:** shared multiplayer rounds. Aurovane rounds are single-player, so each
  player's outcome depends only on their own seeds.

### BGaming

* **Observed (third party):** credited with introducing provably fair slots; named titles and
  portfolio size vary by source and date (35 to 120+ games); certification by testing labs is
  mentioned without per-title detail. No official list was found.
* **Not adopted:** slots remain out of scope (P3); Aurovane will not show RTPs or claims for
  games it does not run.

### Hacksaw Gaming

* **Observed (third party):** a Malta-based studio founded in 2018 with a mobile-first slot
  portfolio; individual RTPs around 96.2–96.3 % appear on review sites but not from an
  official source.
* **Not adopted:** no slot content. The interface lesson taken is general: each game shows
  its RTP, limits and rules before play.

### Evolution

* **Observed (third party):** live-dealer tables and game shows; "First Person" RNG versions of
  live games; acquisitions of slot studios. The official site was not reachable here.
* **Not adopted:** live dealers and game shows are outside a virtual-chip, single-player,
  provably fair design.

### DraftKings (sportsbook)

* **Observed (regulator-hosted copies of house rules, court and press reporting):** settlement
  and void rules are set per sport in published house rules; courts have upheld voids under
  those rules; a 2024 golf case drew criticism for voiding bets placed between rounds.
  Postponement rules vary by sport (third-party guides).
* **Adopted:** Aurovane publishes its own rules before play (`/sports/how-it-works`): void on
  cancellation, abandonment, an off-pitch award or a postponement over 48 hours; full refunds
  exactly once; and a **credit-only correction policy** — a corrected result can add to what
  a player was paid but never takes chips back. Every result version is shown on the event
  page.

## Summary of what was adopted

| Area | Decision | Basis |
|---|---|---|
| Provably fair | keep committed seeds and in-browser verifier; add server recomputation; committed seeds for demo sports | observed (official, Stake) and existing design |
| New games | original Limbo, Keno, Plinko, Hi-Lo with exact published maths | common game types; designs and tables are Aurovane's own |
| Sports data | football-data.org fixtures/results, The Odds API prices, both optional; demo mode by default | observed (official docs, partial) |
| Sports rules | published void and credit-only correction policy | observed practice (house rules) and Aurovane's virtual-chip context |
| Rate limits | spacing per provider, refresh interval, Retry-After, quota shown to operators | observed (official docs) |
| Not adopted | slots, live dealers, multiplayer shared rounds, accumulators | scope and fairness model |
