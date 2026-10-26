// Fails on relative Markdown links that point to files that do not exist.
// External links (http/https/mailto) and pure #anchors are not checked.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.next', '.git', 'playwright-report', 'test-results']);
function* markdown(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* markdown(p);
    else if (e.endsWith('.md')) yield p;
  }
}

const broken = [];
let checked = 0;
for (const file of markdown('.')) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    checked += 1;
    const clean = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(path.resolve(path.dirname(file), clean))) broken.push(`${file}: ${target}`);
  }
}
if (broken.length) {
  console.error(`broken documentation links:\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`documentation links: ${checked} relative links OK`);
