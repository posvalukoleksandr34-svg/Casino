// Fails if server-only configuration leaks into browser bundles (.next/static),
// or if browser source maps are published.
// Checks variable names always, and values of any of them present in the
// environment (e.g. CI's test secrets). Run after `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const NAMES = ['DATABASE_URL', 'SEED_ENCRYPTION_KEY', 'SEED_ENCRYPTION_KEYS_PREVIOUS', 'IP_HASH_SECRET', 'METRICS_TOKEN', 'SMTP_URL', 'DB_APP_PASSWORD', 'DB_MIGRATOR_PASSWORD'];
const values = NAMES.map((n) => process.env[n]).filter((v) => v && v.length >= 8);
const root = '.next/static';

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|css|html|json|map)$/.test(p)) yield p;
  }
}

const hits = [];
let scanned = 0;
for (const file of files(root)) {
  scanned += 1;
  // Browser source maps would publish the original source; production builds must not emit them.
  if (file.endsWith('.map')) hits.push(`${file}: browser source map`);
  const text = readFileSync(file, 'utf8');
  for (const n of NAMES) if (text.includes(n)) hits.push(`${file}: variable name ${n}`);
  for (const v of values) if (text.includes(v)) hits.push(`${file}: value of a server secret`);
}
if (scanned === 0) {
  console.error(`no files under ${root} — run the build first`);
  process.exit(1);
}
if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`client bundle check: ${scanned} files, no server secrets`);
