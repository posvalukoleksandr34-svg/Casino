import { z } from 'zod';
import { listUsers } from '@/server/admin/admin-service';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });

export const GET = route({ name: 'admin.users', auth: 'users:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  return { users: await listUsers(q) };
});
