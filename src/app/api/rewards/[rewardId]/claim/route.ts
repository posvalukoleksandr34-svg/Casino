import { z } from 'zod';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { claimReward } from '@/server/rewards/rewards';

/** Claims one of the player's own rewards. The amount comes from the server's record, never from the request. */
export const POST = route<'user', { rewardId: string }>({ name: 'rewards.claim', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session }) => {
  const id = z.coerce.number().int().positive().parse(params.rewardId);
  return claimReward(session.userId, id);
});
