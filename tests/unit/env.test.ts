import { describe, expect, it } from 'vitest';
import { productionProblems, type Env } from '@/server/env';

const good: Env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://casino_app:Zq8!kLm2_Rt5vWx9yAb3@db.internal:5432/casino',
  APP_URL: 'https://casino.example.org',
  SEED_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  IP_HASH_SECRET: 'x'.repeat(40),
  SCRYPT_LOG_N: 17,
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  MAIL_TRANSPORT: 'disabled',
  BACKGROUND_JOBS: true,
  RECONCILE_INTERVAL_MINUTES: 15,
  METRICS_TOKEN: undefined,
  LOG_LEVEL: 'info',
  TRUST_PROXY_HOPS: 1,
  DB_POOL_MAX: 10,
  ALLOW_PRIVILEGED_DB_ROLE: false,
} as Env;
const raw = { APP_URL: good.APP_URL };

describe('production configuration fails closed', () => {
  it('accepts a complete, strong configuration', () => {
    expect(productionProblems(good, raw)).toEqual([]);
  });

  it.each([
    ['missing seed key', { SEED_ENCRYPTION_KEY: undefined }, /SEED_ENCRYPTION_KEY is required/],
    ['short seed key', { SEED_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }, /32 bytes/],
    ['missing IP hash secret', { IP_HASH_SECRET: undefined }, /IP_HASH_SECRET is required/],
    ['weak IP hash secret', { IP_HASH_SECRET: 'e2e-ip-hash-secret' }, /at least 32/],
    ['short metrics token', { METRICS_TOKEN: 'local-metrics-token' }, /METRICS_TOKEN/],
    ['plain http on a public host', { APP_URL: 'http://casino.example.org' }, /https/],
    ['default database password', { DATABASE_URL: 'postgresql://casino:casino@db.internal:5432/casino' }, /strong, non-default password/],
    ['short database password', { DATABASE_URL: 'postgresql://app:Sh0rt-pw@db.internal:5432/casino' }, /strong, non-default password/],
  ] as const)('rejects %s', (_name, patch, pattern) => {
    const problems = productionProblems({ ...good, ...patch } as Env, { APP_URL: (patch as { APP_URL?: string }).APP_URL ?? good.APP_URL });
    expect(problems.join('; ')).toMatch(pattern);
  });

  it('requires APP_URL to be set explicitly rather than defaulted', () => {
    expect(productionProblems(good, {}).join('; ')).toMatch(/APP_URL must be set explicitly/);
  });

  it('allows loopback HTTP and a local database for production-mode tests on one machine', () => {
    const local = { ...good, APP_URL: 'http://127.0.0.1:3100', DATABASE_URL: 'postgresql://casino:casino@localhost:5432/casino_e2e' } as Env;
    expect(productionProblems(local, { APP_URL: local.APP_URL })).toEqual([]);
  });

  it('never echoes secret values in its messages', () => {
    const secret = 'super-secret-but-too-short';
    const problems = productionProblems({ ...good, IP_HASH_SECRET: secret, DATABASE_URL: `postgresql://u:${secret}@db.internal/c` } as Env, raw);
    expect(problems.join(' ')).not.toContain(secret);
  });
});
