import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'gold' | 'positive' | 'negative' | 'warning' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'border-ink-600 bg-ink-800 text-ink-200',
  gold: 'border-gold-700 bg-gold-800/40 text-gold-300',
  positive: 'border-positive/40 bg-positive/10 text-positive',
  negative: 'border-negative/40 bg-negative/10 text-negative',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-info/40 bg-info/10 text-info',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === 'ACTIVE' || status === 'SETTLED' || status === 'OK'
      ? 'positive'
      : status === 'SUSPENDED' || status === 'OPEN' || status === 'WARNING' || status === 'RUNNING'
        ? 'warning'
        : status === 'DISABLED' || status === 'VOIDED' || status === 'DELETED'
          ? 'neutral'
          : status === 'CRITICAL' || status === 'MISMATCH' || status === 'ERROR'
            ? 'negative'
            : 'info';
  return <Badge tone={tone}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}
