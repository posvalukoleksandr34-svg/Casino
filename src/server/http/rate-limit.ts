/**
 * Fixed-window rate limiter backed by PostgreSQL, so limits hold across
 * multiple application instances without extra infrastructure.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { errors } from '../errors';
import { metrics } from '../observability/metrics';

export interface RateLimitRule {
  /** Logical bucket name, e.g. "login:ip". */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
  /** What the bucket is keyed on. */
  by: 'ip' | 'user';
}

export async function consume(rule: RateLimitRule, subject: string): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const res = await getDb().execute<{ count: number }>(sql`
    INSERT INTO rate_limit_buckets (key, window_start, count)
    VALUES (${`${rule.name}:${subject}`}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count`);
  const count = Number(res.rows[0]?.count ?? 0);
  if (count > rule.limit) {
    metrics.inc('casino_rate_limited_total', { rule: rule.name });
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    throw errors.rateLimited(retryAfter);
  }
}

export async function purgeExpiredBuckets(olderThanSeconds = 3600): Promise<number> {
  const res = await getDb().execute(sql`DELETE FROM rate_limit_buckets WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})`);
  return res.rowCount ?? 0;
}

export const RATE_LIMITS = {
  loginIp: { name: 'login:ip', limit: 20, windowSeconds: 300, by: 'ip' },
  registerIp: { name: 'register:ip', limit: 10, windowSeconds: 3600, by: 'ip' },
  passwordResetIp: { name: 'pwreset:ip', limit: 5, windowSeconds: 900, by: 'ip' },
  betUser: { name: 'bet:user', limit: 30, windowSeconds: 10, by: 'user' },
  actionUser: { name: 'action:user', limit: 60, windowSeconds: 10, by: 'user' },
  mutateUser: { name: 'mutate:user', limit: 30, windowSeconds: 60, by: 'user' },
  readUser: { name: 'read:user', limit: 300, windowSeconds: 60, by: 'user' },
  adminUser: { name: 'admin:user', limit: 600, windowSeconds: 60, by: 'user' },
  /** A manual reconciliation run re-reads every ledger table: a handful per staff member per 10 minutes. */
  reconcileRun: { name: 'reconcile:user', limit: 5, windowSeconds: 600, by: 'user' },
  /** Second-factor attempts per account (keyed by the challenge's user): 6-digit codes cannot be brute-forced. */
  mfaUser: { name: 'mfa:user', limit: 5, windowSeconds: 300, by: 'user' },
} as const satisfies Record<string, RateLimitRule>;
