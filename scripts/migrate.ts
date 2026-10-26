import './load-env';
import pg from 'pg';
import { migrate } from '../src/server/db/migrator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: url });
  const res = await migrate(pool);
  await pool.end();
  console.log(JSON.stringify({ msg: 'migrations', applied: res.applied, alreadyApplied: res.skipped.length }));
  const { bootstrap } = await import('../src/server/bootstrap');
  const { closeDb } = await import('../src/server/db/client');
  await bootstrap();
  await closeDb();
  console.log(JSON.stringify({ msg: 'reference data bootstrapped' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
