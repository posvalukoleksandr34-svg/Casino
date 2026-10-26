/**
 * Workflow policy (CI static job; `npm run check:workflows`). Dependency-free,
 * line-based checks of .github/workflows/*.yml — policy, not a YAML linter
 * (GitHub rejects malformed workflows itself; docs/ci.md):
 *
 *   * every `uses:` is pinned to a full 40-character commit SHA with a
 *     `# vX.Y.Z` comment naming the release it corresponds to;
 *   * every actions/checkout sets `persist-credentials: false`;
 *   * workflow-level `permissions:` and per-job `permissions:` and
 *     `timeout-minutes:` are present;
 *   * no `pull_request_target`, `continue-on-error`, or repository secrets;
 *   * ci.yml runs on pushes to the repository's default branch
 *     (DEFAULT_BRANCH, set by CI from the event payload; locally from
 *     origin/HEAD when known).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = '.github/workflows';
const problems = [];
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

function jobsOf(lines) {
  // Top-level `jobs:` block; job ids are the keys indented by exactly two spaces.
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) jobs.push({ id: m[1], line: i });
  }
  return jobs.map((j, k) => ({ ...j, body: lines.slice(j.line + 1, k + 1 < jobs.length ? jobs[k + 1].line : undefined) }));
}

for (const file of files) {
  const path = `${DIR}/${file}`;
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `${path}:${i + 1}`;
    const uses = /^\s*-?\s*uses:\s*([^\s#]+)\s*(#.*)?$/.exec(line);
    if (uses) {
      const [, ref, comment] = uses;
      if (!ref.startsWith('./')) {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref)) problems.push(`${where}: ${ref} is not pinned to a full commit SHA`);
        if (!comment || !/#\s*v\d+(\.\d+){0,2}\b/.test(comment)) problems.push(`${where}: pinned action needs a "# vX.Y.Z" release comment`);
      }
      if (/^actions\/checkout@/.test(ref)) {
        const next = lines.slice(i + 1, i + 6).join('\n');
        if (!/persist-credentials:\s*false/.test(next)) problems.push(`${where}: actions/checkout must set persist-credentials: false`);
      }
    }
    if (/pull_request_target/.test(line) && !/^\s*#/.test(line)) problems.push(`${where}: pull_request_target is not allowed (untrusted code with write tokens/secrets)`);
    if (/continue-on-error:\s*true/.test(line)) problems.push(`${where}: continue-on-error would hide failures`);
    if (/\$\{\{\s*secrets\./.test(line)) problems.push(`${where}: workflows must not use repository secrets (docs/ci.md)`);
  });
  if (!lines.some((l) => /^permissions:/.test(l))) problems.push(`${path}: missing workflow-level permissions`);
  for (const job of jobsOf(lines)) {
    if (!job.body.some((l) => /^ {4}permissions:/.test(l))) problems.push(`${path}: job "${job.id}" has no permissions block`);
    if (!job.body.some((l) => /^ {4}timeout-minutes:\s*\d+/.test(l))) problems.push(`${path}: job "${job.id}" has no timeout-minutes`);
  }
}

// Pushes to the default branch must run the required checks.
let defaultBranch = process.env.DEFAULT_BRANCH || '';
if (!defaultBranch) {
  try {
    defaultBranch = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .replace(/^origin\//, '');
  } catch {
    /* unknown locally (e.g. a shallow CI checkout without DEFAULT_BRANCH) */
  }
}
const ci = readFileSync(`${DIR}/ci.yml`, 'utf8');
const pushBranches = /\n {2}push:\s*\n(?:\s*#.*\n)*\s*branches:\s*\[([^\]]*)\]/.exec(ci);
if (!pushBranches) problems.push('ci.yml: push trigger must list its branches explicitly');
else if (defaultBranch) {
  const listed = pushBranches[1].split(',').map((b) => b.trim().replace(/^['"]|['"]$/g, ''));
  if (!listed.includes(defaultBranch)) problems.push(`ci.yml: pushes to the default branch "${defaultBranch}" do not trigger CI (listed: ${listed.join(', ')})`);
}
if (!/\n {2}pull_request:\s*\n/.test(ci)) problems.push('ci.yml: pull_request trigger is missing');

if (problems.length) {
  console.error(`workflow policy: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`workflow policy: ${files.length} workflow(s) OK${defaultBranch ? `; default branch "${defaultBranch}" triggers CI` : '; default branch unknown here (checked in CI)'}`);
