/**
 * Recreates the test database schema from scratch and applies all migrations
 * plus the reference-data bootstrap. Refuses to run against anything whose
 * name does not end in "_test".
 */
import pg from 'pg';
import { ensureAppRole } from '../support/app-role';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://casino:casino@localhost:5432/casino_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`refusing to reset non-test database "${dbName}"`);
  process.env.DATABASE_URL = url;
  process.env.SCRYPT_LOG_N = '10';
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  // Least-privilege runtime role (migration 0004); the privileges test connects through it.
  await ensureAppRole(pool, new URL(url).username);
  const { migrate } = await import('../../src/server/db/migrator');
  await migrate(pool);
  await pool.end();
  const { bootstrap } = await import('../../src/server/bootstrap');
  const { closeDb } = await import('../../src/server/db/client');
  await bootstrap();
  await closeDb();
}
