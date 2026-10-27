import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { revokeUserSessions } from '@/server/admin/users';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ reason: reasonSchema }).strict();

/** Signs an account out of every device without suspending it. */
export const DELETE = route<'users:suspend', { userId: string }>({ name: 'admin.user.sessions', auth: 'users:suspend', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return revokeUserSessions(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.reason);
});
