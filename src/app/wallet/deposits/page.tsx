import Link from 'next/link';
import { CancelButton } from '@/components/cashier/cashier-actions';
import { DEPOSIT_STATUS } from '@/components/cashier/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requireUser } from '@/server/auth/current';
import { listDeposits } from '@/server/payments/deposits';

export const metadata = { title: 'Deposits' };

export default async function DepositsPage() {
  const session = await requireUser('/wallet/deposits');
  const rows = await listDeposits(session.userId);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/wallet" className="hover:text-gold-300">Cashier</Link>}
        title="Deposits"
        subtitle="Every deposit you started, with the status reported by the payment provider. A deposit adds to your balance only once it is completed."
        actions={<Link href="/wallet#deposit" className="inline-flex h-10 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-5 text-sm font-semibold text-ink-950">New deposit</Link>}
      />
      <Card>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="No deposits yet">Deposits you make in the cashier appear here.</EmptyState>
          ) : (
            <Table data-testid="deposits-table">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Fee</Th>
                  <Th className="text-right">Credited</Th>
                  <Th>Status</Th>
                  <Th>Reference</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const s = DEPOSIT_STATUS[d.status] ?? { label: d.status, tone: 'info' as const };
                  return (
                    <Tr key={d.id}>
                      <Td className="whitespace-nowrap text-ink-400">
                        <Link href={`/wallet/deposits/${d.id}`} className="hover:text-gold-300">
                          {new Date(d.createdAt).toLocaleString()}
                        </Link>
                      </Td>
                      <Td>
                        {d.method} {d.sandbox && <Badge tone="info">Test</Badge>}
                      </Td>
                      <Td className="text-right"><Chips amount={d.amount} suffix={false} /></Td>
                      <Td className="text-right"><Chips amount={d.fee} suffix={false} /></Td>
                      <Td className="text-right">{d.status === 'COMPLETED' ? <Chips amount={d.credited} suffix={false} /> : <span className="text-ink-400">—</span>}</Td>
                      <Td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {d.failureReason && <span className="mt-0.5 block text-xs text-ink-400">{d.failureReason}</span>}
                      </Td>
                      <Td className="font-mono text-xs text-ink-400">{d.reference ?? '—'}</Td>
                      <Td className="text-right">
                        {d.status === 'PENDING' && (
                          <span className="inline-flex items-center gap-2">
                            {d.sandbox && (
                              <Link href={`/wallet/sandbox-checkout/${d.id}`} className="text-sm text-gold-400 hover:text-gold-300">
                                Pay
                              </Link>
                            )}
                            <CancelButton kind="deposit" id={d.id} />
                          </span>
                        )}
                      </Td>
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
