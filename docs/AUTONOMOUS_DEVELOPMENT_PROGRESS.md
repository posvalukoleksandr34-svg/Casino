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

## Next

- Batch 2: design system — glass surfaces and buttons, a richer background, a glass
  header.
- Batch 3: lobby redesign — original cover art per game, a featured hero, dense tiles.
- Batch 4: game tables — blackjack felt and dealt cards; Mines gem tiles.
- Then: reassess features (personal statistics charts, missions, leaderboards).
