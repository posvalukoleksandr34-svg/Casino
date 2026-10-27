/**
 * HTTP load test against a running instance (development data only).
 *   npx tsx scripts/load-test.ts [virtualUsers=50] [seconds=30] [thinkMs=300]
 * Each virtual user signs in, then places dice/roulette wagers in a loop with
 * think time. Reports throughput and latency percentiles, then reconciles.
 */
import './load-env';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('load test creates demo users; do not run against production');
  const vus = Number(process.argv[2] ?? 50);
  const seconds = Number(process.argv[3] ?? 30);
  const think = Number(process.argv[4] ?? 300);
  const { createOperatorAccount } = await import('../src/server/users/accounts');
  const { closeDb } = await import('../src/server/db/client');
  const tokens: string[] = [];
  for (let i = 0; i < vus; i += 1) {
    const tag = `load${Date.now().toString(36)}${i}`;
    const res = await createOperatorAccount({ email: `${tag}@example.test`, username: tag, password: 'load test password' }, { ipHash: null, userAgent: 'load' }, { onboarding: 'exempt', session: true });
    tokens.push(res.session!.token);
  }
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  const deadline = Date.now() + seconds * 1000;
  const started = Date.now();
  await Promise.all(
    tokens.map(async (token, i) => {
      let n = 0;
      while (Date.now() < deadline) {
        n += 1;
        const game = (i + n) % 2 ? 'dice' : 'roulette';
        const bet = game === 'dice' ? { amount: 100, target: 4950, direction: 'under' } : { bets: [{ type: 'red', amount: 100 }, { type: 'straight', number: n % 37, amount: 10 }] };
        const t0 = performance.now();
        const res = await fetch(`${BASE}/api/games/${game}/rounds`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `aurovane_session=${token}`, origin: BASE, 'idempotency-key': randomUUID() },
          body: JSON.stringify({ bet }),
        }).catch(() => null);
        latencies.push(performance.now() - t0);
        const status = res?.status ?? 0;
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
        await res?.arrayBuffer().catch(() => undefined);
        if (think > 0) await new Promise((r) => setTimeout(r, think));
      }
    }),
  );
  const elapsed = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const ok = statuses.get(201) ?? 0;
  const report = {
    virtualUsers: vus,
    seconds: Number(elapsed.toFixed(1)),
    thinkMs: think,
    requests: latencies.length,
    settledWagers: ok,
    wagersPerSecond: Number((ok / elapsed).toFixed(1)),
    statuses: Object.fromEntries(statuses),
    latencyMs: { p50: Number(pct(latencies, 50).toFixed(1)), p95: Number(pct(latencies, 95).toFixed(1)), p99: Number(pct(latencies, 99).toFixed(1)), max: Number(latencies.at(-1)?.toFixed(1)) },
  };
  console.log(JSON.stringify(report, null, 2));
  const { runChecks } = await import('../src/server/jobs/reconciliation');
  const checks = await runChecks();
  console.log(JSON.stringify({ reconciliationMismatches: checks.reduce((a, c) => a + c.mismatches, 0) }));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
