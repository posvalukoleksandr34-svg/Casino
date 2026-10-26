import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/server/crypto';
import { metricsToken } from '@/server/env';
import { metrics } from '@/server/observability/metrics';

export const dynamic = 'force-dynamic';

/**
 * Prometheus metrics; requires `Authorization: Bearer $METRICS_TOKEN`.
 * Optional feature: without a configured token the endpoint is disabled and
 * refuses every request (403), whatever the request carries.
 */
export function GET(req: NextRequest) {
  const token = metricsToken();
  const auth = req.headers.get('authorization') ?? '';
  if (token === null || !safeEqual(auth, `Bearer ${token}`)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Metrics are not available' } }, { status: 403 });
  }
  return new NextResponse(metrics.render(), { headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } });
}
