'use client';

import { useEffect, useId, useState } from 'react';
import { formatChips, MINOR_PER_CHIP, parseChips } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';

const PRESETS = [1, 5, 10, 50, 100, 500].map((c) => c * MINOR_PER_CHIP);

/**
 * Stake entry in chips (stored as minor units). Validates against the table
 * limits and the player's balance and reports problems inline.
 */
export function StakeInput({
  value,
  onChange,
  min,
  max,
  balance,
  disabled,
  label = 'Stake',
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  balance: number;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const [text, setText] = useState(formatChips(value).replace(/,/g, ''));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatChips(value).replace(/,/g, ''));
  }, [value, focused]);

  // Signed-out visitors have no balance yet: the screen asks them to sign in
  // instead of reporting a misleading "exceeds your balance" error.
  const { user } = useSession();
  const knownBalance = user ? balance : Number.POSITIVE_INFINITY;
  const problem =
    value < min
      ? `Minimum stake is ${formatChips(min)}`
      : value > max
        ? `Maximum stake is ${formatChips(max)}`
        : value > knownBalance
          ? 'Stake exceeds your balance'
          : null;

  const clamp = (v: number) => Math.max(min, Math.min(v, max, Math.max(knownBalance, min)));

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        {label}
      </label>
      <div className={cn('flex items-center rounded-xl border bg-ink-900 pr-1.5 transition-colors', problem ? 'border-negative/60' : 'border-ink-600 focus-within:border-gold-500')}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={text}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-err` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(formatChips(value).replace(/,/g, ''));
          }}
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(parseChips(e.target.value || '0'));
            } catch {
              /* keep last valid value until the text parses */
            }
          }}
          className="num h-11 min-w-0 flex-1 bg-transparent px-3.5 text-base font-semibold text-ink-100 outline-none disabled:opacity-60"
        />
        <span className="mr-2 text-[10px] font-semibold tracking-wider text-ink-400">CHIPS</span>
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(Math.floor(value / 2)))} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-ink-300 hover:bg-ink-800 hover:text-ink-100" aria-label="Halve stake">
          ½
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(value * 2))} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-ink-300 hover:bg-ink-800 hover:text-ink-100" aria-label="Double stake">
          2×
        </button>
      </div>
      {problem && (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-negative" role="alert">
          {problem}
        </p>
      )}
      <div className="mt-2.5 grid grid-cols-6 gap-1.5" role="group" aria-label="Stake presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled || p < min || p > max}
            onClick={() => onChange(p)}
            className={cn(
              'num h-8 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40',
              value === p ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-500 hover:text-ink-100',
            )}
          >
            {p / MINOR_PER_CHIP}
          </button>
        ))}
      </div>
    </div>
  );
}

export function stakeProblem(value: number, min: number, max: number, balance: number): string | null {
  if (!Number.isSafeInteger(value) || value <= 0) return 'Enter a stake';
  if (value < min) return 'Below table minimum';
  if (value > max) return 'Above table maximum';
  if (value > balance) return 'Insufficient balance';
  return null;
}
