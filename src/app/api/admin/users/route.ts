import { z } from 'zod';
import { listUsers, USER_SORTS } from '@/server/admin/users';
import { dateRange } from '@/server/admin/period';
import { hasPermission, ROLES } from '@/server/auth/rbac';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  sort: z.enum(USER_SORTS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Paginated player search. E-mail addresses are masked (and not searchable) without users:pii. */
export const GET = route({ name: 'admin.users', auth: 'users:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const { from, to, role, ...q } = parseQuery(ctx.req, query);
  return listUsers({ ...q, role: role as never, ...dateRange({ from, to }), canSeePii: hasPermission(ctx.session.role, 'users:pii') });
});
