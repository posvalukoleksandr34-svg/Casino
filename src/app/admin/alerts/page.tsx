import Link from 'next/link';
import { ReasonedAction } from '@/components/admin/reasoned-action';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { listAlerts } from '@/server/admin/admin-service';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Alerts' };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await requirePermission('system:read');
  const sp = await searchParams;
  const all = sp.all === '1';
  const alerts = await listAlerts({ includeAcknowledged: all });
  const canAck = hasPermission(session.role, 'system:operate');
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Alerts"
        subtitle="Raised automatically for statistically significant RTP deviations (|z| above the configured threshold with at least 200 rounds), exposure near limits, thin reserves and reconciliation mismatches."
        actions={<Link href={all ? '/admin/alerts' : '/admin/alerts?all=1'} className="text-sm text-gold-400">{all ? 'Show open only' : 'Show acknowledged too'}</Link>}
      />
      <Card>
        <CardBody>
          {alerts.length === 0 ? (
            <EmptyState title="No alerts">Nothing requires attention.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Raised</Th>
                  <Th>Severity</Th>
                  <Th>Kind</Th>
                  <Th>Message</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs text-ink-400">{a.createdAt.toLocaleString()}</Td>
                    <Td><StatusBadge status={a.severity} /></Td>
                    <Td className="text-xs">{a.kind}</Td>
                    <Td>
                      {a.message}
                      <details className="mt-1 text-xs text-ink-400">
                        <summary className="cursor-pointer">details</summary>
                        <pre className="mt-1 overflow-x-auto">{JSON.stringify(a.details, null, 2)}</pre>
                      </details>
                    </Td>
                    <Td className="text-right">
                      {a.acknowledgedAt ? (
                        <span className="text-xs text-ink-400">ack {a.acknowledgedAt.toLocaleString()}</span>
                      ) : canAck ? (
                        <ReasonedAction label="Acknowledge" title="Acknowledge alert" path={`/api/admin/alerts/${a.id}/ack`} body={(reason) => ({ reason })} />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
