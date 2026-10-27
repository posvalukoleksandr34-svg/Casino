import { z } from 'zod';
import { listAlerts } from '@/server/admin/admin-service';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({ all: z.enum(['true', 'false']).default('false') });

export const GET = route({ name: 'admin.alerts', auth: 'system:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  return { alerts: await listAlerts({ includeAcknowledged: q.all === 'true' }) };
});
