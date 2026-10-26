/**
 * In-process metrics registry rendered in Prometheus text format at
 * /api/metrics. Counters and a fixed-bucket latency histogram; values are
 * per process (aggregate across instances in Prometheus).
 */
type Labels = Record<string, string>;

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface Histogram {
  buckets: number[];
  sum: number;
  count: number;
}

function key(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, '_')}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

class Registry {
  private counters = new Map<string, number>();
  private histograms = new Map<string, Histogram>();
  readonly startedAt = Date.now();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  observe(name: string, labels: Labels, valueMs: number): void {
    const k = key(name, labels);
    let h = this.histograms.get(k);
    if (!h) {
      h = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.histograms.set(k, h);
    }
    BUCKETS.forEach((b, i) => {
      if (valueMs <= b) h!.buckets[i]! += 1;
    });
    h.sum += valueMs;
    h.count += 1;
  }

  counterValue(name: string, labels: Labels = {}): number {
    return this.counters.get(key(name, labels)) ?? 0;
  }

  /** Sum of a counter across all label combinations, optionally filtered. */
  counterTotal(name: string, filter?: (labelString: string) => boolean): number {
    let total = 0;
    for (const [k, v] of this.counters) {
      if (k === name || k.startsWith(`${name}{`)) {
        if (!filter || filter(k)) total += v;
      }
    }
    return total;
  }

  render(): string {
    const lines: string[] = [];
    lines.push(`process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(0)}`);
    for (const [k, v] of [...this.counters].sort()) lines.push(`${k} ${v}`);
    for (const [k, h] of [...this.histograms].sort()) {
      const brace = k.indexOf('{');
      const name = brace === -1 ? k : k.slice(0, brace);
      const labels = brace === -1 ? '' : k.slice(brace + 1, -1);
      const join = (extra: string) => `{${[labels, extra].filter(Boolean).join(',')}}`;
      BUCKETS.forEach((b, i) => lines.push(`${name}_bucket${join(`le="${b}"`)} ${h.buckets[i]}`));
      lines.push(`${name}_bucket${join('le="+Inf"')} ${h.count}`);
      lines.push(`${name}_sum${labels ? `{${labels}}` : ''} ${h.sum.toFixed(1)}`);
      lines.push(`${name}_count${labels ? `{${labels}}` : ''} ${h.count}`);
    }
    return lines.join('\n') + '\n';
  }
}

const g = globalThis as unknown as { __casinoMetrics?: Registry };
export const metrics: Registry = (g.__casinoMetrics ??= new Registry());
