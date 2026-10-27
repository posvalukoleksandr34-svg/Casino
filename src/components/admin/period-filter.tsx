import Link from 'next/link';
import { cn } from '@/lib/cn';
import { filterInputClass, hrefWith, type Params } from './list-controls';

/** The resolved period's display fields (see server/admin/period.ts). */
export interface PeriodView {
  key: string;
  label: string;
  fromDate: string;
  toDate: string;
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
] as const;

/** Today / 7 days / 30 days presets and a custom UTC date range (GET form). */
export function PeriodFilter({ basePath, params, period }: { basePath: string; params: Params; period: PeriodView }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="flex rounded-xl border border-ink-700 p-1" role="group" aria-label="Reporting period">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={hrefWith(basePath, params, { period: p.key, from: undefined, to: undefined })}
            aria-current={period.key === p.key ? 'true' : undefined}
            className={cn('rounded-lg px-3 py-1.5 text-sm', period.key === p.key ? 'bg-ink-800 text-gold-200' : 'text-ink-300 hover:text-ink-100')}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="period" value="custom" />
        <div className="flex flex-col gap-1">
          <label htmlFor="period-from" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            From (UTC)
          </label>
          <input id="period-from" name="from" type="date" defaultValue={period.fromDate} className={cn(filterInputClass, 'h-10')} required />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="period-to" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            To (UTC)
          </label>
          <input id="period-to" name="to" type="date" defaultValue={period.toDate} className={cn(filterInputClass, 'h-10')} required />
        </div>
        <button type="submit" className={cn('h-10 rounded-xl border px-3 text-sm', period.key === 'custom' ? 'border-gold-600 text-gold-200' : 'border-ink-600 text-ink-200 hover:border-gold-600')}>
          Apply range
        </button>
      </form>
      <span className="text-xs text-ink-400">{period.label}</span>
    </div>
  );
}
