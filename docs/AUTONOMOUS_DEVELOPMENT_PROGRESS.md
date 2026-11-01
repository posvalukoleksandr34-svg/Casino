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

## Next

- Plinko, Limbo and Hi-Lo stages.
- Auth and profile polish; admin pages still use line glyphs.
- Review `backdrop-blur` cost on low-end mobile.
- Full verification run (all suites, full e2e), then the final report.
