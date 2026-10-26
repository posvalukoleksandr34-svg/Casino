import { RunReconciliation } from '@/components/admin/simple-actions';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { listReconciliations } from '@/server/admin/admin-service';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Reconciliation' };

interface Check {
  name: string;
  description: string;
  mismatches: number;
  sample: unknown[];
}

export default async function ReconciliationPage() {
  const session = await requirePermission('system:read');
  const runs = await listReconciliations(25);
  const latest = runs[0];
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Reconciliation"
        subtitle="Independent re-derivation of every financial invariant from the raw ledger, in a single consistent snapshot. Runs on a schedule and on demand."
        actions={hasPermission(session.role, 'system:operate') ? <RunReconciliation /> : undefined}
      />
      {latest ? (
        <Card>
          <CardHeader title={`Latest run #${latest.id}`} subtitle={`${latest.startedAt.toLocaleString()} · ${latest.triggeredBy}`} actions={<StatusBadge status={latest.status} />} />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Check</Th>
                  <Th>Invariant</Th>
                  <Th className="text-right">Mismatches</Th>
                </tr>
              </thead>
              <tbody>
                {((latest.checks as Check[]) ?? []).map((c) => (
                  <Tr key={c.name}>
                    <Td className="font-mono text-xs">{c.name}</Td>
                    <Td>
                      {c.description}
                      {c.mismatches > 0 && <pre className="mt-1 max-h-40 overflow-auto text-xs text-negative">{JSON.stringify(c.sample, null, 2)}</pre>}
                    </Td>
                    <Td className={c.mismatches ? 'num text-right text-negative' : 'num text-right text-positive'}>{c.mismatches}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : (
        <EmptyState title="No runs yet">Run reconciliation to verify the ledger.</EmptyState>
      )}
      <Card className="mt-6">
        <CardHeader title="History" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Started</Th>
                <Th>Trigger</Th>
                <Th>Status</Th>
                <Th className="text-right">Mismatches</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <Tr key={r.id}>
                  <Td className="num">#{r.id}</Td>
                  <Td className="text-ink-400">{r.startedAt.toLocaleString()}</Td>
                  <Td className="text-xs">{r.triggeredBy}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="num text-right">{r.mismatchCount}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
