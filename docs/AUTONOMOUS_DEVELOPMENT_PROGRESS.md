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

## Next

- Batch 2: design system — glass surfaces and buttons, a richer background, a glass
  header.
- Batch 3: lobby redesign — original cover art per game, a featured hero, dense tiles.
- Batch 4: game tables — blackjack felt and dealt cards; Mines gem tiles.
- Then: reassess features (personal statistics charts, missions, leaderboards).
