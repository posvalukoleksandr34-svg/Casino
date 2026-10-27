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
  /** smtp = real delivery; console = development only; disabled = no recovery e-mail (honest default). */
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'disabled']).default('disabled'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  BACKGROUND_JOBS: boolish.default(true),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
  /**
   * Bearer token for /api/metrics. OPTIONAL by design: metrics are an opt-in
   * integration. Unset (or empty, as Compose passes it) means the endpoint is
   * disabled and refuses every request — there is no unauthenticated mode.
   * When set in production it must be a strong, header-safe token.
   */
  METRICS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Escape hatch for isolated test deployments only: accept a superuser / schema-owner DB role. */
  ALLOW_PRIVILEGED_DB_ROLE: boolish.default(false),
  /**
   * Sports prediction simulator: demo = fictional fixtures, house-model odds and
   * committed simulated results (no credentials needed); live = fixtures/results
   * from football-data.org and odds from The Odds API (both keys required);
   * off = section hidden. Provider keys are read only on the server.
   */
  SPORTS_MODE: z.enum(['demo', 'live', 'off']).default('demo'),
  FOOTBALL_DATA_API_KEY: z.string().optional(),
  /** Comma-separated football-data.org competition codes, e.g. "PL,PD". */
  FOOTBALL_DATA_COMPETITIONS: z.string().regex(/^[A-Z0-9]{2,5}(,[A-Z0-9]{2,5})*$/).default('PL'),
  THE_ODDS_API_KEY: z.string().optional(),
  /** Comma-separated The Odds API sport keys, e.g. "soccer_epl". */
  THE_ODDS_API_SPORTS: z.string().regex(/^[a-z0-9_]+(,[a-z0-9_]+)*$/).default('soccer_epl'),
  THE_ODDS_API_REGIONS: z.string().regex(/^[a-z]{2}(,[a-z]{2})*$/).default('eu'),
  /** Bookmaker key whose prices are shown; empty = the first bookmaker returned. */
  THE_ODDS_API_BOOKMAKER: z.string().regex(/^[a-z0-9_]*$/).optional(),
  /** Minutes between provider refreshes in live mode (each refresh costs API quota). */
  SPORTS_SYNC_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
  /** Live odds older than this stop new predictions on that market. */
  SPORTS_ODDS_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(45),
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
  // Lower costs exist for tests only; production keeps the OWASP scrypt setting (N = 2^17, r = 8, p = 1).
  if (e.SCRYPT_LOG_N < 17) problems.push('SCRYPT_LOG_N must be at least 17 in production (password hashing cost)');
  if (!e.IP_HASH_SECRET) problems.push('IP_HASH_SECRET is required');
  else if (e.IP_HASH_SECRET.length < 32) problems.push('IP_HASH_SECRET must be at least 32 characters');
  // Optional (see the schema comment), but a token that is set must be usable as one.
  if (e.METRICS_TOKEN && !/^[A-Za-z0-9._~+/=-]{24,}$/.test(e.METRICS_TOKEN)) {
    problems.push('METRICS_TOKEN, when set, must be at least 24 characters of [A-Za-z0-9._~+/=-] (leave it empty to disable /api/metrics)');
  }
  if (e.MAIL_TRANSPORT === 'console') problems.push('MAIL_TRANSPORT=console prints reset links and is development-only; use smtp or disabled');
  if (e.MAIL_TRANSPORT === 'smtp') {
    if (!e.SMTP_URL || !/^smtps?:\/\//.test(e.SMTP_URL)) problems.push('MAIL_TRANSPORT=smtp requires SMTP_URL (smtp:// or smtps://)');
    if (!e.MAIL_FROM) problems.push('MAIL_TRANSPORT=smtp requires MAIL_FROM');
  }
  if (e.SPORTS_MODE === 'live') {
    if (!e.FOOTBALL_DATA_API_KEY) problems.push('SPORTS_MODE=live requires FOOTBALL_DATA_API_KEY');
    if (!e.THE_ODDS_API_KEY) problems.push('SPORTS_MODE=live requires THE_ODDS_API_KEY');
  }
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

/**
 * The token that unlocks /api/metrics, or null when the endpoint is disabled
 * (unset, empty or whitespace-only — never treated as "no authentication").
 */
export function metricsToken(e: Pick<Env, 'METRICS_TOKEN'> = env()): string | null {
  const t = e.METRICS_TOKEN;
  return t && t.trim() ? t : null;
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
