import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DepositStatus } from '@/components/cashier/cashier-actions';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { platformCurrency } from '@/server/payments/config';
import { getDeposit } from '@/server/payments/deposits';

export const metadata = { title: 'Deposit' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function DepositPage({ params }: { params: Promise<{ depositId: string }> }) {
  const { depositId } = await params;
  const session = await requireUser(`/wallet/deposits/${depositId}`);
  if (!UUID.test(depositId)) notFound();
  const deposit = await getDeposit(session.userId, depositId).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  return (
    <>
      <PageHeader eyebrow={<Link href="/wallet/deposits" className="hover:text-gold-300">Deposits</Link>} title="Deposit status" />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <DepositStatus initial={deposit} unit={platformCurrency().label} />
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Method', deposit.method],
                  ['Amount', <Chips key="a" amount={deposit.amount} />],
                  ['Fee', <Chips key="f" amount={deposit.fee} />],
                  ['To be credited', <Chips key="c" amount={deposit.credited} />],
                  ['Reference', <span key="r" className="font-mono text-xs">{deposit.reference ?? '—'}</span>],
                  ['Started', new Date(deposit.createdAt).toLocaleString()],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-white/[0.06] pb-2 last:border-0">
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="text-right text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>
            <Link href="/wallet" className="mt-4 inline-block text-sm text-gold-400 hover:text-gold-300">
              Back to the cashier →
            </Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
