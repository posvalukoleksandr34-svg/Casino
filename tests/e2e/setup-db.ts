/** Executed with tsx by global-setup (tsx resolves the @/ path alias). */
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from '../../src/server/db/migrator';
import { ensureAppRole } from '../support/app-role';
import { ADMIN, E2E_DATABASE_URL } from './env';

async function main() {
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1);
  if (!name.includes('e2e')) throw new Error(`refusing to reset database "${name}"`);
  // Schema owner connection (migrations); the app under test uses casino_app.
  const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ensureAppRole(pool, new URL(E2E_DATABASE_URL).username);
  await migrate(pool);
  await pool.end();
  const { bootstrap } = await import('../../src/server/bootstrap');
  const { register } = await import('../../src/server/users/accounts');
  const { getDb, closeDb } = await import('../../src/server/db/client');
  const { users } = await import('../../src/server/db/schema');
  await bootstrap();
  const res = await register({ email: ADMIN.email, username: 'e2e_admin', password: ADMIN.password, ageConfirmed: true, termsAccepted: true }, { ipHash: null, userAgent: 'e2e' });
  await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, res.user.id));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
