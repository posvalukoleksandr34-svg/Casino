import { z } from 'zod';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listWithdrawals, requestWithdrawal } from '@/server/payments/withdrawals';

export const GET = route({ name: 'cashier.withdrawals', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({
  withdrawals: await listWithdrawals(session.userId),
}));

const schema = z
  .object({
    methodId: z.string().regex(/^[a-z0-9-]{2,40}$/),
    amount: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/** Requests a withdrawal: the amount leaves the spendable balance at once and is held until paid, rejected or cancelled. */
export const POST = route({ name: 'cashier.withdrawal_request', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.paymentUser] }, async ({ req, session }) => {
  const body = await readJson(req, schema);
  return requestWithdrawal(session.userId, body, idempotencyKeyFrom(req));
});
