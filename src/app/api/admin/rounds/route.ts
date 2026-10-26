import { z } from 'zod';
import { listRounds } from '@/server/games/round-service';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({
  userId: z.uuid().optional(),
  game: z.string().max(20).optional(),
  status: z.enum(['OPEN', 'SETTLED', 'VOIDED']).optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = route({ name: 'admin.rounds', auth: 'rounds:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  return { items: await listRounds({ userId: q.userId, gameId: q.game, status: q.status, before: q.before ? new Date(q.before) : undefined, limit: q.limit }) };
});
