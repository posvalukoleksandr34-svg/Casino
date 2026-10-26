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
    if (!parsed.data.SEED_ENCRYPTION_KEY) throw new Error('SEED_ENCRYPTION_KEY is required in production');
    if (!parsed.data.IP_HASH_SECRET) throw new Error('IP_HASH_SECRET is required in production');
  }
  cached = parsed.data;
  return cached;
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
