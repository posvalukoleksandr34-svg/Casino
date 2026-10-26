// Copies the assets the standalone server needs next to it (Next.js does not
// copy static files, and the readiness check reads the migrations folder).
import { cpSync, existsSync } from 'node:fs';

const target = '.next/standalone';
if (!existsSync(target)) {
  console.log('no standalone output; skipping');
  process.exit(0);
}
cpSync('.next/static', `${target}/.next/static`, { recursive: true });
cpSync('migrations', `${target}/migrations`, { recursive: true });
if (existsSync('public')) cpSync('public', `${target}/public`, { recursive: true });
console.log('standalone bundle prepared');
