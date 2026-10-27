import { z } from 'zod';
import { errors } from '@/server/errors';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { previewSettlement } from '@/server/sports/admin';

const query = z.object({ home: z.coerce.number().int().min(0).max(99).optional(), away: z.coerce.number().int().min(0).max(99).optional(), void: z.enum(['1']).optional() });

/** Read-only: what recording this result (or a void) would settle and credit. */
export const GET = route<'sports:manage', { eventId: string }>({ name: 'admin.sports.preview', auth: 'sports:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  if (q.void) return previewSettlement(ctx.params.eventId, { kind: 'VOID' });
  if (q.home === undefined || q.away === undefined) throw errors.validation('Give home and away scores, or void=1');
  return previewSettlement(ctx.params.eventId, { kind: 'RESULT', home: q.home, away: q.away });
});
