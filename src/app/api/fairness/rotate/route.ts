import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { withTransaction } from '@/server/db/client';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { rotateSeed } from '@/server/fairness/seeds';

const schema = z.object({ clientSeed: z.string().min(1).max(64).optional() }).strict();

export const POST = route({ name: 'fairness.rotate', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return withTransaction(async (tx) => {
    const result = await rotateSeed(tx, ctx.session.userId, body.clientSeed);
    await audit(tx, { actorId: ctx.session.userId, actorType: 'USER', action: 'fairness.seed_rotated', ipHash: ctx.ipHash });
    return result;
  });
});
