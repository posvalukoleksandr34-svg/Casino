/**
 * Security events for refused access to staff-only functions: a signed-in
 * account without the permission (an API call answered 403, or an admin page
 * answered 404). Written to the audit log with outcome DENIED, at most
 * DENIED_LOG_LIMIT per account per 10 minutes so the log cannot be flooded;
 * logging never changes the response the caller gets.
 */
import { sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { getDb } from '../db/client';
import { captureError } from '../observability/errors';
import { metrics } from '../observability/metrics';

export const DENIED_LOG_LIMIT = 20;
const WINDOW_MS = 600_000;

export async function recordAccessDenied(input: {
  userId: string;
  permission: string;
  target: string;
  requestId?: string | null;
  ipHash?: string | null;
}): Promise<void> {
  metrics.inc('casino_access_denied_total', { permission: input.permission });
  try {
    const windowStart = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
    const res = await getDb().execute<{ count: number }>(sql`
      INSERT INTO rate_limit_buckets (key, window_start, count)
      VALUES (${`audit-denied:${input.userId}`}, ${windowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count`);
    if (Number(res.rows[0]?.count ?? 0) > DENIED_LOG_LIMIT) return;
    await audit(getDb(), {
      actorId: input.userId,
      actorType: 'USER',
      action: 'security.access_denied',
      resourceType: 'permission',
      resourceId: input.permission,
      outcome: 'DENIED',
      requestId: input.requestId ?? null,
      ipHash: input.ipHash ?? null,
      metadata: { target: input.target.slice(0, 120) },
    });
  } catch (err) {
    captureError(err, { route: 'security:access_denied' });
  }
}
