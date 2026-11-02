# Autonomous development progress

A running log of the autonomous product pass (started 2026-11-01). Each batch is
committed separately with its verification results. If work stops, continue from the
**Next** list.

## Survey (before changes)

Stack:
- Next.js 15 (App Router) and React 19;
- PostgreSQL 16 with Drizzle and plain SQL migrations;
- Vitest (unit, integration, statistical) and Playwright end-to-end tests.

Product:
- nine server-authoritative games;
- sports predictions;
- wallet and double-entry ledger;
- responsible play;
- achievements;
- admin with four-eyes approvals;
- provably fair verification;
- an automatic roulette table with spectator spins.

Observed weaknesses, ranked:

1. A database behind the code (an update pulled without running `db:migrate`) broke
   roulette with only "Table unavailable". A real user hit this.
2. The visual design is clean but flat: opaque cards, plain buttons, no glass, little
   depth.
3. The lobby uses large cards with small line glyphs: little game art, few games per
   screen, no featured area.
4. Blackjack shows an empty panel (no table, no felt); Mines tiles are plain grey
   squares; most games lack a distinctive identity.
5. The profile and statistics pages are informative but plain.

## Batches

### 1. Pending-migration diagnostics (done)

- The server start-up now checks for pending migrations and logs "run `npm run
  db:migrate` and restart" (`src/instrumentation-node.ts`).
- The roulette table API maps Postgres `undefined_table` (42P01) to a 503 with an
  actionable message (`whenMigrated` in `src/server/games/roulette-table.ts`). The
  roulette status panel shows that message.
- Test: `roulette-table.test.ts` (10 tests passed).

### 2. Glass design system (done)

- **Tokens.** New glass tokens in `globals.css`: fill, tint, border, highlight and
  blur. `.surface` (every card) is now frosted glass, and there are new `.glass`
  (menus, tooltips) and `.sheen` (hover light sweep) classes. The colour tokens are
  unchanged, so the contrast test still holds: the glass sits over a dark "aurora"
  backdrop with an effective colour of about ink-900.
- **Controls.** Buttons have a glossy gold primary variant and glass secondary,
  subtle, ghost and danger variants, with pressed states. Inputs, badges and icon
  buttons are glass too.
- **Header.** A glass bar, a segmented glass navigation pill with an active state,
  and a glass balance pill, avatar button and menu.
- **Mobile.** A new bottom tab bar for signed-in players (Lobby, Sports, History,
  Wallet, Profile), with safe-area padding and scroll padding so it never hides
  content.

### 3. Lobby redesign (done)

- `GameCover`: original inline-SVG cover art for each of the nine games, each in its
  own colour world. No image files and no third-party assets.
- Dense tiles: four columns on desktop, two on small tablets. Each tile has the name
  and RTP over the art, hover lift with a sheen, and keeps Play, Rules and the
  favourite star. The e2e hooks are unchanged.
- A featured "Live table" banner for the automatic roulette, and a glass search box
  with an icon and glass category chips.
- Verified: build; e2e accessibility (axe), mobile, expansion (lobby search and
  favourites) and owner-admin specs, 14 passed.

### 4. Game tables (done)

- **Playing cards.** A shared `PlayingCard` component:
  - an SVG paper face with top and bottom corner indices, printed pip layouts for
    2–10 and a framed monogram for court cards;
  - an original navy-and-gold lattice back;
  - a deal animation from the shoe, and a flip when the hole card is revealed;
  - accessible names.

  Used by Blackjack and Hi-Lo.
- **Blackjack.** A felt table with a printed "Blackjack pays 3:2" arc and a card
  shoe; cards overlap like a dealt hand.
- **Mines.** Bevelled glass tiles, faceted emerald gems that flip in on reveal, a
  glowing red burst on the hit mine, and a deep teal board.
- **Crash.** A night-sky stage with a starfield and a violet glowing curve.
- **Every game page.** A backdrop in the game's own colour world (from the lobby
  cover themes) tints the glass panels.
- Verified: build; e2e blackjack, expansion (Limbo, Keno, Plinko, Hi-Lo rounds) and
  resilience specs, 10 passed.

### 5. Personal insights and consistent artwork (done)

- **30-day chart on `/stats`.** Daily net result as diverging bars:
  - one measure on one axis, green for a gain and coral for a loss, a neutral zero
    line;
  - hover and keyboard-focus tooltips (rounds, staked, returned, net), a colour key,
    and a screen-reader table;
  - labelled "a record of the past, not a forecast".

  Backed by `dailyResults()` in `src/server/users/stats.ts`: settled rounds only,
  every UTC day present, a window of 1–365 days.
- **Why not missions.** I deliberately did **not** add "play N rounds"
  missions or challenges: they reward play volume, which conflicts with Aurovane's
  responsible-play stance. The insights view supports self-awareness instead.
- **Artwork.** The landing page and the rules index now use the game cover art
  instead of line glyphs.
- **Tests.** A new integration test covers `dailyResults` (window, totals agree
  with `playerStats`, open rounds excluded, bounds). `/stats` was added to the axe
  accessibility sweep. Accessibility and player-journey e2e: 6 passed.

### 6. Controls and number games (done)

- **Disabled primary buttons.** The gold gradient leaked through the disabled state:
  Keno's "Pick 1 to 10 numbers" was hard to read. Disabled primary buttons are now a
  flat ink fill with muted text.
- **Keno.** The number tiles are balls: glass when empty, glossy gold when picked,
  ivory when drawn (with a flip-in), and emerald with a glow when a pick is hit. The
  legend matches.
- **Dice.** A deep-blue stage over the whole card. The roll sits in a glass display
  that glows green on a win. The track is green for the winning zone and dark red
  for the rest, and the marker is a small ivory die.
- Verified: typecheck, lint, build, 334 unit tests; e2e expansion, player-journey and
  accessibility specs, 10 passed.

### 7. Plinko, Limbo and Hi-Lo stages (done)

- **Plinko.** An amber board with lit pegs, a glowing ball, and buckets coloured by
  payout: red at the high-paying edges, amber in the middle. The landed bucket
  bounces and gets a white ring.
- **Limbo.** A magenta stage with concentric rings behind the result. On a win the
  rings turn green and a soft glow pulses.
- **Hi-Lo.** A burgundy felt with a face-down deck beside the current card. Pip
  columns on number cards moved inwards so they no longer crowd the corner indices
  (this also applies to Blackjack).
- New keyframes (`slot-hit`, `glow-pulse`). Reduced-motion users get the existing
  global override.
- Verified: typecheck, lint, build; e2e expansion, accessibility (axe on every game
  page) and mobile specs, 11 passed.

### 8. Admin artwork, sign-in pages and the signed-out header (done)

- **Admin.** The games list and game detail pages show the cover art. The old
  line-glyph component had no other users and was removed.
- **Sign-in, registration and recovery pages.**
  - A soft gold light behind the form, and a glow on the logo.
  - A row of plain facts under the form: "Virtual chips only", "Nothing to buy",
    "No cash prizes", "18+".
- **Signed-out header on phones.** "Sign in" and "Create account" wrapped onto two
  lines at 390px. They now stay on one line; on phones the button reads "Join".
- **Test.** A new mobile e2e test checks that the signed-out pages (landing, login,
  register, password recovery, rules, fairness) do not scroll sideways at 360px,
  and that the header's sign-in link stays on one line.
- Verified: typecheck, lint, build; e2e registration, mobile, accessibility,
  owner-admin, fairness-admin and resilience specs, 22 passed. The updated mobile
  spec then ran with 4 passed.

### 9. Security review: table-spin commitments (done)

I reviewed the server-side changes since `76ccaf0`:
- the three public roulette table routes (rate limits, input validation);
- the table service;
- the migrator checksum change;
- the start-up checks;
- `dailyResults` (parameterised SQL, session user only).

**One real defect, now fixed.**
- **The problem.** A day's seed was created lazily, on the first table request of that
  day. A spin that closed *before* that moment could still be revealed (within the
  10-minute window) from a seed committed after its outcome window. That broke the
  documented promise that every spin's commitment exists before betting closes.
- **The fix.**
  - `revealTableSpin` now refuses (404) a spin whose day seed was committed
    (`created_at`) after the spin closed.
  - A new `roulette-commitments` background job commits today's and tomorrow's seeds
    at start-up and every hour, so the commitment is normally in place a day ahead.
- **Test.** A new integration test covers both an early and a late commitment, and
  checks that a refused spin records nothing. I confirmed it **fails** on the old code
  and passes with the fix. The table tests now set up today's commitment as a running
  server would (before the day began), instead of relying on the late commitment.
- **Docs.** `docs/fairness.md` and `docs/operations.md` are updated.

**Reviewed, no change needed.**
- The CHECK constraint already stops spins from being recorded before they close.
- Day seeds are revealed only after the day has ended.
- Spectator spins never touch rounds, ledger entries or balances.

**Accepted trade-off.** The migrator accepts a migration that differs from the
recorded one only in line endings.

**Verified.**
- Typecheck, lint and docs check.
- Integration tests: 298 passed. Unit tests: 334 passed.
- Build; e2e casino-experience and player-journey specs: 11 passed.

### 10. Lighter glass on phones (done)

- Card surfaces (`.surface`) blur their backdrop only on screens 1024px and wider.
  Cards sit over a smooth, mostly static backdrop, so on phones the blur changed
  almost nothing visible but cost GPU work on every repaint. The header, the mobile
  tab bar and menus (`.glass`) keep their blur, because content scrolls beneath them.
- With `prefers-reduced-transparency: reduce`, cards and menus become solid ink panels
  without blur.
- **Honest limit.** I checked the computed styles (no blur at 390px, blur at 1440px)
  and compared screenshots. I did **not** measure frame rates on real phones: headless
  Chromium renders in software and would not be representative.
- Verified: build, 334 unit tests (including the contrast test), lint; e2e mobile
  and accessibility specs, 8 passed.

### 11. Roulette client: no pointless retries (done)

- When a table spin is refused for good (404: no commitment that predates its close;
  400: invalid), the roulette page now stops at once instead of retrying every 0.7 s
  until the deadline. "Not yet", network and server errors still retry.
- Verified: typecheck, lint, docs/secrets/workflows checks, audio check, 334 unit,
  298 integration and 24 statistical tests, build and `check:bundle` all passed.
  Full Playwright e2e on the same build: 45 passed (9.5 min), none failed.

### 12. Three original video slots (done)

Requested by the user, with a screenshot of a third-party slot as a style reference. I
built **original** slots in that genre. No third-party game, art, symbol set or name is
copied; every symbol is drawn here as inline SVG.

- **Engine** (`src/engine/games/slots`):
  - 5 reels × 4 rows, 1,024 ways, left to right;
  - wilds on reels 2–5;
  - 3, 4 or 5 scatters award free spins with every win doubled; no retrigger;
  - the whole round, free spins included, comes from one provably fair stream and
    settles once.
- **Exact maths, no simulation.**
  - Mean and variance factorise over the independent reels.
  - The scatter coupling uses per-reel polynomials.
  - The exact RTP is an integer fraction.
  - The largest win and the hit frequency come from exact pruned searches.
  - A unit test checks every figure against brute-force enumeration of every stop
    combination on small machines.
  - The configuration schema refuses an RTP of 100% or more, or a largest win above the
    platform cap.
- **Machines** (exact figures in `docs/math/slots.md`):

  | Machine | RTP | Free spins awarded | Largest win |
  |---|---|---|---|
  | Lantern Hollow (moonlit night) | 96.449% | 1 in 159 | 5,533× |
  | Ember Fruits (classic fruits) | 96.185% | 1 in 180 | 5,863× |
  | Sands of Aurum (desert treasures) | 96.137% | 1 in 140 | 4,814× |

  Stakes are 0.10–100 chips. 100 chips × the largest win stays under the per-round cap.
- **Screen:**
  - themed stage with a title, scenery and a gold reel frame;
  - reels that scroll through their real strips and stop one after another with a
    bounce;
  - winning cells glow and the rest dim, with a list of wins;
  - a free-spins intro, a counter and a running total;
  - BIG, MEGA and EPIC win screens (10×, 25× and 50× the stake);
  - turbo, skip, and reduced-motion support;
  - six new synthesised sounds.
- **Not implemented, on purpose.** There is no autoplay and no "buy free spins": both push
  play volume, against Aurovane's responsible-play stance. This is stated on the screen
  and in the rules.
- **Everywhere else:**
  - lobby "Video slots" category with cover art;
  - rules and paytables generated from the engine;
  - history rows and a round detail grid;
  - public verifier, plus the server-side "check this round" (stops compared);
  - catalog limits; `db:migrate` (bootstrap) adds the games to existing databases.
- **Tests:**
  - unit: `slots` (14), including brute-force equivalence;
  - integration: `slots` (6) — stops replayed from the seed, exact payouts, ledger
    reconciliation, limits, server and public verification;
  - statistical: `slots` (12) — uniform stops, and RTP, free-spin rate and hit frequency
    against the exact values;
  - e2e: `slots` (2);
  - the audio-profile test now requires the slot cues; the lobby count is 12.
- **First full e2e run: 45 passed, 2 failed**, both in the new `slots` spec and both
  locator mistakes in the test, not product faults:
  - the history check matched a hidden `<option>`;
  - `getByLabel('Stake')` matched 4 elements.

  After fixing the locators, the slots spec passed (2/2).
- **Not in this batch:** the slots are not in the platform risk simulator
  (`scripts/sim/risk-model.ts`). That model needs full payout distributions; for slots it
  would need sampling. See Next.

## Full verification (after batch 7)

Run on commit `def3337` against a local PostgreSQL 16:

- typecheck, lint, `check:bundle`, `check:docs`, `check:secrets`,
  `check:workflows`: passed;
- audio check: 46 files match their recipes;
- unit tests: 334 passed;
- integration tests: 297 passed;
- statistical tests: 24 passed;
- production build: passed;
- full Playwright e2e: 44 passed (9.4 min), none failed.

## Next

- Add the slots to the platform risk simulator (sampled distributions).
- More slot themes reuse the same engine: a new machine needs reel strips and a
  paytable tuned with `analyseMachine`, plus symbol art.

- Profile page polish.
- Measure real-device rendering performance (not possible in this environment).
- Full verification run (all suites, full e2e), then the final report.
