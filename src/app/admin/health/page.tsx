import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { operationalHealth } from '@/server/observability/health';
import { metrics } from '@/server/observability/metrics';

export const metadata = { title: 'System health' };

export default async function HealthPage() {
  await requirePermission('system:read');
  const h = await operationalHealth();
  const requests = metrics.counterTotal('http_requests_total');
  const server = metrics.counterTotal('http_requests_total', (k) => /status="5\d\d"/.test(k));
  return (
    <>
      <PageHeader eyebrow="Admin" title="System health" subtitle="Readiness checks, database pool, process resources and error rates for this application instance." actions={<StatusBadge status={h.status === 'ok' ? 'OK' : 'ERROR'} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Uptime" value={`${Math.floor(h.process.uptimeSeconds / 3600)}h ${Math.floor((h.process.uptimeSeconds % 3600) / 60)}m`} sub={h.process.node} />
        <Stat label="Memory (RSS)" value={`${h.process.rssMb} MB`} sub={`heap ${h.process.heapUsedMb} MB`} />
        <Stat label="DB pool" value={`${h.pool.total - h.pool.idle}/${h.pool.total} busy`} sub={`${h.pool.waiting} waiting`} />
        <Stat label="Server error rate" value={requests ? `${((server / requests) * 100).toFixed(2)}%` : '—'} sub={`${server} of ${requests} requests since start · ${h.errors.last_day} logged errors in 24 h`} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Readiness checks" subtitle={`Checked ${new Date(h.checkedAt).toLocaleString()}`} />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Check</Th>
                <Th>Status</Th>
                <Th>Detail</Th>
                <Th className="text-right">Latency</Th>
              </tr>
            </thead>
            <tbody>
              {h.checks.map((c) => (
                <Tr key={c.name}>
                  <Td className="font-mono text-xs">{c.name}</Td>
                  <Td><StatusBadge status={c.ok ? 'OK' : 'ERROR'} /></Td>
                  <Td className="text-xs text-ink-400">{c.detail ?? ''}</Td>
                  <Td className="num text-right text-xs">{c.ms} ms</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <p className="mt-6 text-xs text-ink-500">
        Liveness: <code>GET /api/health</code> · Readiness: <code>GET /api/health/ready</code> · Prometheus metrics: <code>GET /api/metrics</code> (bearer token).
      </p>
    </>
  );
}
