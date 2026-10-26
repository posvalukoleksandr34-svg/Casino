import { z } from 'zod';
import { listAlerts } from '@/server/admin/admin-service';
import { parseQuery, route } from '@/server/http/handler';

const query = z.object({ all: z.enum(['true', 'false']).default('false') });

export const GET = route({ name: 'admin.alerts', auth: 'system:read' }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  return { alerts: await listAlerts({ includeAcknowledged: q.all === 'true' }) };
});
