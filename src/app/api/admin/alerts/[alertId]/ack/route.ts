import { z } from 'zod';
import { acknowledgeAlert, reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ reason: reasonSchema }).strict();

export const POST = route<'system:operate', { alertId: string }>({ name: 'admin.alert.ack', auth: 'system:operate', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return acknowledgeAlert(adminCtx(ctx), z.coerce.number().int().positive().parse(ctx.params.alertId), body.reason);
});
