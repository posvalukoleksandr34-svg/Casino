import { z } from 'zod';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { errors } from '@/server/errors';
import { cancelDeposit } from '@/server/payments/deposits';

/** Abandons a deposit that has not been paid. */
export const POST = route<'user', { depositId: string }>({ name: 'cashier.deposit_cancel', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.depositId).success) throw errors.notFound('Deposit');
  return { deposit: await cancelDeposit(session.userId, params.depositId) };
});
