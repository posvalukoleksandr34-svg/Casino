'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { feeFor, KIND_LABELS, WITHDRAWAL_STATUS, type WithdrawalOptionsView, type WithdrawalView } from './types';

function parse(input: string): number | null {
  try {
    const v = parseChips(input);
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Where a player can fix a blocker, when there is somewhere to go. */
function blockerLink(b: string): { href: string; label: string } | null {
  if (b.includes('Verify your identity')) return { href: '/account/verification', label: 'Verify identity' };
  if (b.includes('completed a deposit')) return { href: '#deposit', label: 'Make a deposit' };
  if (b.includes('suspended')) return { href: '/support', label: 'Contact support' };
  return null;
}

/**
 * Withdrawal request. Every condition is shown up front (identity check,
 * method rules, limits, fees, review), the amount leaves the spendable
 * balance as soon as the request is accepted, and a rejected or cancelled
 * request returns it in full. No deposit is ever needed to withdraw money the
 * player already has (except, for anti-money-laundering, to establish the
 * method the money goes back to, which is explained when it applies).
 */
export function WithdrawFlow({ options }: { options: WithdrawalOptionsView }) {
  const router = useRouter();
  const { setBalance } = useSession();
  const unit = options.currency.label;
  const firstAvailable = options.methods.find((m) => m.available)?.id ?? '';
  const [methodId, setMethodId] = useState(firstAvailable);
  const [raw, setRaw] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<WithdrawalView | null>(null);
  const keyRef = useRef<string | null>(null);

  const method = options.methods.find((m) => m.id === methodId);
  const amount = parse(raw);
  const max = method ? Math.min(options.withdrawable, method.max) : 0;
  const amountError = useMemo(() => {
    if (!raw) return null;
    if (amount === null) return 'Enter an amount, e.g. 50 or 50.00';
    if (!method) return null;
    if (amount < method.min) return `The minimum with ${method.name} is ${formatChips(method.min)}.`;
    if (amount > method.max) return `The maximum per request with ${method.name} is ${formatChips(method.max)}.`;
    if (amount > options.balance) return `Your balance is ${formatChips(options.balance)}.`;
    if (amount > options.limits.remaining) return `The withdrawal limit allows ${formatChips(options.limits.remaining)} more right now.`;
    return null;
  }, [raw, amount, method, options.balance, options.limits.remaining]);

  if (done) {
    const s = WITHDRAWAL_STATUS[done.status];
    return (
      <div className="space-y-3 rounded-2xl border border-positive/30 bg-positive/[0.06] p-5" role="status" data-testid="withdraw-receipt">
        <div className="text-lg font-semibold text-ink-100">
          Withdrawal of {formatChips(done.amount)} {unit} requested
        </div>
        <div className="text-sm text-ink-300">
          Status: <span className="font-medium text-ink-100">{s?.label ?? done.status}</span>. You will receive {formatChips(done.payout)} {unit}
          {done.fee ? ` after a ${formatChips(done.fee)} fee` : ''}.
        </div>
        <p className="text-xs text-ink-400">
          {done.status === 'UNDER_REVIEW'
            ? 'Our finance team reviews it before it is paid. You can cancel it until then; the amount then returns to your balance.'
            : 'The payout has been sent to the provider.'}{' '}
          Track it under <Link href="/wallet/withdrawals" className="text-gold-300 hover:text-gold-200">Withdrawals</Link>.
        </p>
      </div>
    );
  }

  if (options.mode === 'disabled') {
    return <Callout tone="neutral" title="Withdrawals are not available">Payments are not available on this site.</Callout>;
  }

  const fee = method && amount ? feeFor(amount, method.feeFixed, method.feeBp) : 0;
  const review = amount !== null && (options.reviewThreshold === 0 || amount >= options.reviewThreshold);

  async function submit() {
    if (!method || !amount) return;
    setBusy(true);
    setError(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      const res = await api<{ withdrawal: WithdrawalView }>('/api/cashier/withdrawals', { method: 'POST', body: { methodId: method.id, amount }, idempotencyKey: keyRef.current });
      const wallet = await api<{ balance: number }>('/api/wallet');
      setBalance(wallet.balance);
      setDone(res.withdrawal);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      keyRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="withdraw-flow">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <dt className="text-xs text-ink-400">Withdrawable now</dt>
          <dd className="num mt-0.5 font-semibold text-ink-100" data-testid="withdrawable">
            {formatChips(options.withdrawable)}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <dt className="text-xs text-ink-400">Pending withdrawals</dt>
          <dd className="num mt-0.5 font-semibold text-ink-100">{formatChips(options.pending)}</dd>
        </div>
        <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:col-span-1">
          <dt className="text-xs text-ink-400">Locked bonus (not withdrawable)</dt>
          <dd className="num mt-0.5 font-semibold text-ink-100">{formatChips(options.lockedBonus)}</dd>
        </div>
      </dl>

      {options.blockers.length > 0 && (
        <Callout tone="warning" title="Before you can withdraw" role="status">
          <ul className="mt-1 space-y-1.5" data-testid="withdraw-blockers">
            {options.blockers.map((b) => {
              const link = blockerLink(b);
              return (
                <li key={b} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{b}</span>
                  {link && (
                    <Link href={link.href} className="text-sm font-medium text-gold-300 hover:text-gold-200">
                      {link.label} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {options.blockers.length === 0 && (
        <>
          <fieldset className="space-y-2.5">
            <legend className="mb-2 text-sm text-ink-300">Pay out to</legend>
            {options.methods.map((m) => (
              <label
                key={m.id}
                className={cn(
                  'flex items-start justify-between gap-4 rounded-2xl border p-4',
                  !m.available ? 'cursor-not-allowed border-white/[0.06] opacity-70' : methodId === m.id ? 'cursor-pointer border-gold-400/70 bg-gold-400/[0.06]' : 'cursor-pointer border-white/10 hover:border-white/20',
                )}
              >
                <span className="flex items-start gap-3">
                  <input type="radio" name="withdraw-method" disabled={!m.available} checked={methodId === m.id} onChange={() => setMethodId(m.id)} className="mt-1 accent-gold-400" />
                  <span>
                    <span className="block font-medium text-ink-100">{m.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {KIND_LABELS[m.kind]} · {formatChips(m.min)}–{formatChips(m.max)} per request · {m.processingTime} · fee{' '}
                      {m.feeFixed === 0 && m.feeBp === 0 ? 'none' : [m.feeFixed ? formatChips(m.feeFixed) : null, m.feeBp ? `${(m.feeBp / 100).toFixed(2)}%` : null].filter(Boolean).join(' + ')}
                    </span>
                    {m.reason && <span className="mt-1 block text-xs text-warning">{m.reason}</span>}
                  </span>
                </span>
                {m.sandbox && <Badge tone="info">Test</Badge>}
              </label>
            ))}
          </fieldset>

          {method && (
            <Field label={`Amount (${unit})`} hint={`Between ${formatChips(method.min)} and ${formatChips(max)}.`} error={amountError}>
              {(p) => (
                <div className="flex gap-2">
                  <Input {...p} inputMode="decimal" autoComplete="off" placeholder="0.00" value={raw} onChange={(e) => { setRaw(e.target.value); setConfirming(false); }} data-testid="withdraw-amount" />
                  <Button variant="secondary" onClick={() => setRaw(formatChips(max).replace(/,/g, ''))} disabled={max < method.min}>
                    Max
                  </Button>
                </div>
              )}
            </Field>
          )}

          {method && amount && !amountError && (
            <dl className="divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.03] text-sm" data-testid="withdraw-summary">
              {[
                ['Taken from your balance now', `${formatChips(amount)} ${unit}`],
                ['Fee', fee ? `${formatChips(fee)} ${unit}` : 'None'],
                ['You receive', `${formatChips(amount - fee)} ${unit}`],
                ['Review', review ? 'Checked by our finance team before payout' : 'Paid out without manual review'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="num text-right font-medium text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs leading-relaxed text-ink-400">
            Withdrawing does not cancel a bonus in progress; locked bonus credits stay locked until their wagering is met. You can cancel a withdrawal until it is paid out, and a
            rejected or failed withdrawal returns the full amount to your balance.
            {method?.sandbox ? ' Test methods simulate the payout: no real money is paid.' : ''}
          </p>
          {error && <Callout tone="negative" role="alert">{error}</Callout>}
          {!confirming ? (
            <Button variant="primary" onClick={() => setConfirming(true)} disabled={!method || !amount || Boolean(amountError)} data-testid="withdraw-continue">
              Continue
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={submit} loading={busy} data-testid="withdraw-confirm">
                Confirm withdrawal of {amount ? formatChips(amount) : ''}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Change
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
