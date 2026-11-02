import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { reviewWithdrawal } from '@/server/payments/withdrawals';

const schema = z.object({ decision: z.enum(['approve', 'reject']), note: reasonSchema }).strict();

/** Approves (sends the payout; large amounts need a second, different approver) or rejects (returns the amount). */
export const POST = route<'payments:review', { withdrawalId: string }>({ name: 'admin.payments.withdrawal_review', auth: 'payments:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.withdrawalId).success) throw errors.notFound('Withdrawal');
  const body = await readJson(ctx.req, schema);
  return reviewWithdrawal(adminCtx(ctx), ctx.params.withdrawalId, body.decision, body.note);
});
