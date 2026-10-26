/**
 * Validated server configuration. Imported only by server modules; values
 * never reach the browser bundle.
 */
import { z } from 'zod';

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().default('http://localhost:3000'),
  SEED_ENCRYPTION_KEY: z.string().optional(),
  IP_HASH_SECRET: z.string().optional(),
  SCRYPT_LOG_N: z.coerce.number().int().min(10).max(20).default(17),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  MAIL_TRANSPORT: z.enum(['console', 'disabled']).default('console'),
  BACKGROUND_JOBS: boolish.default(true),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
  METRICS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Escape hatch for isolated test deployments only: accept a superuser / schema-owner DB role. */
  ALLOW_PRIVILEGED_DB_ROLE: boolish.default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionProblems(parsed.data, process.env);
    if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`);
  }
  cached = parsed.data;
  return cached;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Passwords that must never protect a production database (defaults, examples, published values). */
const WEAK_DB_PASSWORDS = new Set(['', 'casino', 'postgres', 'password', 'secret', 'changeme', 'change-me', 'admin', 'root']);

function decodedKeyLength(raw: string): number {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return 32;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return 0;
  return Buffer.from(raw, 'base64').length;
}

/**
 * Production must never fall back to development keys, placeholder secrets,
 * default database passwords or plain HTTP on a public host. Pure function so
 * every rule is unit-tested; secret values never appear in the messages.
 */
export function productionProblems(e: Env, raw: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (!e.SEED_ENCRYPTION_KEY) problems.push('SEED_ENCRYPTION_KEY is required');
  else if (decodedKeyLength(e.SEED_ENCRYPTION_KEY) !== 32) problems.push('SEED_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex characters)');
  if (!e.IP_HASH_SECRET) problems.push('IP_HASH_SECRET is required');
  else if (e.IP_HASH_SECRET.length < 32) problems.push('IP_HASH_SECRET must be at least 32 characters');
  if (e.METRICS_TOKEN && e.METRICS_TOKEN.length < 24) problems.push('METRICS_TOKEN must be at least 24 characters when set');
  if (!raw.APP_URL) problems.push('APP_URL must be set explicitly');
  const app = new URL(e.APP_URL);
  if (app.protocol !== 'https:' && !LOOPBACK.has(app.hostname) && raw.ALLOW_INSECURE_HTTP !== 'true') {
    problems.push('APP_URL must use https:// (TLS terminated at the reverse proxy); ALLOW_INSECURE_HTTP=true only for isolated test deployments');
  }
  let db: URL | null = null;
  try {
    db = new URL(e.DATABASE_URL);
  } catch {
    problems.push('DATABASE_URL is not a valid URL');
  }
  if (db && !LOOPBACK.has(db.hostname)) {
    const password = decodeURIComponent(db.password);
    if (WEAK_DB_PASSWORDS.has(password.toLowerCase()) || password.length < 16) {
      problems.push('DATABASE_URL must use a strong, non-default password (≥ 16 characters) for a non-local database');
    }
  }
  return problems;
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
