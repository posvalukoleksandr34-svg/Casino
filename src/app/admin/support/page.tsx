import Link from 'next/link';
import { TICKET_STATUS } from '@/components/support/labels';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { supportQueue } from '@/server/support/tickets';

export const metadata = { title: 'Support' };

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requirePermission('support:manage');
  const view = (await searchParams).view === 'all' ? 'all' : 'open';
  const tickets = await supportQueue(view);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Support" subtitle="Priority tickets (VIP perk) first, then the longest waiting." />
      <Card>
        <CardHeader
          title={view === 'open' ? 'Open tickets' : 'All tickets'}
          actions={
            <Link href={view === 'open' ? '?view=all' : '/admin/support'} className="text-xs text-gold-400 hover:text-gold-300">
              {view === 'open' ? 'Show all' : 'Only open'}
            </Link>
          }
        />
        <CardBody>
          {tickets.length === 0 ? (
            <EmptyState title="No tickets" />
          ) : (
            <Table data-testid="support-queue">
              <thead>
                <tr>
                  <Th>Subject</Th>
                  <Th>Player</Th>
                  <Th>Topic</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link href={`/admin/support/${t.id}`} className="font-medium text-ink-100 hover:text-gold-300">
                        {t.subject}
                      </Link>{' '}
                      {t.priority === 'HIGH' && <Badge tone="gold">priority</Badge>}
                    </Td>
                    <Td>{t.username}</Td>
                    <Td className="text-ink-300">{t.categoryLabel}</Td>
                    <Td>
                      <Badge tone={TICKET_STATUS[t.status]?.tone ?? 'info'}>{t.status === 'OPEN' ? 'needs reply' : (TICKET_STATUS[t.status]?.label ?? t.status).toLowerCase()}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(t.updatedAt).toLocaleString()}</Td>
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
