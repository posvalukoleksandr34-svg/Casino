import type pg from 'pg';

/**
 * Ensures the least-privilege runtime role "casino_app" (migration 0004) exists
 * and that the connecting user may SET ROLE to it. Creates it when permitted;
 * otherwise fails with the exact statement to run, rather than skipping tests.
 */
export async function ensureAppRole(pool: pg.Pool, user: string): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'casino_app') AS exists`);
  const exists = rows[0]?.exists === true;
  const member = exists
    ? (await pool.query<{ m: boolean }>(`SELECT pg_has_role(current_user, 'casino_app', 'MEMBER') AS m`)).rows[0]?.m === true
    : false;
  if (exists && member) return;
  try {
    if (!exists) await pool.query('CREATE ROLE casino_app NOLOGIN');
    await pool.query('GRANT casino_app TO CURRENT_USER');
  } catch (err) {
    throw new Error(
      `Tests need the least-privilege role "casino_app" (migration 0004). As a PostgreSQL superuser run:\n` +
        `  CREATE ROLE casino_app NOLOGIN; GRANT casino_app TO ${user};\n(${(err as Error).message})`,
    );
  }
}
