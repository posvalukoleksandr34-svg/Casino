'use client';

/**
 * Admin charts (inline SVG, no chart library). Palette validated with the
 * dataviz validator against the dark card surface #141519:
 *   series-1 #c98500 (actual), series-2 #3987e5 (theoretical), series-3 #199e70.
 * Marks: ≤24px columns with 4px rounded data-ends, 2px lines, ≥8px dots with a
 * 2px surface ring, solid hairline grid. Text uses ink tokens, never series colours.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const SERIES = { actual: '#c98500', theory: '#3987e5', third: '#199e70' } as const;
const SURFACE = '#141519';
const GRID = '#282a31';
const AXIS_TEXT = '#a0a4ae';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  // Narrow until measured, so the server-rendered chart never widens a phone layout.
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, Math.floor(entries[0]!.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function compactChips(minor: number): string {
  const v = minor / 100;
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : a.toFixed(a >= 100 ? 0 : 2);
  return `${v < 0 ? '−' : ''}${s.replace(/\.0(?=[KMB]|$)/, '')}`;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 0.5; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

function Legend({ items }: { items: { label: string; kind: 'rect' | 'line' | 'dot' | 'band'; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-300">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'rect' && <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: i.color }} />}
          {i.kind === 'line' && <span className="inline-block h-0.5 w-4 rounded" style={{ background: i.color }} />}
          {i.kind === 'dot' && <span className="inline-block size-2.5 rounded-full" style={{ background: i.color }} />}
          {i.kind === 'band' && <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: i.color, opacity: 0.28 }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), width - 200);
  return (
    <div className="pointer-events-none absolute z-10 w-48 rounded-lg border border-ink-600 bg-ink-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur" style={{ left, top: Math.max(0, y - 10) }} role="status">
      {children}
    </div>
  );
}

export interface DailyPoint {
  day: string;
  actual: number;
  theory: number;
  rounds: number;
}

/** Daily realised house net chips (columns) against the expected net (line), one shared axis in chips. Virtual chips, not revenue. */
export function DailyGgrChart({ points }: { points: DailyPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const height = 240;
  const m = { top: 16, right: 16, bottom: 28, left: 56 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const values = points.flatMap((p) => [p.actual, p.theory, 0]);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const y = (v: number) => m.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const band = iw / Math.max(points.length, 1);
  const bw = Math.min(24, Math.max(3, band - 2));
  const cx = (i: number) => m.left + band * i + band / 2;
  const y0 = y(0);
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(p.theory).toFixed(1)}`).join('');
  const last = points[points.length - 1];

  if (points.length === 0) return <p className="text-sm text-ink-400">No settled rounds in this period.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend
          items={[
            { label: 'House net (actual)', kind: 'rect', color: SERIES.actual },
            { label: 'Expected net', kind: 'line', color: SERIES.theory },
          ]}
        />
        <button type="button" className="text-xs text-gold-400 hover:text-gold-300" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      </div>
      <div ref={ref} className="relative overflow-hidden" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label="Daily house net chips, actual versus expected">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#4b4f5a' : GRID} strokeWidth="1" />
              <text x={m.left - 8} y={y(t)} fill={AXIS_TEXT} fontSize="11" textAnchor="end" dominantBaseline="central" className="num">
                {compactChips(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const top = Math.min(y(p.actual), y0);
            const h = Math.max(1, Math.abs(y(p.actual) - y0));
            const r = Math.min(4, h / 2, bw / 2);
            const x0 = cx(i) - bw / 2;
            const up = p.actual >= 0;
            // Rounded data-end, square at the baseline.
            const d = up
              ? `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${top + h} Z`
              : `M${x0},${top} V${top + h - r} Q${x0},${top + h} ${x0 + r},${top + h} H${x0 + bw - r} Q${x0 + bw},${top + h} ${x0 + bw},${top + h - r} V${top} Z`;
            return <path key={p.day} d={d} fill={SERIES.actual} opacity={hover === null || hover === i ? 1 : 0.55} />;
          })}
          <path d={linePath} fill="none" stroke={SERIES.theory} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {last && <circle cx={cx(points.length - 1)} cy={y(last.theory)} r="4" fill={SERIES.theory} stroke={SURFACE} strokeWidth="2" />}
          {points.map((p, i) => (i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
            <text key={p.day} x={cx(i)} y={height - 8} fill={AXIS_TEXT} fontSize="11" textAnchor="middle">
              {p.day.slice(5)}
            </text>
          ) : null))}
          {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={m.top} y2={m.top + ih} stroke="#737884" strokeWidth="1" />}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.day}`}
              x={m.left + band * i}
              y={m.top}
              width={band}
              height={ih}
              fill="transparent"
              tabIndex={0}
              aria-label={`${p.day}: actual ${compactChips(p.actual)}, theoretical ${compactChips(p.theory)}`}
              onPointerMove={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && points[hover] && (
          <Tooltip x={cx(hover)} y={m.top} width={width}>
            <div className="mb-1 text-ink-400">{points[hover]!.day}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-ink-300">
                <span className="inline-block h-0.5 w-3" style={{ background: SERIES.actual }} />
                Actual
              </span>
              <span className="num font-semibold text-ink-100">{compactChips(points[hover]!.actual)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-ink-300">
                <span className="inline-block h-0.5 w-3" style={{ background: SERIES.theory }} />
                Theoretical
              </span>
              <span className="num font-semibold text-ink-100">{compactChips(points[hover]!.theory)}</span>
            </div>
            <div className="mt-1 text-ink-400">{points[hover]!.rounds.toLocaleString()} rounds</div>
          </Tooltip>
        )}
      </div>
      {showTable && (
        <div className="mt-4 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1.5">Day</th>
                <th className="text-right">Rounds</th>
                <th className="text-right">House net (actual)</th>
                <th className="text-right">Expected net</th>
              </tr>
            </thead>
            <tbody className="num">
              {points.map((p) => (
                <tr key={p.day} className="border-t border-ink-800 text-ink-200">
                  <td className="py-1.5">{p.day}</td>
                  <td className="text-right">{p.rounds.toLocaleString()}</td>
                  <td className="text-right">{(p.actual / 100).toFixed(2)}</td>
                  <td className="text-right">{(p.theory / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface RtpRow {
  gameId: string;
  label: string;
  actual: number | null;
  theory: number | null;
  ci: [number, number] | null;
  z: number | null;
  rounds: number;
}

/**
 * Forest plot: for each game, the band is where actual RTP is expected to fall
 * 95% of the time if the game behaves exactly as documented (given the recorded
 * bet mix and sample size); the tick is theory; the dot is reality.
 */
export function RtpDeviationChart({ rows }: { rows: RtpRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = rows.filter((r) => r.actual !== null && r.theory !== null);
  if (data.length === 0) return <p className="text-sm text-ink-400">No settled rounds in this period.</p>;
  const rowH = 44;
  const m = { top: 8, right: 24, bottom: 28, left: 130 };
  const height = m.top + m.bottom + rowH * data.length;
  const iw = width - m.left - m.right;
  const vals = data.flatMap((r) => [r.actual!, r.theory!, ...(r.ci ?? [])]);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 5);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (v: number) => m.left + ((v - lo) / (hi - lo || 1)) * iw;
  return (
    <div>
      <div className="mb-3">
        <Legend
          items={[
            { label: 'Actual RTP', kind: 'dot', color: SERIES.actual },
            { label: 'Theoretical RTP', kind: 'line', color: SERIES.theory },
            { label: '95% range if behaving as documented', kind: 'band', color: SERIES.theory },
          ]}
        />
      </div>
      <div ref={ref} className="relative overflow-hidden" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label="Actual versus theoretical RTP by game with 95% ranges">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.top} y2={height - m.bottom} stroke={GRID} strokeWidth="1" />
              <text x={x(t)} y={height - 8} fill={AXIS_TEXT} fontSize="11" textAnchor="middle" className="num">
                {(t * 100).toFixed(1)}%
              </text>
            </g>
          ))}
          {data.map((r, i) => {
            const cy = m.top + rowH * i + rowH / 2;
            return (
              <g key={r.gameId} opacity={hover === null || hover === i ? 1 : 0.6}>
                <text x={m.left - 12} y={cy} fill="#ebe8e2" fontSize="12" textAnchor="end" dominantBaseline="central">
                  {r.label}
                </text>
                {r.ci && <rect x={x(r.ci[0])} y={cy - 7} width={Math.max(2, x(r.ci[1]) - x(r.ci[0]))} height="14" rx="4" fill={SERIES.theory} opacity="0.28" />}
                <line x1={x(r.theory!)} x2={x(r.theory!)} y1={cy - 11} y2={cy + 11} stroke={SERIES.theory} strokeWidth="2" strokeLinecap="round" />
                <circle cx={x(r.actual!)} cy={cy} r="5" fill={SERIES.actual} stroke={SURFACE} strokeWidth="2" />
                <rect
                  x={m.left}
                  y={cy - rowH / 2}
                  width={iw}
                  height={rowH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${r.label}: actual ${(r.actual! * 100).toFixed(2)}%, theoretical ${(r.theory! * 100).toFixed(2)}%`}
                  onPointerMove={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <Tooltip x={x(data[hover]!.actual!)} y={m.top + rowH * hover} width={width}>
            <div className="mb-1 text-ink-400">{data[hover]!.label}</div>
            <div className="flex justify-between">
              <span className="text-ink-300">Actual</span>
              <span className="num font-semibold text-ink-100">{(data[hover]!.actual! * 100).toFixed(3)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-300">Theoretical</span>
              <span className="num font-semibold text-ink-100">{(data[hover]!.theory! * 100).toFixed(3)}%</span>
            </div>
            {data[hover]!.z !== null && (
              <div className="flex justify-between">
                <span className="text-ink-300">z-score</span>
                <span className="num font-semibold text-ink-100">{data[hover]!.z!.toFixed(2)}</span>
              </div>
            )}
            <div className="mt-1 text-ink-400">{data[hover]!.rounds.toLocaleString()} rounds</div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Ratio against a limit. Fill carries severity; the track is a lighter step of the same family. */
export function Meter({ value, limit, label }: { value: number; limit: number; label: ReactNode }) {
  const ratio = limit > 0 ? Math.min(1, Math.max(0, value / limit)) : 0;
  const tone = ratio >= 0.85 ? 'bg-negative' : ratio >= 0.6 ? 'bg-warning' : 'bg-gold-500';
  const track = ratio >= 0.85 ? 'bg-negative/15' : ratio >= 0.6 ? 'bg-warning/15' : 'bg-gold-500/15';
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-300">{label}</span>
        <span className="num text-ink-200">
          {(ratio * 100).toFixed(1)}%{ratio >= 0.85 ? ' · critical' : ratio >= 0.6 ? ' · elevated' : ''}
        </span>
      </div>
      <div className={cn('h-2 overflow-hidden rounded-full', track)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={typeof label === 'string' ? label : 'Utilisation'}>
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * One series of daily values as columns (counts or chips). Single series, so
 * no legend: the card title names it. Hover/focus shows the day's value; the
 * table view lists every day.
 */
export function DailyBars({ points, kind, label }: { points: { day: string; value: number }[]; kind: 'count' | 'chips'; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const fmt = (v: number) => (kind === 'chips' ? compactChips(v) : v.toLocaleString('en-US'));
  const height = 200;
  const m = { top: 12, right: 12, bottom: 26, left: 52 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(0, kind === 'count' ? Math.max(max, 4) : Math.max(max, 100));
  const hi = ticks[ticks.length - 1]!;
  const y = (v: number) => m.top + ih - (v / (hi || 1)) * ih;
  const band = iw / Math.max(points.length, 1);
  const bw = Math.min(24, Math.max(3, band - 2));
  const cx = (i: number) => m.left + band * i + band / 2;

  if (points.length === 0) return <p className="text-sm text-ink-400">No data in this period.</p>;
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-xs text-gold-400 hover:text-gold-300" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      </div>
      <div ref={ref} className="relative overflow-hidden" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#4b4f5a' : GRID} strokeWidth="1" />
              <text x={m.left - 8} y={y(t)} fill={AXIS_TEXT} fontSize="11" textAnchor="end" dominantBaseline="central" className="num">
                {fmt(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            if (p.value <= 0) return null;
            const top = y(p.value);
            const h = Math.max(1, y(0) - top);
            const r = Math.min(4, h / 2, bw / 2);
            const x0 = cx(i) - bw / 2;
            const d = `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${top + h} Z`;
            return <path key={p.day} d={d} fill={SERIES.actual} opacity={hover === null || hover === i ? 1 : 0.55} />;
          })}
          {points.map((p, i) =>
            i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
              <text key={p.day} x={cx(i)} y={height - 8} fill={AXIS_TEXT} fontSize="11" textAnchor="middle">
                {p.day.slice(5)}
              </text>
            ) : null,
          )}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.day}`}
              x={m.left + band * i}
              y={m.top}
              width={band}
              height={ih}
              fill="transparent"
              tabIndex={0}
              aria-label={`${p.day}: ${fmt(p.value)}`}
              onPointerMove={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && points[hover] && (
          <Tooltip x={cx(hover)} y={m.top} width={width}>
            <div className="text-ink-400">{points[hover]!.day} (UTC)</div>
            <div className="num font-semibold text-ink-100">{kind === 'chips' ? `${(points[hover]!.value / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} chips` : fmt(points[hover]!.value)}</div>
          </Tooltip>
        )}
      </div>
      {showTable && (
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-400">
                <th className="py-1.5">Day (UTC)</th>
                <th className="text-right">{kind === 'chips' ? 'Chips' : 'Count'}</th>
              </tr>
            </thead>
            <tbody className="num">
              {points.map((p) => (
                <tr key={p.day} className="border-t border-ink-800 text-ink-200">
                  <td className="py-1.5">{p.day}</td>
                  <td className="text-right">{kind === 'chips' ? (p.value / 100).toFixed(2) : p.value.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
