import { z } from 'zod';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { createDeposit, listDeposits } from '@/server/payments/deposits';

export const GET = route({ name: 'cashier.deposits', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({
  deposits: await listDeposits(session.userId),
}));

const schema = z
  .object({
    methodId: z.string().regex(/^[a-z0-9-]{2,40}$/),
    amount: z.int().positive().max(Number.MAX_SAFE_INTEGER),
    bonusCampaignId: z.int().positive().nullable().optional(),
  })
  .strict();

/**
 * Starts a deposit with the provider and returns where to complete it. The
 * wallet is not credited here: only the provider's verified settlement does that.
 */
export const POST = route({ name: 'cashier.deposit_create', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.paymentUser] }, async ({ req, session }) => {
  const body = await readJson(req, schema);
  return createDeposit(session.userId, body, idempotencyKeyFrom(req));
});
