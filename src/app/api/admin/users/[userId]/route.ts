import { userDetail } from '@/server/admin/users';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

export const GET = route<'users:read', { userId: string }>({ name: 'admin.user', auth: 'users:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) =>
  userDetail(ctx.params.userId, { role: ctx.session.role }),
);
