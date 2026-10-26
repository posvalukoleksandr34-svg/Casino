import { TransactionsTable } from '@/components/account/transactions-table';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';

export const metadata = { title: 'Transaction history' };

export default async function TransactionsPage() {
  await requireUser('/wallet/transactions');
  return (
    <>
      <PageHeader
        eyebrow="Wallet"
        title="Transaction history"
        subtitle="Every change to your balance is an immutable ledger entry. Wagers are debited when placed; settlements credit any payout. Corrections, if ever needed, appear as separate entries — history is never edited."
      />
      <Card>
        <CardBody>
          <TransactionsTable />
        </CardBody>
      </Card>
    </>
  );
}
