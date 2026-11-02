import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TICKET_STATUS } from '@/components/support/labels';
import { CloseTicket, ReplyForm } from '@/components/support/support-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { requireUser } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { getTicket } from '@/server/support/tickets';

export const metadata = { title: 'Support request' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const session = await requireUser(`/support/${ticketId}`);
  if (!UUID.test(ticketId)) notFound();
  const { ticket, messages } = await getTicket(session.userId, ticketId).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const status = TICKET_STATUS[ticket.status];
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/support" className="hover:text-gold-300">Support</Link>}
        title={ticket.subject}
        subtitle={`${ticket.categoryLabel} · opened ${new Date(ticket.createdAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={status?.tone ?? 'info'}>{status?.label ?? ticket.status}</Badge>
            {ticket.status !== 'CLOSED' && <CloseTicket id={ticket.id} />}
          </div>
        }
      />
      <div className="space-y-4" data-testid="ticket-thread">
        {messages.map((m) => (
          <div key={m.id} className={cn('rounded-2xl border p-4', m.fromStaff ? 'border-gold-500/25 bg-gold-500/[0.05]' : 'border-white/10 bg-white/[0.03]')}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className={m.fromStaff ? 'font-semibold text-gold-200' : 'font-semibold text-ink-200'}>{m.author}</span>
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
      {ticket.status !== 'CLOSED' ? (
        <Card className="mt-6">
          <CardBody>
            <ReplyForm path={`/api/support/tickets/${ticket.id}/messages`} />
          </CardBody>
        </Card>
      ) : (
        <p className="mt-6 text-sm text-ink-400">
          This request is closed. <Link href="/support" className="text-gold-300">Open a new one</Link> if you need more help.
        </p>
      )}
    </>
  );
}
