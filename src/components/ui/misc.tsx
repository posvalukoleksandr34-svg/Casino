import type { ReactNode } from 'react';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';
import type { Tone } from './badge';

/** Displays a minor-unit amount as chips. Negative amounts are signed; colour is optional. */
export function Chips({
  amount,
  sign = false,
  colored = false,
  className,
  suffix = true,
  compact = false,
}: {
  amount: number;
  sign?: boolean;
  colored?: boolean;
  className?: string;
  suffix?: boolean;
  /** Abbreviate amounts of a million chips or more (full value in the tooltip). */
  compact?: boolean;
}) {
  const tone = colored ? (amount > 0 ? 'text-positive' : amount < 0 ? 'text-negative' : 'text-ink-300') : undefined;
  const chips = Math.abs(amount) / 100;
  const short =
    compact && chips >= 1e6
      ? `${amount < 0 ? '-' : sign && amount > 0 ? '+' : ''}${chips >= 1e9 ? `${(chips / 1e9).toFixed(3)}B` : `${(chips / 1e6).toFixed(2)}M`}`
      : null;
  return (
    <span className={cn('num whitespace-nowrap', tone, className)} title={short ? formatChips(amount, { sign }) : undefined}>
      {short ?? formatChips(amount, { sign })}
      {suffix && <span className="ml-1 text-[0.72em] font-medium tracking-wider text-ink-400">CHIPS</span>}
    </span>
  );
}

export function Stat({ label, value, sub, className, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; tone?: 'positive' | 'negative' | 'gold' }) {
  return (
    <div className={cn('surface-raised px-4 py-3.5', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-400">{label}</div>
      <div
        className={cn(
          'mt-1.5 min-w-0 break-words text-xl font-semibold tracking-tight',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'gold' && 'text-gold-300',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

const CALLOUT: Record<Tone, string> = {
  neutral: 'border-ink-600 bg-ink-800/70 text-ink-200',
  gold: 'border-gold-700/70 bg-gold-800/20 text-gold-200',
  positive: 'border-positive/40 bg-positive/10 text-ink-100',
  negative: 'border-negative/40 bg-negative/10 text-ink-100',
  warning: 'border-warning/40 bg-warning/10 text-ink-100',
  info: 'border-info/40 bg-info/10 text-ink-100',
};

export function Callout({ tone = 'neutral', title, children, className, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cn('rounded-xl border px-4 py-3 text-sm', CALLOUT[tone], className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title ? 'mt-1' : undefined, 'text-ink-200')}>{children}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-rise">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-500">{eyebrow}</div>}
        <h1 className="font-display text-4xl font-semibold leading-tight text-ink-100 sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <div className="mb-3 size-10 rotate-45 rounded-md border border-gold-700/60 bg-gold-800/20" aria-hidden="true" />
      <div className="text-sm font-semibold text-ink-100">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-400">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">{children}</kbd>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('break-all rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[12px] text-ink-200', className)}>{children}</code>;
}

export function Pct({ value, digits = 2, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={className}>—</span>;
  return <span className={cn('num', className)}>{(value * 100).toFixed(digits)}%</span>;
}
