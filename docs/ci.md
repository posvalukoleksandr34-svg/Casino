# Continuous integration

Two workflows live in `.github/workflows/`. `scripts/check-workflows.mjs` enforces the
policy below in CI, so a change that breaks it fails the build.

## Workflows and triggers

| Workflow | Triggers | Purpose |
|---|---|---|
| `ci.yml` (CI) | every pull request; pushes to `ccr-c301db4d-y6lhy2` (the default branch) and `main`; manual | required checks |
| `extended.yml` (Extended verification) | Mondays 03:17 UTC on the default branch; manual (`rounds`, `seed` inputs) | large Monte Carlo runs and the risk model |

**Default branch.** GitHub branch filters cannot reference "the default branch", so
`ci.yml` names it explicitly: `ccr-c301db4d-y6lhy2`, read from the repository settings
on 2026-10-26. `main` stays listed in case the default branch is renamed. On every run,
the workflow-policy step receives the real default branch from the event payload
(`github.event.repository.default_branch`). It fails if pushes to that branch would not
trigger CI, so renaming the default branch without updating the workflow is caught on
the next pull request.

**Required check.** The `CI required` job depends on every other job and fails unless
all of them succeeded; a skipped or cancelled job counts as a failure. Mark `CI required`
as the required status check in branch protection. Judge a run by its job conclusions,
not by a badge.

**Concurrency.** A new commit on a pull request cancels the superseded run. A push to a
branch never cancels a running push build, so every default-branch commit is verified;
GitHub replaces older *queued* runs of the same group. Extended runs never cancel each
other.

## Jobs (ci.yml)

| Job | Steps | Timeout |
|---|---|---|
| Typecheck, lint, unit tests, supply-chain checks | workflow policy, secret scan, `npm ci`, `npm audit signatures`, typecheck, lint, unit tests, docs links, `npm audit --audit-level=moderate` | 15 min |
| Integration tests (PostgreSQL 16) | full integration suite (incl. Crash ordering under real row locks), then the backup → restore → reconcile drill (`npm run ops:restore-check`). Runs on `ubuntu-24.04`, whose archive has the PostgreSQL 16 client tools the drill needs (`ubuntu-latest` = 26.04 has only newer ones); move it when production moves to a newer PostgreSQL major | 20 min |
| Statistical tests | fixed-seed chi-square / confidence-interval tests | 20 min |
| Production build and end-to-end tests | `npm run build`, bundle secret check, Playwright against the standalone build | 30 min |
| CI required | aggregates the four results | 5 min |

The databases are health-checked service containers (`pg_isready`), created per job and
discarded after it. Their credentials are throwaway values written in the workflow.

## Supply chain and least privilege

* **Pinned actions.** Every `uses:` names a full 40-character commit SHA, followed by a
  comment with the release it corresponds to. Current pins, each verified on 2026-10-26
  as a commit in the upstream repository with that release's `action.yml`. They are
  exactly what the floating `v4` tags pointed to, the versions the previous CI ran:

  | Action | Release | Commit |
  |---|---|---|
  | `actions/checkout` | v4.4.0 | `11d5960a326750d5838078e36cf38b85af677262` |
  | `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
  | `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

  These releases declare the `node20` runtime. Dependabot (`.github/dependabot.yml`)
  proposes newer releases (v5+, `node24`) as reviewable pull requests.
* **Updating a pin.** Resolve the tag with
  `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'`.
  Take the peeled `^{}` commit if the tag is annotated. Check the commit's `action.yml`
  and release notes, then update the SHA and the version comment together.
* **Permissions.** Workflow-level `permissions: {}`. Each job asks only for
  `contents: read` (checkout), and the aggregate job asks for nothing.
  `actions/checkout` runs with `persist-credentials: false`, so no token stays in
  `.git/config` for later steps or artifacts.
* **Untrusted code.** Only `pull_request` is used, never `pull_request_target`, so code
  from a fork runs with a read-only token and no secrets. The workflows use no
  repository secrets at all (enforced).
* **No swallowed failures.** Steps run under `bash -eo pipefail`, and
  `continue-on-error` is forbidden.
* **Dependencies.**
  * `npm ci` installs exactly the lockfile.
  * `npm audit signatures` verifies registry signatures (and provenance where published).
  * `npm audit --audit-level=moderate` fails on known advisories.
  * Dependabot proposes npm updates weekly.

  Manual review notes: [dependency-security.md](dependency-security.md).
* **Secrets in the repository.** `npm run check:secrets` scans every tracked file for
  credential patterns and fails on tracked `.env` files, key material and database
  dumps. Findings are reported by file and line, never by value. It is a pattern check;
  also enable GitHub secret scanning and push protection in the repository settings.
* **Artifacts.**
  * Playwright uploads screenshots and its HTML report on failure, kept 7 days. CI
    records no traces, because traces would contain request headers and session cookies.
  * Extended verification uploads `reports/*.json`: seeds, parameters and aggregates,
    kept 30 days.
  * Hidden files are never included, and no job has a `.env` or real credentials to
    leak.

## Extended verification

Each run writes the commit SHA, seed, parameters and results to `reports/*.json` (uploaded)
and to the job summary. Re-running with the same `seed` and `rounds` reproduces it exactly.

* **Exact games** (roulette, dice, mines, crash; 17 scenarios × 2,000,000 rounds):
  * The expected RTP is derived from the **published rules**, implemented independently
    of the engine (`scripts/sim/independent-rtp.ts`). The engine's own theory function
    must agree with it.
  * A scenario fails beyond |z| = 4, a two-sided α of 6.3·10⁻⁵ per scenario. With
    Bonferroni over 17 scenarios, the family-wise false-alarm rate is about 1.1·10⁻³ per
    run.
  * Each report states the smallest bias the run could detect (4 standard errors). At
    2,000,000 rounds this ranges from 0.04 percentage points (98 % dice, 1.01× crash
    target) to about 2.8 points (1 % dice, 100× crash target), whose variance is high.
    Low-variance scenarios are therefore the sharp tests of payout tables. The chi-square
    distribution tests in regular CI check the RNG mapping directly.
  * Reports record `uncommittedChanges` when the code that ran differs from `commit`.
  * A negative control is documented in [testing.md](testing.md): a +0.5 % Dice payout
    bias fails the run with |z| up to 48.
* **Blackjack**: 4,000,000 fresh hands of the default rules must agree with the
  published estimate (|z| ≤ 4 on the combined standard error).
* **Risk model** (`--check`): checks the simulator against itself and the configured
  caps: the mean house P&L must lie within 4 SE of its exact expectation, and no payout
  may exceed the per-round cap. Its reserve figures are model estimates under the stated
  assumptions ([risk.md](risk.md)), not guarantees.

The regular CI keeps the smaller fixed-seed statistical suite. It also runs a unit test
(`independent-rtp.test.ts`) that compares the engine's theory with the independent
derivations over the full parameter space.

**Running locally.** These are the same commands as the workflow:

```bash
for g in roulette dice mines crash; do npm run sim:game -- "$g" --rounds 2000000 --seed my-seed; done
npm run sim:game -- blackjack --rules 6-S17-3:2-DAS --hands 4000000 --check --seed my-seed
npm run sim:risk -- --days 30 --paths 2000 --seed my-seed --check
```
