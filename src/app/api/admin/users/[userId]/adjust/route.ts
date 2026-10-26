import { z } from 'zod';
import { adjustBalance, reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { IDEMPOTENCY_KEY_PATTERN } from '@/server/idempotency';
import { errors } from '@/server/errors';

const schema = z
  .object({ amount: z.int().refine((v) => v !== 0, 'Amount must be non-zero'), reason: reasonSchema, reversesTransactionId: z.int().positive().optional() })
  .strict();

/** Compensating balance correction (ADMIN only, visible to the player, fully audited). */
export const POST = route<'ledger:adjust', { userId: string }>({ name: 'admin.user.adjust', auth: 'ledger:adjust' }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw errors.validation('Invalid Idempotency-Key');
  const body = await readJson(ctx.req, schema);
  return adjustBalance(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.amount, body.reason, key, body.reversesTransactionId);
});
