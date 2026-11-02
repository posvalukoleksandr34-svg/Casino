import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { forfeitBonus } from '@/server/promotions/campaigns';

const schema = z.object({ claimId: z.int().positive() }).strict();

/** The player gives up their active bonus; its locked credits are not paid out. */
export const POST = route({ name: 'promotions.forfeit', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ req, session }) => {
  const body = await readJson(req, schema);
  return forfeitBonus(session.userId, body.claimId);
});
