import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/server/crypto';
import { env } from '@/server/env';
import { metrics } from '@/server/observability/metrics';

export const dynamic = 'force-dynamic';

/** Prometheus metrics; requires `Authorization: Bearer $METRICS_TOKEN`. Disabled when no token is configured. */
export function GET(req: NextRequest) {
  const token = env().METRICS_TOKEN;
  const auth = req.headers.get('authorization') ?? '';
  if (!token || !safeEqual(auth, `Bearer ${token}`)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Metrics are not available' } }, { status: 403 });
  }
  return new NextResponse(metrics.render(), { headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } });
}
