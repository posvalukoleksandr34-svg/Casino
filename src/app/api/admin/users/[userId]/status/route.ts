import { z } from 'zod';
import { reasonSchema, setUserStatus } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema }).strict();

export const POST = route<'users:suspend', { userId: string }>({ name: 'admin.user.status', auth: 'users:suspend' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setUserStatus(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.status, body.reason);
});
