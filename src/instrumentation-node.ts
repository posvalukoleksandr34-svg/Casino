/**
 * Node.js-only startup (imported from instrumentation.ts behind a
 * NEXT_RUNTIME check, so the edge bundle never includes the database driver).
 *  1. Validates the server configuration. In production an unsafe or
 *     incomplete configuration stops the process (non-zero exit) instead of
 *     serving errors, so orchestrators see a failed start.
 *  2. Starts the background scheduler unless BACKGROUND_JOBS=false (e.g. when
 *     jobs run in a dedicated worker).
 */
import { env, metricsToken } from './server/env';
import { logger } from './server/observability/logger';
import { startScheduler } from './server/jobs/scheduler';

export function startNodeServer(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  try {
    env();
  } catch (err) {
    console.error(`[startup] ${(err as Error).message}`);
    if (process.env.NODE_ENV === 'production') process.exit(1);
    throw err;
  }
  // Metrics are optional; say which way this instance is configured.
  logger.info(metricsToken() ? 'metrics endpoint enabled (bearer token required)' : 'metrics endpoint disabled (METRICS_TOKEN not set)');
  if (process.env.BACKGROUND_JOBS === 'false') return;
  startScheduler();
}
