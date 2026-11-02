import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { methodPatchSchema, updateMethod } from '@/server/payments/admin';

const schema = z.object({ patch: methodPatchSchema, reason: reasonSchema }).strict();

export const PATCH = route<'payments:configure', { methodId: string }>({ name: 'admin.payments.method_update', auth: 'payments:configure', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!/^[a-z0-9-]{2,40}$/.test(ctx.params.methodId)) throw errors.notFound('Payment method');
  const body = await readJson(ctx.req, schema);
  return { method: await updateMethod(adminCtx(ctx), ctx.params.methodId, body.patch, body.reason) };
});
