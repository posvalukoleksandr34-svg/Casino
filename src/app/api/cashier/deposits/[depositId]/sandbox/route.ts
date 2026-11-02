import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { errors } from '@/server/errors';
import { getDeposit } from '@/server/payments/deposits';
import { sandboxCheckout } from '@/server/payments/sandbox-actions';

const schema = z.object({ outcome: z.enum(['pay', 'decline', 'cancel']) }).strict();

/**
 * The simulated provider's checkout (sandbox mode only; 404 otherwise). It
 * makes the simulator send its signed webhook; the webhook handler, not this
 * route, decides what happens to the wallet.
 */
export const POST = route<'user', { depositId: string }>({ name: 'cashier.sandbox_checkout', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ req, params, session }) => {
  if (!z.uuid().safeParse(params.depositId).success) throw errors.notFound('Deposit');
  const { outcome } = await readJson(req, schema);
  const res = await sandboxCheckout(session.userId, params.depositId, outcome);
  return { ...res, deposit: await getDeposit(session.userId, params.depositId) };
});
