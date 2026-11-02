import Link from 'next/link';
import { TICKET_STATUS } from '@/components/support/labels';
import { NewTicketForm } from '@/components/support/support-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { listTickets } from '@/server/support/tickets';

export const metadata = { title: 'Support' };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const session = await requireUser('/support');
  const [tickets, sp] = await Promise.all([listTickets(session.userId), searchParams]);
  return (
    <>
      <PageHeader eyebrow="Help" title="Support" subtitle="Ask us anything about your account, payments, verification, bonuses or games. Answers appear here and you are notified when we reply." />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="New request" subtitle={<>Quick answers may already be in <Link href="/help" className="text-gold-300">Help</Link>.</>} />
          <CardBody>
            <NewTicketForm defaultCategory={sp.topic} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your requests" />
          <CardBody>
            {tickets.length === 0 ? (
              <EmptyState title="No requests yet" />
            ) : (
              <ul className="divide-y divide-white/[0.06]" data-testid="ticket-list">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/support/${t.id}`} className="flex items-start justify-between gap-3 py-3 hover:text-gold-200">
                      <span className="min-w-0">
                        <span className="block truncate text-ink-100">{t.subject}</span>
                        <span className="block text-xs text-ink-400">
                          {t.categoryLabel} · updated {new Date(t.updatedAt).toLocaleString()}
                        </span>
                      </span>
                      <Badge tone={TICKET_STATUS[t.status]?.tone ?? 'info'}>{TICKET_STATUS[t.status]?.label ?? t.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
