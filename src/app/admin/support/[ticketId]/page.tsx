import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TicketStaffActions } from '@/components/admin/compliance-controls';
import { TICKET_STATUS } from '@/components/support/labels';
import { ReplyForm } from '@/components/support/support-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { staffTicket } from '@/server/support/tickets';

export const metadata = { title: 'Ticket' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await requirePermission('support:manage');
  const { ticketId } = await params;
  if (!UUID.test(ticketId)) notFound();
  const { ticket, messages } = await staffTicket(ticketId).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const own = ticket.userId === session.userId;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/support" className="hover:text-gold-300">Support</Link>}
        title={ticket.subject}
        subtitle={`${ticket.categoryLabel} · ${ticket.username} · opened ${new Date(ticket.createdAt).toLocaleString()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ticket.priority === 'HIGH' && <Badge tone="gold">priority</Badge>}
            <Badge tone={TICKET_STATUS[ticket.status]?.tone ?? 'info'}>{ticket.status.toLowerCase().replace('_', ' ')}</Badge>
            {!own && ticket.status !== 'CLOSED' && <TicketStaffActions id={ticket.id} status={ticket.status} assigned={Boolean(ticket.assignedTo)} />}
          </div>
        }
      />
      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={cn('rounded-2xl border p-4', m.internal ? 'border-warning/30 bg-warning/[0.05]' : m.fromStaff ? 'border-gold-500/25 bg-gold-500/[0.05]' : 'border-white/10 bg-white/[0.03]')}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-ink-200">
                {m.author} {m.internal && <Badge tone="warning">internal note</Badge>}
              </span>
              <span className="text-ink-400">{new Date(m.createdAt).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-ink-100">{m.body}</p>
            {m.attachments.map((a) => (
              <a key={a.id} href={`/api/support/attachments/${a.id}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-gold-300 hover:border-gold-400/50">
                📎 {a.fileName}
              </a>
            ))}
          </div>
        ))}
      </div>
      {own ? (
        <p className="mt-6 text-sm text-ink-400">This is your own ticket: another agent must answer it.</p>
      ) : ticket.status !== 'CLOSED' ? (
        <Card className="mt-6">
          <CardBody>
            <ReplyForm path={`/api/admin/support/${ticket.id}/messages`} staff />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
