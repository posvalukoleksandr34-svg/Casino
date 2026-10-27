import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { setUserRole } from '@/server/admin/users';
import { ROLES } from '@/server/auth/rbac';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ role: z.enum(ROLES as [string, ...string[]]), reason: reasonSchema }).strict();

/** Role changes; only owners grant or remove ADMIN and OWNER (enforced in setUserRole). */
export const POST = route<'roles:manage', { userId: string }>({ name: 'admin.user.role', auth: 'roles:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setUserRole(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.role as never, body.reason);
});
