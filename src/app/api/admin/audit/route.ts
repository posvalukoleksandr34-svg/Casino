import { z } from 'zod';
import { listAudit } from '@/server/admin/admin-service';
import { parseQuery, route } from '@/server/http/handler';

const query = z.object({
  action: z.string().max(60).optional(),
  actorId: z.uuid().optional(),
  resourceId: z.string().max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const GET = route({ name: 'admin.audit', auth: 'audit:read' }, async (ctx) => ({ items: await listAudit(parseQuery(ctx.req, query)) }));
