import Link from 'next/link';
import { CancelButton } from '@/components/cashier/cashier-actions';
import { WITHDRAWAL_STATUS } from '@/components/cashier/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requireUser } from '@/server/auth/current';
import { listWithdrawals } from '@/server/payments/withdrawals';

export const metadata = { title: 'Withdrawals' };

export default async function WithdrawalsPage() {
  const session = await requireUser('/wallet/withdrawals');
  const rows = await listWithdrawals(session.userId);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/wallet" className="hover:text-gold-300">Cashier</Link>}
        title="Withdrawals"
        subtitle="The amount of a withdrawal leaves your balance when you request it. If it is rejected, cancelled or fails, the full amount comes back."
        actions={<Link href="/wallet#withdraw" className="inline-flex h-10 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-5 text-sm font-semibold text-ink-950">New withdrawal</Link>}
      />
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="No withdrawals yet">Withdrawals you request in the cashier appear here.</EmptyState>
          ) : (
            <Table data-testid="withdrawals-table">
              <thead>
                <tr>
                  <Th>Requested</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Fee</Th>
                  <Th className="text-right">Payout</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const s = WITHDRAWAL_STATUS[w.status] ?? { label: w.status, tone: 'info' as const };
                  return (
                    <Tr key={w.id}>
                      <Td className="whitespace-nowrap text-ink-400">{new Date(w.requestedAt).toLocaleString()}</Td>
                      <Td>
                        {w.method} {w.sandbox && <Badge tone="info">Test</Badge>}
                      </Td>
                      <Td className="text-right"><Chips amount={w.amount} suffix={false} /></Td>
                      <Td className="text-right"><Chips amount={w.fee} suffix={false} /></Td>
                      <Td className="text-right"><Chips amount={w.payout} suffix={false} /></Td>
                      <Td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {(w.failureReason || (w.status === 'REJECTED' && w.reviewNote)) && <span className="mt-0.5 block text-xs text-ink-400">{w.status === 'REJECTED' ? w.reviewNote : w.failureReason}</span>}
                        {w.completedAt && <span className="mt-0.5 block text-xs text-ink-400">Paid {new Date(w.completedAt).toLocaleString()}</span>}
                      </Td>
                      <Td className="text-right">{w.cancellable && <CancelButton kind="withdrawal" id={w.id} />}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
