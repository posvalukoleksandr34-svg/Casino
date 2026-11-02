import Link from 'next/link';
import { TopUpFlow } from '@/components/account/top-up-flow';
import { DepositFlow } from '@/components/cashier/deposit-flow';
import { WithdrawFlow } from '@/components/cashier/withdraw-flow';
import { ACTIVITY_LABELS, TX_LABELS } from '@/components/account/labels';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requireUser } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { dailyBonusStatus } from '@/server/promotions/bonuses';
import { bonusOverview } from '@/server/promotions/campaigns';
import { paymentsMode } from '@/server/payments/config';
import { depositOptions } from '@/server/payments/deposits';
import { withdrawalOptions } from '@/server/payments/withdrawals';
import { userActivity } from '@/server/users/accounts';
import { listTransactions, walletSummary } from '@/server/wallet/wallet';

export const metadata = { title: 'Cashier' };

const SECTIONS = [
  ['overview', 'Overview'],
  ['deposit', 'Deposit'],
  ['withdraw', 'Withdraw'],
  ['top-up', 'Free top-up'],
  ['bonus', 'Bonus'],
  ['history', 'Transactions'],
  ['activity', 'Account activity'],
] as const;

export default async function CashierPage() {
  const session = await requireUser('/wallet');
  const db = getDb();
  const [summary, topUp, bonus, recent, activity, deposit, withdrawal] = await Promise.all([
    walletSummary(session.userId),
    dailyBonusStatus(db, session.userId),
    bonusOverview(session.userId),
    listTransactions(session.userId, { limit: 10 }),
    userActivity(session.userId, 10),
    depositOptions(session.userId),
    withdrawalOptions(session.userId),
  ]);
  const mode = paymentsMode();
  const active = bonus.active;
  const welcome = bonus.offers.find((o) => o.eligible);
  return (
    <>
      <PageHeader
        eyebrow="Wallet"
        title="Cashier"
        subtitle={
          mode === 'sandbox'
            ? 'Your one wallet. Deposits and withdrawals here run against a payment sandbox: a simulated provider, no real money charged or paid, and a balance of virtual credits with no monetary value.'
            : 'Your one wallet of virtual credits. Credits have no monetary value: they cannot be purchased, withdrawn, transferred or exchanged for anything.'
        }
      />
      {mode === 'sandbox' && (
        <Callout tone="info" title="Test mode" className="-mt-2 mb-6" role="status">
          Payments are simulated end to end (checkout, provider confirmation, payout) so the cashier can be tried safely. Nothing is charged to a card or bank account and no card details are ever requested. Live payments stay switched off until an authorised operator has the required licence, provider contract and approvals.
        </Callout>
      )}
      <nav aria-label="Cashier sections" className="-mt-4 mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-ink-200 hover:border-gold-500/50 hover:text-ink-100">
            {label}
          </a>
        ))}
      </nav>

      <section id="overview" aria-labelledby="overview-h" className="scroll-mt-24">
        <h2 id="overview-h" className="sr-only">
          Overview
        </h2>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="surface relative overflow-hidden p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gold-400/10 blur-3xl" aria-hidden="true" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Available</div>
            <div className="num mt-2 text-4xl font-semibold text-gold-200 sm:text-5xl" data-testid="cashier-available">
              <Chips amount={summary.available} suffix={false} />
            </div>
            <div className="mt-1 text-sm text-ink-400">credits ready to play</div>
            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <dt className="text-xs text-ink-400">In play</dt>
                <dd className="num mt-0.5 font-semibold text-ink-100" data-testid="cashier-reserved">
                  <Chips amount={summary.reserved} suffix={false} />
                </dd>
                <dd className="text-[11px] text-ink-400">stakes in open rounds and predictions</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <dt className="text-xs text-ink-400">Locked bonus</dt>
                <dd className="num mt-0.5 font-semibold text-ink-100" data-testid="cashier-locked">
                  <Chips amount={summary.lockedBonus} suffix={false} />
                </dd>
                <dd className="text-[11px] text-ink-400">released when its wagering is met</dd>
              </div>
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:col-span-1">
                <dt className="text-xs text-ink-400">Pending withdrawals</dt>
                <dd className="num mt-0.5 font-semibold text-ink-100" data-testid="cashier-pending-withdrawals">
                  <Chips amount={summary.pendingWithdrawals} suffix={false} />
                </dd>
                <dd className="text-[11px] text-ink-400">requested, not yet paid out</dd>
              </div>
            </dl>
          </div>
          <div className="surface p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Lifetime</div>
            <dl className="mt-3 space-y-2.5 text-sm">
              {(
                [
                  ['Credits received', summary.totals.received, 'Starting credits, free top-ups, released bonuses, grants'],
                  ['Credits wagered', summary.totals.wagered, 'Every stake placed'],
                  ['Credits won', summary.totals.won, 'Every payout, including returned stakes'],
                  ['Refunded', summary.totals.refunded, 'Voided rounds and predictions'],
                  ['Deposited', summary.totals.deposited, 'Completed deposits, after fees'],
                  ['Withdrawn', summary.totals.withdrawn, 'Paid and pending withdrawals (returned ones excluded)'],
                ] as const
              ).map(([k, v, hint]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] pb-2 last:border-0">
                  <dt>
                    <span className="text-ink-200">{k}</span>
                    <span className="block text-[11px] text-ink-400">{hint}</span>
                  </dt>
                  <dd className="num font-semibold text-ink-100">
                    <Chips amount={v} suffix={false} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section id="deposit" aria-labelledby="deposit-h" className="scroll-mt-24">
          <Card className="h-full">
            <CardHeader
              title={<span id="deposit-h">Deposit</span>}
              subtitle="Your balance is credited only when the payment provider confirms the payment to our server."
              actions={<Link href="/wallet/deposits" className="text-sm text-gold-400 hover:text-gold-300">Deposits →</Link>}
            />
            <CardBody>
              <DepositFlow options={deposit} />
            </CardBody>
          </Card>
        </section>
        <section id="withdraw" aria-labelledby="withdraw-h" className="scroll-mt-24">
          <Card className="h-full">
            <CardHeader
              title={<span id="withdraw-h">Withdraw</span>}
              subtitle="Every condition is listed here. Nothing else is required."
              actions={<Link href="/wallet/withdrawals" className="text-sm text-gold-400 hover:text-gold-300">Withdrawals →</Link>}
            />
            <CardBody>
              <WithdrawFlow options={withdrawal} />
            </CardBody>
          </Card>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section id="top-up" aria-labelledby="top-up-h" className="scroll-mt-24">
          <Card className="h-full">
            <CardHeader title={<span id="top-up-h">Free top-up</span>} subtitle="Free virtual credits. No payment, no card, nothing to enter." />
            <CardBody>
              <TopUpFlow amount={topUp.amount} vipBonusPct={topUp.vipBonusPct} claimedToday={topUp.claimedToday} nextAvailableAt={topUp.nextAvailableAt} maxBalance={topUp.maxBalance} blockedReason={topUp.blockedReason} />
            </CardBody>
          </Card>
        </section>
        <section id="bonus" aria-labelledby="bonus-h" className="scroll-mt-24">
          <Card className="h-full">
            <CardHeader title={<span id="bonus-h">Bonus</span>} subtitle="Bonus credits are locked until their wagering is met." actions={<Link href="/promotions" className="text-sm text-gold-400 hover:text-gold-300">Promotions →</Link>} />
            <CardBody>
              {active ? (
                <div className="space-y-3" data-testid="cashier-bonus">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-100">{active.campaign}</span>
                    <span className="num font-semibold text-gold-200">
                      <Chips amount={active.amount} />
                    </span>
                  </div>
                  <WageringBar progress={active.wageringProgress} required={active.wageringRequired} />
                  <p className="text-xs text-ink-400">Expires {new Date(active.expiresAt).toLocaleDateString()}. Manage it on the Promotions page.</p>
                </div>
              ) : welcome ? (
                <EmptyState
                  title={`${welcome.name}: ${(welcome.amount / 100).toLocaleString('en-US')} bonus credits`}
                  action={
                    <Link href="/promotions" className="inline-flex h-10 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-5 text-sm font-semibold text-ink-950">
                      View offer
                    </Link>
                  }
                >
                  {welcome.description}
                </EmptyState>
              ) : (
                <EmptyState title="No bonus in progress">Have a promo code? Enter it on the Promotions page.</EmptyState>
              )}
            </CardBody>
          </Card>
        </section>
      </div>

      <section id="history" aria-labelledby="history-h" className="mt-6 scroll-mt-24">
        <Card>
          <CardHeader title={<span id="history-h">Transactions</span>} actions={<Link href="/wallet/transactions" className="text-sm text-gold-400 hover:text-gold-300">Full statement →</Link>} />
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
      </section>

      <section id="activity" aria-labelledby="activity-h" className="mt-6 scroll-mt-24">
        <Card>
          <CardHeader title={<span id="activity-h">Account activity</span>} subtitle="Sign-ins, security and wallet events on your account." actions={<Link href="/profile" className="text-sm text-gold-400 hover:text-gold-300">Profile →</Link>} />
          <CardBody>
            <ul className="divide-y divide-white/[0.06] text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2.5">
                  <span className="min-w-0 break-words text-ink-200">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
                  <span className="whitespace-nowrap text-xs text-ink-400">{a.createdAt.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>
    </>
  );
}

function WageringBar({ progress, required }: { progress: number; required: number }) {
  const pct = required > 0 ? Math.min(100, (progress / required) * 100) : 100;
  return (
    <div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label="Wagering progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-xs text-ink-400">
        <span>
          Wagered <Chips amount={progress} suffix={false} /> of <Chips amount={required} suffix={false} />
        </span>
        <span>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
