import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { metricsToken } from '@/server/env';
import { latestReconciliation } from '@/server/jobs/reconciliation';
import { metrics } from '@/server/observability/metrics';

export const dynamic = 'force-dynamic';

/** Point-in-time gauges taken at scrape: database reachability, reconciliation outcome, open alerts. */
async function sampleGauges(): Promise<void> {
  try {
    await getDb().execute(sql`SELECT 1`);
    metrics.set('casino_database_up', {}, 1);
  } catch {
    metrics.set('casino_database_up', {}, 0);
    return;
  }
  const [recon, alerts] = await Promise.all([
    latestReconciliation().catch(() => null),
    getDb()
      .execute<{ severity: string; n: number }>(sql`SELECT severity, count(*)::int AS n FROM alerts WHERE acknowledged_at IS NULL GROUP BY severity`)
      .catch(() => null),
  ]);
  if (recon) {
    metrics.set('casino_reconciliation_ok', {}, recon.status === 'OK' ? 1 : 0);
    metrics.set('casino_reconciliation_mismatches', {}, recon.mismatch_count);
    metrics.set('casino_reconciliation_last_run_timestamp_seconds', {}, Math.floor(new Date(recon.started_at).getTime() / 1000));
  }
  for (const severity of ['INFO', 'WARNING', 'CRITICAL']) {
    metrics.set('casino_open_alerts', { severity }, alerts?.rows.find((r) => r.severity === severity)?.n ?? 0);
  }
}

/**
 * Prometheus metrics; requires `Authorization: Bearer $METRICS_TOKEN`.
 * Optional feature: without a configured token the endpoint is disabled and
 * refuses every request (403), whatever the request carries.
 */
export async function GET(req: NextRequest) {
  const token = metricsToken();
  const auth = req.headers.get('authorization') ?? '';
  if (token === null || !safeEqual(auth, `Bearer ${token}`)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Metrics are not available' } }, { status: 403 });
  }
  await sampleGauges();
  return new NextResponse(metrics.render(), { headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } });
}
