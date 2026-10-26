import { z } from 'zod';
import { fundHouse, reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { IDEMPOTENCY_KEY_PATTERN } from '@/server/idempotency';

const schema = z.object({ amount: z.int().positive(), reason: reasonSchema }).strict();

export const POST = route({ name: 'admin.house.fund', auth: 'house:fund' }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw errors.validation('Invalid Idempotency-Key');
  const body = await readJson(ctx.req, schema);
  return fundHouse(adminCtx(ctx), body.amount, body.reason, key);
});
