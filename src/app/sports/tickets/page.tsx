import Link from 'next/link';
import { TicketsList } from '@/components/sports/tickets-list';
import { Chips, PageHeader, Stat } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { sportsStats } from '@/server/sports/tickets';

export const metadata = { title: 'My predictions' };

export default async function SportsTicketsPage() {
  const session = await requireUser('/sports/tickets');
  const s = await sportsStats(session.userId);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/sports" className="hover:text-gold-300">← Sports</Link>}
        title="My predictions"
        subtitle="Staked is turnover, not a gain. Returned includes refunds of voided predictions. Rejected predictions moved no chips."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Predictions" value={s.tickets.toLocaleString()} sub={`${s.open} open · ${s.won} won · ${s.lost} lost · ${s.voided} void · ${s.rejected} rejected`} />
        <Stat label="Staked" value={<Chips amount={s.staked} />} />
        <Stat label="Returned" value={<Chips amount={s.returned} />} />
        <Stat label="Net on settled" value={<Chips amount={s.net} sign colored />} />
      </div>
      <div className="mt-6">
        <TicketsList />
      </div>
    </>
  );
}
