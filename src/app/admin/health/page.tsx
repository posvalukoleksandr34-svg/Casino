import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { MailCheck } from '@/components/admin/mail-check';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { operationalHealth } from '@/server/observability/health';
import { metrics } from '@/server/observability/metrics';

export const metadata = { title: 'System health' };

function utc(iso: string | null | undefined) {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—';
}

export default async function HealthPage() {
  const session = await requirePermission('system:read');
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
      {h.passwordRecovery !== 'email' && (
        <Callout tone="warning" className="mt-6" title={h.passwordRecovery === 'console' ? 'E-mail is printed, not delivered' : 'Registration is closed: no e-mail provider'}>
          {h.passwordRecovery === 'console'
            ? 'MAIL_TRANSPORT=console: verification codes and reset links are printed to the server console (development only).'
            : 'No e-mail provider is configured (MAIL_TRANSPORT=disabled). New players cannot register (a verification code cannot be sent), and password recovery is unavailable. Configure SMTP_URL and MAIL_FROM — see docs/operations.md.'}
        </Callout>
      )}
      <Card className="mt-6">
        <CardHeader title="E-mail delivery" subtitle="Verification codes, password resets and security notices. Counts are for this instance since it started." />
        <CardBody className="space-y-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Transport</dt>
              <dd className="mt-1 text-ink-100" data-testid="mail-transport">
                {h.mail.transport}
                {h.mail.transport === 'smtp' ? '' : h.mail.transport === 'console' ? ' (development only)' : h.mail.transport === 'disabled' ? ' (registration closed)' : ''}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Last connection check</dt>
              <dd className="mt-1 text-ink-100">
                {h.mail.lastVerify ? (
                  <>
                    <StatusBadge status={h.mail.lastVerify.ok ? 'OK' : 'ERROR'} /> <span className="text-xs text-ink-400">{utc(h.mail.lastVerify.at)}</span>
                  </>
                ) : (
                  'Not checked yet'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Sent / failed</dt>
              <dd className="num mt-1 text-ink-100">
                {h.mail.sent} / {h.mail.failed}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Last success</dt>
              <dd className="mt-1 text-ink-100">{utc(h.mail.lastSuccessAt)}</dd>
            </div>
          </dl>
          {h.mail.lastVerify && !h.mail.lastVerify.ok && h.mail.lastVerify.reason && (
            <Callout tone="negative" title="Connection check failed">
              {h.mail.lastVerify.reason}
            </Callout>
          )}
          {h.mail.lastFailure && (
            <Callout tone="warning" title={`Last delivery failure (${h.mail.lastFailure.kind}) · ${utc(h.mail.lastFailure.at)}`}>
              {h.mail.lastFailure.reason} Purpose: {h.mail.lastFailure.purpose}
              {h.mail.lastFailure.responseCode ? ` · SMTP ${h.mail.lastFailure.responseCode}` : ''}
              {h.mail.lastFailure.code ? ` · ${h.mail.lastFailure.code}` : ''}.
            </Callout>
          )}
          <MailCheck canOperate={hasPermission(session.role, 'system:operate')} email={session.email} />
        </CardBody>
      </Card>
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
      <p className="mt-6 text-xs text-ink-400">
        Liveness: <code>GET /api/health</code> · Readiness: <code>GET /api/health/ready</code> · Prometheus metrics: <code>GET /api/metrics</code> (bearer token).
      </p>
    </>
  );
}
