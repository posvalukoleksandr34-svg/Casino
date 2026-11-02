'use client';

import { useMemo, useRef, useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { feeFor, KIND_LABELS, type DepositBonusView, type DepositOptionsView } from './types';

type Step = 'method' | 'amount' | 'review';

function parse(input: string): number | null {
  try {
    const v = parseChips(input);
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Plain-language terms of a deposit bonus: nothing about it is hidden. */
export function bonusTerms(b: DepositBonusView, unit: string): string[] {
  const value = b.matchPercent > 0 ? `${b.matchPercent}% of your deposit, up to ${formatChips(b.maxBonus)} ${unit}` : `${formatChips(b.fixedAmount)} ${unit}`;
  return [
    `Bonus: ${value}${b.minDeposit > 0 ? `, for a deposit of at least ${formatChips(b.minDeposit)}` : ''}.`,
    b.wageringMultiplier > 0
      ? `Locked until you have wagered ${b.wageringMultiplier}× the bonus within ${b.expiresAfterDays} days; then it moves to your balance.`
      : 'Added to your balance straight away (no wagering).',
    b.maxBet ? `While it is locked, stakes above ${formatChips(b.maxBet)} do not count towards the wagering.` : 'Every stake counts towards the wagering.',
    'Your deposit itself is never locked: you can withdraw it at any time, subject only to the cashier rules shown below.',
    'If the time runs out or you forfeit it, only the bonus is removed.',
  ];
}

/**
 * Deposit: choose a method → amount and optional bonus → review → the
 * provider's checkout. Nothing here credits the wallet: the server credits it
 * when the provider's signed settlement arrives. Fees and amounts shown are
 * estimates the server recomputes.
 */
export function DepositFlow({ options }: { options: DepositOptionsView }) {
  const unit = options.currency.label;
  const [step, setStep] = useState<Step>('method');
  const [methodId, setMethodId] = useState(options.methods[0]?.id ?? '');
  const [raw, setRaw] = useState('');
  const [bonusId, setBonusId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const method = options.methods.find((m) => m.id === methodId);
  const amount = parse(raw);
  const bonus = options.bonuses.find((b) => b.id === bonusId) ?? null;
  const maxAllowed = method ? Math.min(method.max, options.allowance.remaining) : 0;
  const amountError = useMemo(() => {
    if (!raw) return null;
    if (amount === null) return 'Enter an amount, e.g. 50 or 50.00';
    if (!method) return null;
    if (amount < method.min) return `The minimum with ${method.name} is ${formatChips(method.min)}.`;
    if (amount > method.max) return `The maximum with ${method.name} is ${formatChips(method.max)}.`;
    if (amount > options.allowance.remaining) return `Your deposit limit allows ${formatChips(options.allowance.remaining)} more right now.`;
    if (bonus && amount < bonus.minDeposit) return `${bonus.name} needs a deposit of at least ${formatChips(bonus.minDeposit)}.`;
    return null;
  }, [raw, amount, method, bonus, options.allowance.remaining]);

  if (options.mode === 'disabled' || options.blocker) {
    return (
      <Callout tone={options.mode === 'disabled' ? 'neutral' : 'warning'} title="Deposits are not available" role="status">
        {options.blocker ?? 'Payments are not available on this site.'}
      </Callout>
    );
  }

  const fee = method && amount ? feeFor(amount, method.feeFixed, method.feeBp) : 0;
  const bonusValue = bonus && amount ? (bonus.matchPercent > 0 ? Math.min(bonus.maxBonus, Math.floor((amount * bonus.matchPercent) / 100)) : bonus.fixedAmount) : 0;
  const presets = method ? [2_000, 5_000, 10_000, 25_000, 50_000].filter((v) => v >= method.min && v <= maxAllowed) : [];

  async function start() {
    if (!method || !amount) return;
    setBusy(true);
    setError(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      const res = await api<{ redirectUrl: string | null; deposit: { id: string } }>('/api/cashier/deposits', {
        method: 'POST',
        body: { methodId: method.id, amount, bonusCampaignId: bonus?.id ?? null },
        idempotencyKey: keyRef.current,
      });
      window.location.assign(res.redirectUrl ?? `/wallet/deposits/${res.deposit.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="deposit-flow">
      <Steps step={step} />

      {step === 'method' && (
        <fieldset className="space-y-2.5">
          <legend className="mb-2 text-sm text-ink-300">Choose how to pay</legend>
          {options.methods.map((m) => (
            <label
              key={m.id}
              className={cn(
                'flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition-colors',
                methodId === m.id ? 'border-gold-400/70 bg-gold-400/[0.06]' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
              )}
            >
              <span className="flex items-start gap-3">
                <input type="radio" name="deposit-method" value={m.id} checked={methodId === m.id} onChange={() => setMethodId(m.id)} className="mt-1 accent-gold-400" />
                <span>
                  <span className="block font-medium text-ink-100">{m.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-400">
                    {KIND_LABELS[m.kind]} · {formatChips(m.min)}–{formatChips(m.max)} {unit} · {m.processingTime}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-400">Fee: {m.feeFixed === 0 && m.feeBp === 0 ? 'none' : [m.feeFixed ? `${formatChips(m.feeFixed)}` : null, m.feeBp ? `${(m.feeBp / 100).toFixed(2)}%` : null].filter(Boolean).join(' + ')}</span>
                </span>
              </span>
              {m.sandbox && <Badge tone="info">Test</Badge>}
            </label>
          ))}
          <div className="pt-2">
            <Button variant="primary" onClick={() => setStep('amount')} disabled={!method} data-testid="deposit-next">
              Continue
            </Button>
          </div>
        </fieldset>
      )}

      {step === 'amount' && method && (
        <div className="space-y-5">
          <Field
            label={`Amount (${unit})`}
            hint={`${formatChips(method.min)}–${formatChips(maxAllowed)} with ${method.name}. Your limits allow ${formatChips(options.allowance.remaining)} more now.`}
            error={amountError}
          >
            {(p) => <Input {...p} inputMode="decimal" autoComplete="off" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} data-testid="deposit-amount" />}
          </Field>
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((v) => (
                <button key={v} type="button" onClick={() => setRaw(formatChips(v).replace(/,/g, ''))} className="rounded-full border border-white/12 px-3 py-1 text-sm text-ink-200 hover:border-gold-400/60">
                  {formatChips(v)}
                </button>
              ))}
            </div>
          )}

          {options.bonuses.length > 0 && (
            <fieldset className="space-y-2.5" data-testid="deposit-bonuses">
              <legend className="mb-1 text-sm text-ink-300">Bonus (optional — you choose)</legend>
              <label className={cn('flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5', bonusId === null ? 'border-gold-400/70 bg-gold-400/[0.06]' : 'border-white/10')}>
                <input type="radio" name="deposit-bonus" checked={bonusId === null} onChange={() => setBonusId(null)} className="accent-gold-400" />
                <span className="text-sm text-ink-100">No bonus</span>
              </label>
              {options.bonuses.map((b) => (
                <label
                  key={b.id}
                  className={cn(
                    'block rounded-2xl border p-3.5',
                    !b.available ? 'cursor-not-allowed border-white/[0.06] opacity-70' : bonusId === b.id ? 'cursor-pointer border-gold-400/70 bg-gold-400/[0.06]' : 'cursor-pointer border-white/10',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="deposit-bonus" disabled={!b.available} checked={bonusId === b.id} onChange={() => setBonusId(b.id)} className="accent-gold-400" />
                    <span className="text-sm font-medium text-ink-100">{b.name}</span>
                  </span>
                  <ul className="ml-7 mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-ink-300">
                    {bonusTerms(b, unit).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  {b.reason && <span className="ml-7 mt-1.5 block text-xs text-warning">{b.reason}</span>}
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setStep('review')} disabled={!amount || Boolean(amountError)} data-testid="deposit-review">
              Review
            </Button>
            <Button variant="ghost" onClick={() => setStep('method')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && method && amount && (
        <div className="space-y-4">
          <dl className="divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.03] text-sm" data-testid="deposit-summary">
            {[
              ['Method', method.name],
              ['Deposit', `${formatChips(amount)} ${unit}`],
              ['Fee', fee ? `${formatChips(fee)} ${unit}` : 'None'],
              ['Added to your balance', `${formatChips(amount - fee)} ${unit}`],
              ['Bonus', bonus ? `${bonus.name}: ${formatChips(bonusValue)} ${unit}, locked until wagered ${bonus.wageringMultiplier}×` : 'None'],
              ['Processing', method.processingTime],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-ink-400">{k}</dt>
                <dd className="num text-right font-medium text-ink-100">{v}</dd>
              </div>
            ))}
          </dl>
          {method.sandbox && (
            <p className="text-xs leading-relaxed text-ink-400">
              This is a test payment method: you will see a simulated checkout, no real money is charged, and no card details are asked for. Your balance changes only when the
              simulated provider confirms the payment to our server.
            </p>
          )}
          {error && <Callout tone="negative" role="alert">{error}</Callout>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={start} loading={busy} data-testid="deposit-confirm">
              Continue to checkout
            </Button>
            <Button variant="ghost" onClick={() => setStep('amount')} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ['method', 'Method'],
    ['amount', 'Amount'],
    ['review', 'Review'],
  ];
  const at = steps.findIndex(([s]) => s === step);
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Deposit steps">
      {steps.map(([s, label], i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn('grid size-6 place-items-center rounded-full border text-[11px] font-semibold', i === at ? 'border-gold-400 bg-gold-400 text-ink-950' : i < at ? 'border-positive/60 text-positive' : 'border-white/15 text-ink-400')}
            aria-current={i === at ? 'step' : undefined}
          >
            {i < at ? '✓' : i + 1}
          </span>
          <span className={i === at ? 'text-ink-100' : 'text-ink-400'}>{label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-white/15" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
