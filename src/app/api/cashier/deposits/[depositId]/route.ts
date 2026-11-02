import { z } from 'zod';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { errors } from '@/server/errors';
import { getDeposit } from '@/server/payments/deposits';

/** One of the player's deposits (its status is polled by the checkout return page). */
export const GET = route<'user', { depositId: string }>({ name: 'cashier.deposit', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.depositId).success) throw errors.notFound('Deposit');
  return { deposit: await getDeposit(session.userId, params.depositId) };
});
