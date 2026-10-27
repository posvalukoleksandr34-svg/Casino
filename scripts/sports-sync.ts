/**
 * Runs one pass of the sports job (normally done every minute by the in-process
 * scheduler): demo fixtures and results, or the live providers, then settlement
 * catch-up. Takes the scheduler's advisory lock, so it never overlaps a running
 * pass. Useful when background jobs are disabled: npm run job:sports-sync
 */
import './load-env';

async function main() {
  const { syncSports } = await import('../src/server/sports/sync');
  const { withAdvisoryLock } = await import('../src/server/jobs/scheduler');
  const { closeDb } = await import('../src/server/db/client');
  const ran = await withAdvisoryLock(7_342_105, () => syncSports());
  console.log(JSON.stringify({ msg: 'sports-sync', ran }));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
