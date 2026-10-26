import { z } from 'zod';
import { reasonSchema, setUserRole } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ role: z.enum(['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN']), reason: reasonSchema }).strict();

export const POST = route<'roles:manage', { userId: string }>({ name: 'admin.user.role', auth: 'roles:manage' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setUserRole(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.role, body.reason);
});
