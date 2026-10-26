import { getDb } from '../db/client';
import { errorEvents } from '../db/schema';
import { logger } from './logger';
import { metrics } from './metrics';

/**
 * Error tracking: every unexpected error is logged with its stack and stored
 * (message only, no request payloads) in error_events for the operations
 * dashboard. Persisting is best-effort and never throws.
 */
export function captureError(err: unknown, ctx: { route?: string; requestId?: string; code?: string } = {}): void {
  const error = err instanceof Error ? err : new Error(String(err));
  metrics.inc('casino_errors_total', { route: ctx.route ?? 'unknown' });
  logger.error('unhandled error', { route: ctx.route, requestId: ctx.requestId, error });
  getDb()
    .insert(errorEvents)
    .values({
      route: ctx.route ?? null,
      code: ctx.code ?? 'INTERNAL',
      message: error.message.slice(0, 500),
      requestId: ctx.requestId ?? null,
    })
    .catch(() => undefined);
}
