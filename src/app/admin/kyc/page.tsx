import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { kycQueue } from '@/server/kyc/kyc';

export const metadata = { title: 'Verification' };

export default async function AdminKycPage() {
  await requirePermission('kyc:review');
  const queue = await kycQueue();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Identity verification"
        subtitle="Submissions waiting for a decision, oldest first. Decisions are made by people: there is no automated identity provider. Every document you open is recorded in the audit log."
      />
      <Card>
        <CardHeader title="Queue" />
        <CardBody>
          {queue.length === 0 ? (
            <EmptyState title="No submissions waiting" />
          ) : (
            <Table data-testid="kyc-queue">
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th>Submitted</Th>
                  <Th>Account age</Th>
                  <Th>Flags</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <Tr key={q.id}>
                    <Td className="font-medium text-ink-100">{q.username}</Td>
                    <Td className="text-ink-400">{q.updatedAt ? new Date(q.updatedAt).toLocaleString() : '—'}</Td>
                    <Td className="text-ink-400">{Math.max(0, Math.floor((Date.now() - Date.parse(q.createdAt)) / 86_400_000))} days</Td>
                    <Td>{q.openFlags > 0 ? <Badge tone="negative">{q.openFlags} open</Badge> : <span className="text-ink-400">—</span>}</Td>
                    <Td className="text-right">
                      <Link href={`/admin/kyc/${q.id}`} className="text-sm text-gold-400 hover:text-gold-300">
                        Review →
                      </Link>
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
