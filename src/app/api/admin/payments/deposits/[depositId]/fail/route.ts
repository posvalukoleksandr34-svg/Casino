import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { failDepositUnderReview } from '@/server/payments/admin';

const schema = z.object({ reason: reasonSchema }).strict();

/** Closes a deposit under review as failed (staff can never credit a wallet by hand). */
export const POST = route<'payments:review', { depositId: string }>({ name: 'admin.payments.deposit_fail', auth: 'payments:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.depositId).success) throw errors.notFound('Deposit');
  const { reason } = await readJson(ctx.req, schema);
  return failDepositUnderReview(adminCtx(ctx), ctx.params.depositId, reason);
});
