# reports/

Simulation outputs. **Everything here is SIMULATED** and never mixed with live analytics.

* `reports/*.json` — outputs of local runs (`npm run sim:game …`, `npm run sim:risk …`,
  CI's extended workflow). They are reproducible from the command line and the seed
  recorded inside each file, so they are **not committed** (see `.gitignore`).
* `reports/evidence/` — committed evidence that documentation relies on:
  * `blackjack-estimates-2026-10-26.json` — the 16 runs (one per rule set) behind the
    published blackjack house-edge estimates in `src/engine/games/blackjack/estimates.ts`
    (consolidated from the per-run files; values verified identical).
  * `risk-reference-2026-10-26.json` — the reference bankroll/reserve run quoted in
    `docs/risk.md` (`npm run sim:risk -- --paths 1000`, default seed 1,2,3,4).
