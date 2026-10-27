import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Th } from '../ui/table';

/**
 * Server-rendered list controls driven by URL search parameters, so every
 * filter, sort and page is a plain link: shareable, back-button friendly and
 * working without client JavaScript. Queries behind them are bounded and
 * paginated on the server.
 */
export type Params = Record<string, string | undefined>;

export function hrefWith(basePath: string, params: Params, overrides: Params = {}): string {
  const merged = { ...params, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '') qs.set(k, v);
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/** Column header that sorts by `sortKey`; clicking the active column flips the direction. */
export function SortTh({
  label,
  sortKey,
  basePath,
  params,
  defaultDir = 'desc',
  className,
}: {
  label: string;
  sortKey: string;
  basePath: string;
  params: Params;
  defaultDir?: 'asc' | 'desc';
  className?: string;
}) {
  const active = params.sort === sortKey;
  const dir = active ? (params.dir === 'asc' ? 'asc' : 'desc') : undefined;
  const next = active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir;
  return (
    <Th className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={hrefWith(basePath, params, { sort: sortKey, dir: next, page: undefined })} className={cn('inline-flex items-center gap-1 hover:text-ink-200', active && 'text-gold-300')}>
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </Th>
  );
}

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Params }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const window = [page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages);
  const link = (p: number) => hrefWith(basePath, params, { page: p === 1 ? undefined : String(p) });
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-ink-400">
        {total === 0 ? 'No results' : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      {pages > 1 && (
        <ul className="flex items-center gap-1">
          <li>
            {page > 1 ? (
              <Link href={link(page - 1)} className="rounded-lg px-2.5 py-1.5 text-gold-400 hover:bg-ink-850">
                ← Previous
              </Link>
            ) : (
              <span className="px-2.5 py-1.5 text-ink-400 opacity-60">← Previous</span>
            )}
          </li>
          {window.map((p) => (
            <li key={p}>
              <Link
                href={link(p)}
                aria-current={p === page ? 'page' : undefined}
                className={cn('num rounded-lg px-2.5 py-1.5', p === page ? 'bg-ink-800 text-gold-200' : 'text-ink-300 hover:bg-ink-850')}
              >
                {p}
              </Link>
            </li>
          ))}
          <li>
            {page < pages ? (
              <Link href={link(page + 1)} className="rounded-lg px-2.5 py-1.5 text-gold-400 hover:bg-ink-850">
                Next →
              </Link>
            ) : (
              <span className="px-2.5 py-1.5 text-ink-400 opacity-60">Next →</span>
            )}
          </li>
        </ul>
      )}
    </nav>
  );
}

/** Cursor pagination for append-only logs (newest first). */
export function CursorPagination({ basePath, params, nextBefore, isFirstPage }: { basePath: string; params: Params; nextBefore: number | null; isFirstPage: boolean }) {
  return (
    <nav aria-label="Pagination" className="mt-4 flex justify-between text-sm">
      {!isFirstPage ? (
        <Link href={hrefWith(basePath, params, { before: undefined })} className="text-gold-400">
          ← Newest
        </Link>
      ) : (
        <span />
      )}
      {nextBefore !== null && (
        <Link href={hrefWith(basePath, params, { before: String(nextBefore) })} className="text-gold-400">
          Older →
        </Link>
      )}
    </nav>
  );
}

/** A GET form of filters with Apply and Reset. Hidden inputs keep the current sort. */
export function FilterBar({ action, keep = {}, children, resetHref }: { action: string; keep?: Params; children: ReactNode; resetHref: string }) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-3" role="search">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {children}
      <div className="flex gap-2">
        <button type="submit" className="h-11 rounded-xl border border-gold-700 bg-gold-800/30 px-4 text-sm font-medium text-gold-200 hover:border-gold-500">
          Apply
        </button>
        <Link href={resetHref} className="flex h-11 items-center rounded-xl border border-ink-700 px-4 text-sm text-ink-300 hover:border-ink-500">
          Reset
        </Link>
      </div>
    </form>
  );
}

/** A labelled filter control for FilterBar. */
export function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        {label}
      </label>
      {children}
    </div>
  );
}

export const filterInputClass = 'h-11 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 focus:border-gold-500 focus:outline-none';
