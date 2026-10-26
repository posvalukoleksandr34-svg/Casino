import { NextResponse } from 'next/server';
import { readiness } from '@/server/observability/health';
import { logger } from '@/server/observability/logger';

export const dynamic = 'force-dynamic';

/**
 * Readiness: database reachable with a least-privilege role, migrations
 * applied, reference data present. Public, so failure details (which can name
 * hosts or database users) are logged server-side and never returned; staff
 * see them in /admin/health.
 */
export async function GET() {
  const report = await readiness();
  for (const c of report.checks) if (!c.ok) logger.warn('readiness check failed', { check: c.name, detail: c.detail });
  const body = {
    status: report.status,
    checkedAt: report.checkedAt,
    checks: report.checks.map((c) => ({ name: c.name, ok: c.ok, ms: c.ms })),
  };
  return NextResponse.json(body, { status: report.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
