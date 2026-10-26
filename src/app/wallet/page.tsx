import Link from 'next/link';
import { DailyBonus } from '@/components/account/daily-bonus';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requireUser } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { getWalletAccount } from '@/server/ledger/accounts';
import { dailyBonusStatus } from '@/server/promotions/bonuses';
import { playTotals } from '@/server/responsible/limits';
import { listTransactions } from '@/server/wallet/wallet';
import { TX_LABELS } from '@/components/account/labels';

export const metadata = { title: 'Wallet' };

export default async function WalletPage() {
  const session = await requireUser('/wallet');
  const db = getDb();
  const [wallet, bonus, totals, recent] = await Promise.all([
    getWalletAccount(db, session.userId),
    dailyBonusStatus(db, session.userId),
    playTotals(db, session.userId, new Date()),
    listTransactions(session.userId, { limit: 8 }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Wallet" title="Your chips" subtitle="Virtual currency only. Chips cannot be purchased, withdrawn, transferred or exchanged for anything of value." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Balance" value={<Chips amount={wallet?.balance ?? 0} />} tone="gold" />
        <Stat label="Wagered (24h)" value={<Chips amount={totals.wagered24h} />} />
        <Stat label="Net result (24h)" value={<Chips amount={-totals.netLoss24h} sign colored />} sub="Payouts received minus stakes placed" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Daily chips" subtitle="A small virtual top-up so you can keep playing for fun." />
        <CardBody>
          <DailyBonus amount={bonus.amount} claimedToday={bonus.claimedToday} nextAvailableAt={bonus.nextAvailableAt} maxBalance={bonus.maxBalance} />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recent activity" actions={<Link href="/wallet/transactions" className="text-sm text-gold-400 hover:text-gold-300">Full statement →</Link>} />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Description</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <Tr key={t.entryId}>
                  <Td className="whitespace-nowrap text-ink-400">{new Date(t.createdAt).toLocaleString()}</Td>
                  <Td>{TX_LABELS[t.type] ?? t.type}</Td>
                  <Td>{t.roundId ? <Link href={`/history/${t.roundId}`} className="hover:text-gold-300">{t.description}</Link> : t.description}</Td>
                  <Td className="text-right">
                    <Chips amount={t.amount} sign colored suffix={false} />
                  </Td>
                  <Td className="text-right">{t.balanceAfter !== null && <Chips amount={t.balanceAfter} suffix={false} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
