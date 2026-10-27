import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { verifyRoundOnServer } from '@/server/achievements/achievements';

const bodySchema = z.object({ roundId: z.uuid() }).strict();

/** Server-side recomputation of one of the player's own settled rounds from its revealed seed. */
export const POST = route({ name: 'fairness.verify_round', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const { roundId } = await readJson(ctx.req, bodySchema);
  return { verification: await verifyRoundOnServer(ctx.session.userId, roundId) };
});
