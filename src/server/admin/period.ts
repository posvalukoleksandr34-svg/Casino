/**
 * Reporting periods for the back office. All boundaries are UTC and every
 * range is half-open [from, to):
 *   today  from 00:00 UTC today to now
 *   7d     the last 7 × 24 hours up to now
 *   30d    the last 30 × 24 hours up to now
 *   custom from 00:00 UTC on the first date to 00:00 UTC after the last date
 *          (both dates inclusive, at most 366 days)
 */
import { errors } from '../errors';

export const PERIOD_KEYS = ['today', '7d', '30d', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface ResolvedPeriod {
  key: PeriodKey;
  from: Date;
  to: Date;
  label: string;
  /** Inclusive calendar dates (YYYY-MM-DD, UTC) for the custom form. */
  fromDate: string;
  toDate: string;
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string, field: string): Date {
  if (!DATE.test(s)) throw errors.validation(`${field} must be a date (YYYY-MM-DD)`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || utcDate(d) !== s) throw errors.validation(`${field} is not a valid date`);
  return d;
}

export function resolvePeriod(input: { period?: string; from?: string; to?: string }, now = new Date()): ResolvedPeriod {
  const key = (PERIOD_KEYS as readonly string[]).includes(input.period ?? '') ? (input.period as PeriodKey) : input.from || input.to ? 'custom' : '7d';
  if (key === 'custom') {
    const from = parseDate(input.from ?? '', 'Start date');
    const lastDay = parseDate(input.to ?? input.from ?? '', 'End date');
    if (lastDay < from) throw errors.validation('The end date must not be before the start date');
    const to = new Date(lastDay.getTime() + DAY);
    if (to.getTime() - from.getTime() > 366 * DAY) throw errors.validation('Custom ranges are limited to 366 days');
    if (from.getTime() > now.getTime()) throw errors.validation('The start date is in the future');
    return { key, from, to, label: `${utcDate(from)} – ${utcDate(lastDay)} (UTC)`, fromDate: utcDate(from), toDate: utcDate(lastDay) };
  }
  const from = key === 'today' ? new Date(Math.floor(now.getTime() / DAY) * DAY) : new Date(now.getTime() - (key === '7d' ? 7 : 30) * DAY);
  const label = key === 'today' ? 'Today (since 00:00 UTC)' : key === '7d' ? 'Last 7 days' : 'Last 30 days';
  return { key, from, to: now, label, fromDate: utcDate(from), toDate: utcDate(now) };
}

/** Optional registration-date filter (inclusive dates, UTC); undefined bounds are open. */
export function dateRange(input: { from?: string; to?: string }): { from?: Date; to?: Date } {
  const from = input.from ? parseDate(input.from, 'From') : undefined;
  const to = input.to ? new Date(parseDate(input.to, 'To').getTime() + DAY) : undefined;
  if (from && to && to <= from) throw errors.validation('The end date must not be before the start date');
  return { from, to };
}
