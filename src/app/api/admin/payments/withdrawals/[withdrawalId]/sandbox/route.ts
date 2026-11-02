import { z } from 'zod';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { sandboxSettlePayout } from '@/server/payments/sandbox-actions';

const schema = z.object({ outcome: z.enum(['paid', 'failed']) }).strict();

/** Sandbox test control (404 outside sandbox mode): the simulated provider reports a payout as paid or failed. */
export const POST = route<'payments:review', { withdrawalId: string }>({ name: 'admin.payments.sandbox_payout', auth: 'payments:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.withdrawalId).success) throw errors.notFound('Withdrawal');
  const { outcome } = await readJson(ctx.req, schema);
  return sandboxSettlePayout(adminCtx(ctx), ctx.params.withdrawalId, outcome);
});
