'use client';

import { useState } from 'react';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';

export interface DailyPoint {
  day: string;
  rounds: number;
  wagered: number;
  paidOut: number;
  net: number;
}

const W = 720;
const H = 220;
const PAD = { l: 52, r: 12, t: 14, b: 26 };
const POS = '#63b98f';
const NEG = '#e06a62';

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Round a positive number up to a "nice" axis bound (1, 2, 5 × 10^k). */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/**
 * Daily net result (payouts − stakes) as diverging bars around zero: one
 * measure, one axis. Hover or keyboard focus shows the day's details; a table
 * view carries the same data for assistive technology.
 */
export function DailyNetChart({ data }: { data: DailyPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => Math.abs(d.net)), 1));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const zeroY = PAD.t + innerH / 2;
  const slot = innerW / data.length;
  const barW = Math.max(3, slot - 2); // 2px surface gap between bars
  const y = (v: number) => zeroY - (v / max) * (innerH / 2);
  const ticks = [max, max / 2, 0, -max / 2, -max];
  const a = active !== null ? data[active] : null;
  const played = data.filter((d) => d.rounds > 0).length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Daily net result over the last ${data.length} days; ${played} day${played === 1 ? '' : 's'} with play`} onMouseLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#ffffff" strokeOpacity={t === 0 ? 0.28 : 0.06} strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="8.5" fill="#858a95" className="num">
                {t === 0 ? '0' : `${t > 0 ? '+' : '−'}${formatChips(Math.abs(t)).replace(/\.00$/, '')}`}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.l + i * slot + (slot - barW) / 2;
            const h = Math.abs(y(d.net) - zeroY);
            const up = d.net >= 0;
            return (
              <g key={d.day}>
                {/* Hit target: the whole column, bigger than the mark. */}
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setActive(i)} />
                {d.rounds > 0 && h > 0 && (
                  <path
                    d={
                      up
                        ? `M${x} ${zeroY} V${zeroY - h + Math.min(4, h)} Q${x} ${zeroY - h} ${x + Math.min(4, barW / 2)} ${zeroY - h} H${x + barW - Math.min(4, barW / 2)} Q${x + barW} ${zeroY - h} ${x + barW} ${zeroY - h + Math.min(4, h)} V${zeroY} Z`
                        : `M${x} ${zeroY} V${zeroY + h - Math.min(4, h)} Q${x} ${zeroY + h} ${x + Math.min(4, barW / 2)} ${zeroY + h} H${x + barW - Math.min(4, barW / 2)} Q${x + barW} ${zeroY + h} ${x + barW} ${zeroY + h - Math.min(4, h)} V${zeroY} Z`
                    }
                    fill={up ? POS : NEG}
                    opacity={active === null || active === i ? 1 : 0.45}
                    pointerEvents="none"
                  />
                )}
                {d.rounds > 0 && h === 0 && <rect x={x} y={zeroY - 1} width={barW} height="2" fill="#a0a4ae" pointerEvents="none" />}
                {(i === 0 || i === data.length - 1 || (i % 7 === 0 && data.length - 1 - i >= 4)) && (
                  <text x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#858a95">
                    {dayLabel(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {a && active !== null && (
          <div
            className="glass pointer-events-none absolute top-1 z-10 w-48 rounded-xl px-3 py-2 text-xs"
            style={{ left: `clamp(0px, calc(${((PAD.l + active * slot + slot / 2) / W) * 100}% - 6rem), calc(100% - 12rem))` }}
            role="status"
          >
            <div className="font-semibold text-ink-100">{dayLabel(a.day)}</div>
            {a.rounds === 0 ? (
              <div className="text-ink-400">No rounds</div>
            ) : (
              <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                <dt className="text-ink-400">Rounds</dt>
                <dd className="num text-right text-ink-100">{a.rounds}</dd>
                <dt className="text-ink-400">Staked</dt>
                <dd className="num text-right text-ink-100">{formatChips(a.wagered)}</dd>
                <dt className="text-ink-400">Returned</dt>
                <dd className="num text-right text-ink-100">{formatChips(a.paidOut)}</dd>
                <dt className="text-ink-400">Net</dt>
                <dd className={cn('num text-right font-semibold', a.net > 0 ? 'text-positive' : a.net < 0 ? 'text-negative' : 'text-ink-100')}>{formatChips(a.net, { sign: true })}</dd>
              </dl>
            )}
          </div>
        )}
      </div>
      {/* Keyboard access: one focusable control per day with play. */}
      <div className="flex flex-wrap gap-1" aria-label="Days with play">
        {data.map((d, i) =>
          d.rounds > 0 ? (
            <button
              key={d.day}
              type="button"
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className="num rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-ink-300 hover:text-ink-100"
              aria-label={`${dayLabel(d.day)}: ${d.rounds} rounds, net ${formatChips(d.net, { sign: true })} chips`}
            >
              {dayLabel(d.day)}
            </button>
          ) : null,
        )}
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: POS }} aria-hidden="true" /> Net gain that day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: NEG }} aria-hidden="true" /> Net loss that day
        </span>
      </p>
      <table className="sr-only">
        <caption>Daily results</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Rounds</th>
            <th>Staked</th>
            <th>Returned</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {data
            .filter((d) => d.rounds > 0)
            .map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.rounds}</td>
                <td>{formatChips(d.wagered)}</td>
                <td>{formatChips(d.paidOut)}</td>
                <td>{formatChips(d.net, { sign: true })}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
