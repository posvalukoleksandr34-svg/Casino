// Copies the assets the standalone server needs next to it (Next.js does not
// copy static files, and the readiness check reads the migrations folder),
// and removes any .env* files Next.js copied from the build machine: the
// artifact must not carry local secrets, and runtime configuration must come
// only from the deployment's environment.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';

const target = '.next/standalone';
if (!existsSync(target)) {
  console.log('no standalone output; skipping');
  process.exit(0);
}
cpSync('.next/static', `${target}/.next/static`, { recursive: true });
cpSync('migrations', `${target}/migrations`, { recursive: true });
if (existsSync('public')) cpSync('public', `${target}/public`, { recursive: true });
const removed = readdirSync(target).filter((f) => /^\.env(\..*)?$/.test(f));
for (const f of removed) rmSync(`${target}/${f}`);
if (removed.length) console.log(`removed from the artifact: ${removed.join(', ')}`);
console.log('standalone bundle prepared');
