import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness: the process is up and serving requests. No dependencies checked. */
export function GET() {
  return NextResponse.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }, { headers: { 'Cache-Control': 'no-store' } });
}
