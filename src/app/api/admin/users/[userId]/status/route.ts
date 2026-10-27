import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { setUserStatus } from '@/server/admin/users';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema }).strict();

/** Suspend or reinstate an account of a lower rank. Suspension signs the account out everywhere. */
export const POST = route<'users:suspend', { userId: string }>({ name: 'admin.user.status', auth: 'users:suspend', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setUserStatus(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.status, body.reason);
});
