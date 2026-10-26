import { NextResponse } from 'next/server';
import { readiness } from '@/server/observability/health';

export const dynamic = 'force-dynamic';

/** Readiness: database reachable, migrations applied, reference data present. */
export async function GET() {
  const report = await readiness();
  return NextResponse.json(report, { status: report.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
