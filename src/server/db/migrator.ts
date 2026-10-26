/**
 * Minimal forward-only migration runner. Each file in /migrations is applied
 * once, in lexical order, inside its own transaction, and recorded with a
 * SHA-256 checksum. Editing an already-applied migration is detected and
 * refused. A session-level advisory lock prevents concurrent runners.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

const LOCK_ID = 7_342_001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(pool: pg.Pool, dir = path.resolve(process.cwd(), 'migrations')): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = applied.get(file);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(`migration ${file} was modified after being applied (checksum mismatch)`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    // Keep the least-privilege runtime role's grants in step with the schema
    // (migration 0004). No-op when the role does not exist.
    const fn = await client.query<{ exists: boolean }>("SELECT to_regprocedure('casino_apply_app_grants()') IS NOT NULL AS exists");
    if (fn.rows[0]?.exists) await client.query('SELECT casino_apply_app_grants()');
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

export async function pendingMigrations(pool: pg.Pool, dir = path.resolve(process.cwd(), 'migrations')): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const exists = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  if (!exists.rows[0]?.exists) return files;
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  return files.filter((f) => !done.has(f));
}
