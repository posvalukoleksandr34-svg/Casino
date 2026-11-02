import { z } from 'zod';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { errors } from '@/server/errors';
import { cancelWithdrawal } from '@/server/payments/withdrawals';

/** Cancels a withdrawal before the payout is sent; the amount returns to the wallet. */
export const POST = route<'user', { withdrawalId: string }>({ name: 'cashier.withdrawal_cancel', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.withdrawalId).success) throw errors.notFound('Withdrawal');
  return { withdrawal: await cancelWithdrawal(session.userId, params.withdrawalId) };
});
