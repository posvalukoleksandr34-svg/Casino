/**
 * Next.js instrumentation hook: runs once per server process.
 *  1. Validates the server configuration. In production an unsafe or
 *     incomplete configuration stops the process (non-zero exit) instead of
 *     serving errors, so orchestrators see a failed start.
 *  2. Starts the background scheduler on the Node.js runtime unless
 *     BACKGROUND_JOBS=false (e.g. when jobs run in a dedicated worker).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('./server/env');
  try {
    env();
  } catch (err) {
    console.error(`[startup] ${(err as Error).message}`);
    if (process.env.NODE_ENV === 'production') process.exit(1);
    throw err;
  }
  if (process.env.BACKGROUND_JOBS === 'false') return;
  const { startScheduler } = await import('./server/jobs/scheduler');
  startScheduler();
}
