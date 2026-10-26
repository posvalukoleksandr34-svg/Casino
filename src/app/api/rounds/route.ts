import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listRounds } from '@/server/games/round-service';

const query = z.object({
  game: z.string().max(20).optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = route({ name: 'rounds.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  const items = await listRounds({
    userId: ctx.session.userId,
    gameId: q.game,
    before: q.before ? new Date(q.before) : undefined,
    limit: q.limit,
  });
  return { items, nextCursor: items.length === q.limit ? items[items.length - 1]!.startedAt : null };
});
