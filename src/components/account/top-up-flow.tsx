'use client';

import { useState } from 'react';
import { formatChips } from '@/engine/money';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';

type Step = 'choose' | 'review' | 'done';

/**
 * The cashier's free top-up: a three-step flow (choose → review → receipt)
 * for the daily allocation of virtual credits. There is no price, no payment
 * method and no financial information anywhere in it: the server decides
 * eligibility and the amount, and the credits have no monetary value.
 */
export function TopUpFlow({
  amount,
  claimedToday,
  nextAvailableAt,
  maxBalance,
  blockedReason,
}: {
  amount: number;
  claimedToday: boolean;
  nextAvailableAt: string;
  maxBalance: number;
  blockedReason: string | null;
}) {
  const { balance, setBalance } = useSession();
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ amount: number; balance: number; at: string } | null>(null);
  const [claimed, setClaimed] = useState(claimedToday);

  const unavailable = blockedReason
    ? blockedReason
    : claimed
      ? `Today's free top-up is used. The next one is available from ${new Date(nextAvailableAt).toUTCString().slice(0, 22)} UTC.`
      : amount <= 0
        ? 'Free top-ups are currently switched off.'
        : balance >= maxBalance
          ? `Free top-ups are available while your balance is below ${formatChips(maxBalance)} credits.`
          : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ amount: number; balance: number }>('/api/wallet/daily-bonus', { method: 'POST', body: {} });
      setBalance(res.balance);
      setReceipt({ ...res, at: new Date().toISOString() });
      setClaimed(true);
      setStep('done');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const steps: [Step, string][] = [
    ['choose', 'Choose'],
    ['review', 'Review'],
    ['done', 'Done'],
  ];

  return (
    <div className="space-y-5" data-testid="top-up">
      <ol className="flex items-center gap-2 text-xs" aria-label="Top-up steps">
        {steps.map(([s, label], i) => {
          const current = s === step;
          const doneStep = steps.findIndex(([x]) => x === step) > i;
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full border text-[11px] font-semibold',
                  current ? 'border-gold-400 bg-gold-400 text-ink-950' : doneStep ? 'border-positive/60 text-positive' : 'border-white/15 text-ink-400',
                )}
                aria-current={current ? 'step' : undefined}
              >
                {doneStep ? '✓' : i + 1}
              </span>
              <span className={current ? 'text-ink-100' : 'text-ink-400'}>{label}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-white/15" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {step === 'choose' && (
        <div className="space-y-4">
          <button
            type="button"
            disabled={Boolean(unavailable)}
            onClick={() => setStep('review')}
            className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-gold-400/40 bg-[radial-gradient(120%_120%_at_0%_0%,rgb(199_163_91/0.18),transparent_60%)] p-5 text-left transition-colors hover:border-gold-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-none disabled:opacity-70"
            data-testid="top-up-package"
          >
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Daily free credits</span>
              <span className="num mt-1 block text-3xl font-semibold text-ink-100">{formatChips(amount)}</span>
              <span className="mt-1 block text-xs text-ink-400">Once per day, while your balance is below {formatChips(maxBalance)}.</span>
            </span>
            <span className="rounded-full border border-positive/40 bg-positive/10 px-3 py-1 text-xs font-semibold text-positive">Free</span>
          </button>
          {unavailable && <p className="text-sm text-ink-300">{unavailable}</p>}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <dl className="divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.03] text-sm">
            {[
              ['Credits', `${formatChips(amount)}`],
              ['Price', 'Free — nothing to pay'],
              ['Payment details', 'None needed'],
              ['Balance after', `${formatChips(balance + amount)}`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3">
                <dt className="text-ink-400">{k}</dt>
                <dd className="num font-medium text-ink-100">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs leading-relaxed text-ink-400">Virtual credits have no monetary value: they cannot be bought, sold, withdrawn, transferred or exchanged for anything.</p>
          {error && (
            <p className="text-sm text-negative" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={confirm} loading={busy} data-testid="top-up-confirm">
              Add {formatChips(amount)} free credits
            </Button>
            <Button variant="ghost" onClick={() => setStep('choose')} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && receipt && (
        <div className="space-y-3 rounded-2xl border border-positive/30 bg-positive/[0.06] p-5" role="status" data-testid="top-up-receipt">
          <div className="text-lg font-semibold text-ink-100">{formatChips(receipt.amount)} free credits added</div>
          <div className="text-sm text-ink-300">
            New balance <span className="num font-semibold text-ink-100">{formatChips(receipt.balance)}</span> · {new Date(receipt.at).toLocaleString()}
          </div>
          <p className="text-xs text-ink-400">The top-up is in your transaction history as "Free credits".</p>
        </div>
      )}
    </div>
  );
}
