/**
 * Next.js instrumentation hook: runs once per server process. Starts the
 * background scheduler on the Node.js runtime unless BACKGROUND_JOBS=false
 * (e.g. when jobs run in a dedicated worker container).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.BACKGROUND_JOBS === 'false' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startScheduler } = await import('./server/jobs/scheduler');
  startScheduler();
}
