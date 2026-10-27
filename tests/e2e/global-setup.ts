/**
 * Resets the e2e database (migrations, reference data, staff fixtures) and
 * starts a loopback SMTP sink that stores every message the server sends as a
 * JSON file in E2E_MAIL_DIR, so specs can read verification codes without any
 * real e-mail provider. Runs the database setup through tsx so server modules
 * resolve exactly as in scripts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeSmtp, plainBody } from '../support/fake-smtp';
import { E2E_ENV, E2E_MAIL_DIR, E2E_SMTP_PORT } from './env';

export default async function globalSetup(): Promise<() => Promise<void>> {
  execFileSync('npx', ['tsx', 'tests/e2e/setup-db.ts'], { stdio: 'inherit', env: { ...process.env, ...E2E_ENV, NODE_ENV: 'development' } });
  rmSync(E2E_MAIL_DIR, { recursive: true, force: true });
  mkdirSync(E2E_MAIL_DIR, { recursive: true });
  let n = 0;
  const sink = fakeSmtp({
    port: E2E_SMTP_PORT,
    onMessage(m) {
      n += 1;
      const to = m.to.map((line) => /<([^>]+)>/.exec(line)?.[1] ?? line).map((a) => a.toLowerCase());
      writeFileSync(path.join(E2E_MAIL_DIR, `${Date.now()}-${String(n).padStart(5, '0')}.json`), JSON.stringify({ to, body: plainBody(m) }));
    },
  });
  await sink.start();
  return async () => {
    await sink.stop();
  };
}
