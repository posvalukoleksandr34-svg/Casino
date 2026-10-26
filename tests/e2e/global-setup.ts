/**
 * Resets the e2e database (migrations, reference data, an administrator).
 * Runs the setup through tsx so server modules resolve exactly as in scripts.
 */
import { execFileSync } from 'node:child_process';
import { E2E_ENV } from './env';

export default function globalSetup(): void {
  execFileSync('npx', ['tsx', 'tests/e2e/setup-db.ts'], { stdio: 'inherit', env: { ...process.env, ...E2E_ENV, NODE_ENV: 'development' } });
}
