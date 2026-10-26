/** Runs reconciliation once (for cron / a worker container). Exit code 2 on mismatch. */
import './load-env';

async function main() {
  const { runReconciliation } = await import('../src/server/jobs/reconciliation');
  const { detectAnomalies } = await import('../src/server/jobs/anomaly');
  const { closeDb } = await import('../src/server/db/client');
  const res = await runReconciliation('cli');
  const alerts = await detectAnomalies();
  console.log(JSON.stringify({ runId: res.id, status: res.status, mismatches: res.mismatchCount, newAlerts: alerts, checks: res.checks.map((c) => ({ name: c.name, mismatches: c.mismatches })) }, null, 2));
  await closeDb();
  process.exit(res.status === 'OK' ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
