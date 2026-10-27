import { z } from 'zod';
import { listAudit } from '@/server/admin/admin-service';
import { dateRange } from '@/server/admin/period';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({
  action: z.string().max(60).optional(),
  actorId: z.uuid().optional(),
  actorName: z.string().max(40).optional(),
  resourceId: z.string().max(100).optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Audit log search (audit:read). Read-only: the application can never change or delete entries. */
export const GET = route({ name: 'admin.audit', auth: 'audit:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const { from, to, ...q } = parseQuery(ctx.req, query);
  return listAudit({ ...q, ...dateRange({ from, to }) });
});
