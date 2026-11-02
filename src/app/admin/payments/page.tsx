import Link from 'next/link';
import { CashierSettingsForm, FailDeposit, MethodForm, SandboxPayoutButtons, WithdrawalReview } from '@/components/admin/payment-controls';
import { DEPOSIT_STATUS, WITHDRAWAL_STATUS } from '@/components/cashier/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatChips } from '@/engine/money';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { getDb } from '@/server/db/client';
import { adminDeposits, adminPaymentEvents, adminWithdrawals, financeSummary, listMethods } from '@/server/payments/admin';
import { getCashierSettings } from '@/server/payments/config';

export const metadata = { title: 'Payments' };

const DEPOSIT_FILTERS = ['UNDER_REVIEW', 'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'] as const;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ deposits?: string; events?: string }> }) {
  const session = await requirePermission('payments:read');
  const canReview = hasPermission(session.role, 'payments:review');
  const canConfigure = hasPermission(session.role, 'payments:configure');
  const sp = await searchParams;
  const depositFilter = DEPOSIT_FILTERS.find((s) => s === sp.deposits);
  const [summary, queue, processing, deposits, events, settings, methods] = await Promise.all([
    financeSummary(),
    adminWithdrawals({ view: 'queue' }),
    adminWithdrawals({ view: 'processing' }),
    adminDeposits({ status: depositFilter, limit: 50 }),
    adminPaymentEvents({ invalidOnly: sp.events === 'invalid', limit: 50 }),
    getCashierSettings(getDb()),
    listMethods(),
  ]);
  const unit = summary.currency.label;
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Payments"
        subtitle="Deposits, the withdrawal queue, the provider event log and the cashier rules. Staff cannot change amounts or credit a wallet by hand: balances move only through verified provider events and audited decisions."
      />
      <Callout tone={summary.mode === 'sandbox' ? 'info' : 'neutral'} title={summary.mode === 'sandbox' ? 'Sandbox mode' : 'Payments disabled'} className="mb-6">
        {summary.mode === 'sandbox'
          ? 'All methods use the sandbox provider: payments and payouts are simulated, no money moves. There is no live provider in this code base; docs/payments.md lists what an authorised operator must supply.'
          : 'PAYMENTS_MODE is disabled: players cannot start deposits or withdrawals and webhooks are refused.'}
      </Callout>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Deposits completed" value={<Chips amount={summary.deposits.completed} suffix={false} />} sub={unit} />
        <Stat label="Deposit fees" value={<Chips amount={summary.deposits.fees} suffix={false} />} />
        <Stat label="Paid out" value={<Chips amount={summary.withdrawals.paid} suffix={false} />} sub={unit} />
        <Stat label="Held for withdrawals" value={<Chips amount={summary.withdrawals.held} suffix={false} />} />
        <Stat label="Review queue" value={summary.withdrawals.queue} tone={summary.withdrawals.queue ? 'gold' : undefined} sub={`${summary.deposits.underReview} deposit(s) under review`} />
        <Stat label="Rejected webhooks (24 h)" value={summary.rejectedWebhooks24h} tone={summary.rejectedWebhooks24h ? 'negative' : undefined} />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Withdrawal queue"
          subtitle={`Manual review from ${formatChips(settings.reviewThreshold)}; two different approvers from ${formatChips(settings.dualApprovalThreshold)}. Nobody can decide their own withdrawal.`}
        />
        <CardBody>
          {queue.length === 0 ? (
            <EmptyState title="Nothing to review" />
          ) : (
            <Table data-testid="withdrawal-queue">
              <thead>
                <tr>
                  <Th>Requested</Th>
                  <Th>Player</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Checks</Th>
                  <Th>Approvals</Th>
                  {canReview && <Th />}
                </tr>
              </thead>
              <tbody>
                {queue.map((w) => (
                  <Tr key={w.id}>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(w.requestedAt).toLocaleString()}</Td>
                    <Td>
                      <Link href={`/admin/users/${w.userId}`} className="hover:text-gold-300">
                        {w.username}
                      </Link>
                    </Td>
                    <Td>{w.method}</Td>
                    <Td className="text-right">
                      <Chips amount={w.amount} suffix={false} />
                      {w.fee > 0 && <span className="block text-xs text-ink-400">fee {formatChips(w.fee)}</span>}
                    </Td>
                    <Td className="space-x-1">
                      <Badge tone={w.kyc === 'VERIFIED' ? 'positive' : 'warning'}>KYC {w.kyc.toLowerCase().replace('_', ' ')}</Badge>
                      {w.accountStatus !== 'ACTIVE' && <Badge tone="negative">{w.accountStatus.toLowerCase()}</Badge>}
                      {w.openFlags > 0 && (
                        <Link href={`/admin/kyc/${w.userId}`}>
                          <Badge tone="negative">{w.openFlags} risk flag(s)</Badge>
                        </Link>
                      )}
                    </Td>
                    <Td className="text-xs text-ink-300">{w.needsTwoApprovals ? `${w.firstApprovedBy ? 1 : 0} of 2` : '1 needed'}</Td>
                    {canReview && (
                      <Td className="text-right">
                        {w.userId === session.userId || w.firstApprovedBy === session.userId ? (
                          <span className="text-xs text-ink-400">{w.firstApprovedBy === session.userId ? 'You approved; needs another person' : 'Your own withdrawal'}</span>
                        ) : (
                          <WithdrawalReview id={w.id} needsTwo={w.needsTwoApprovals} firstApproved={Boolean(w.firstApprovedBy)} amountLabel={`${formatChips(w.amount)} ${unit}`} />
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Payouts in progress" subtitle="Approved and sent to the provider; they complete or fail when the provider's signed event arrives." />
        <CardBody>
          {processing.length === 0 ? (
            <EmptyState title="No payouts in progress" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Requested</Th>
                  <Th>Player</Th>
                  <Th className="text-right">Payout</Th>
                  <Th>Status</Th>
                  <Th>Reference</Th>
                  {canReview && summary.mode === 'sandbox' && <Th />}
                </tr>
              </thead>
              <tbody>
                {processing.map((w) => (
                  <Tr key={w.id}>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(w.requestedAt).toLocaleString()}</Td>
                    <Td>{w.username}</Td>
                    <Td className="text-right">
                      <Chips amount={w.payout} suffix={false} />
                    </Td>
                    <Td>
                      <Badge tone={WITHDRAWAL_STATUS[w.status]?.tone ?? 'info'}>{WITHDRAWAL_STATUS[w.status]?.label ?? w.status}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-ink-400">{w.reference ?? '—'}</Td>
                    {canReview && summary.mode === 'sandbox' && <Td className="text-right">{w.sandbox && w.status === 'PROCESSING' && <SandboxPayoutButtons id={w.id} />}</Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Deposits"
          actions={
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Link href="/admin/payments" className={!depositFilter ? 'text-gold-300' : 'text-ink-400 hover:text-ink-200'}>
                All
              </Link>
              {DEPOSIT_FILTERS.map((f) => (
                <Link key={f} href={`?deposits=${f}`} className={depositFilter === f ? 'text-gold-300' : 'text-ink-400 hover:text-ink-200'}>
                  {DEPOSIT_STATUS[f]?.label}
                </Link>
              ))}
            </div>
          }
        />
        <CardBody>
          {deposits.length === 0 ? (
            <EmptyState title="No deposits" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Player</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Reference</Th>
                  {canReview && <Th />}
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <Tr key={d.id}>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(d.createdAt).toLocaleString()}</Td>
                    <Td>{d.username}</Td>
                    <Td>{d.method}</Td>
                    <Td className="text-right">
                      <Chips amount={d.amount} suffix={false} />
                    </Td>
                    <Td>
                      <Badge tone={DEPOSIT_STATUS[d.status]?.tone ?? 'info'}>{DEPOSIT_STATUS[d.status]?.label ?? d.status}</Badge>
                      {d.failureReason && <span className="mt-0.5 block text-xs text-ink-400">{d.failureReason}</span>}
                    </Td>
                    <Td className="font-mono text-xs text-ink-400">{d.reference ?? '—'}</Td>
                    {canReview && <Td className="text-right">{d.status === 'UNDER_REVIEW' && d.userId !== session.userId && <FailDeposit id={d.id} />}</Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Provider event log"
          subtitle="Every webhook delivery, verified or not. Rejected deliveries never touch a deposit or withdrawal."
          actions={
            <Link href={sp.events === 'invalid' ? '/admin/payments' : '?events=invalid'} className="text-xs text-gold-400 hover:text-gold-300">
              {sp.events === 'invalid' ? 'Show all' : 'Only rejected'}
            </Link>
          }
        />
        <CardBody>
          {events.length === 0 ? (
            <EmptyState title="No events" />
          ) : (
            <Table data-testid="payment-events">
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Provider</Th>
                  <Th>Event</Th>
                  <Th>Signature</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(e.receivedAt).toLocaleString()}</Td>
                    <Td>{e.provider}</Td>
                    <Td className="text-xs">
                      {e.type ?? '—'}
                      <span className="block font-mono text-ink-400">{e.eventId ?? ''}</span>
                    </Td>
                    <Td>{e.signatureValid ? <Badge tone="positive">valid</Badge> : <Badge tone="negative">rejected</Badge>}</Td>
                    <Td className="text-xs text-ink-300">{e.result}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Cashier rules" subtitle={canConfigure ? 'Changes apply to new requests at once and are audited.' : 'Read-only: changing them needs payments:configure.'} />
        <CardBody>
          {canConfigure ? (
            <CashierSettingsForm settings={settings} />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ['Daily / 30-day deposit limit', `${formatChips(settings.dailyDepositLimit)} / ${formatChips(settings.monthlyDepositLimit)}`],
                  ['Daily / 30-day withdrawal limit', `${formatChips(settings.dailyWithdrawalLimit)} / ${formatChips(settings.monthlyWithdrawalLimit)}`],
                  ['Manual review from', formatChips(settings.reviewThreshold)],
                  ['Two approvers from', formatChips(settings.dualApprovalThreshold)],
                  ['Identity check before withdrawing', settings.kycRequiredForWithdrawal ? 'Yes' : 'No'],
                  ['Closed loop', settings.closedLoop ? 'Yes' : 'No'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-white/[0.06] pb-1.5">
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="num text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Payment methods" subtitle="Each method is backed by a provider adapter in code. Only the sandbox adapter exists." />
        <CardBody className="space-y-3">
          {methods.map((m) => (
            <details key={m.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink-100">{m.name}</span>
                <Badge tone={m.active ? 'positive' : 'neutral'}>{m.active ? 'active' : 'inactive'}</Badge>
                {m.sandbox && <Badge tone="info">sandbox</Badge>}
                <span className="text-xs text-ink-400">
                  deposits {formatChips(m.minDeposit)}–{formatChips(m.maxDeposit)} · withdrawals {formatChips(m.minWithdrawal)}–{formatChips(m.maxWithdrawal)} · provider {m.provider}
                </span>
              </summary>
              {canConfigure && (
                <div className="mt-4">
                  <MethodForm method={m} />
                </div>
              )}
            </details>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
