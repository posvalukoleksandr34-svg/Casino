/** Executed with tsx by global-setup (tsx resolves the @/ path alias). */
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from '../../src/server/db/migrator';
import { ensureAppRole } from '../support/app-role';
import { ADMIN, E2E_DATABASE_URL, MODERATOR, OWNER } from './env';

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
  const { createOperatorAccount } = await import('../../src/server/users/accounts');
  const { getDb, closeDb } = await import('../../src/server/db/client');
  const { users } = await import('../../src/server/db/schema');
  await bootstrap();
  // Staff fixtures are operator-created (verified by OPERATOR, no player-details step).
  const res = await createOperatorAccount({ email: ADMIN.email, username: 'e2e_admin', password: ADMIN.password }, { ipHash: null, userAgent: 'e2e' }, { onboarding: 'exempt' });
  await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, res.user.id));
  await createOperatorAccount({ email: OWNER.email, username: 'e2e_owner', password: OWNER.password }, { ipHash: null, userAgent: 'e2e' }, { onboarding: 'exempt' });
  // The first owner is provisioned exactly as in production (scripts/provision-owner.ts).
  const { provisionOwner } = await import('../../src/server/admin/provision');
  await provisionOwner({ email: OWNER.email, reason: 'End-to-end test owner' });
  const mod = await createOperatorAccount({ email: MODERATOR.email, username: 'e2e_moderator', password: MODERATOR.password }, { ipHash: null, userAgent: 'e2e' }, { onboarding: 'exempt' });
  await getDb().update(users).set({ role: 'SUPPORT' }).where(eq(users.id, mod.user.id));
  // Background jobs are off for the server under test; create the demo sports fixtures once.
  const { syncSports } = await import('../../src/server/sports/sync');
  await syncSports();
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
