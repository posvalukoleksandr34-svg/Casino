import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listRounds } from '@/server/games/round-service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const minor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const query = z.object({
  game: z.string().max(20).optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Filters (all optional): start date range (UTC days, inclusive), stake range and minimum payout in minor units, result, round id. */
  from: day.optional(),
  to: day.optional(),
  minStake: minor.optional(),
  maxStake: minor.optional(),
  minPayout: minor.optional(),
  result: z.enum(['win', 'loss', 'push']).optional(),
  round: z.uuid().optional(),
});

/** The player's own rounds, newest first, from the authoritative round records. */
export const GET = route({ name: 'rounds.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  const items = await listRounds({
    userId: ctx.session.userId,
    gameId: q.game,
    before: q.before ? new Date(q.before) : undefined,
    limit: q.limit,
    from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
    to: q.to ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) : undefined,
    minStake: q.minStake,
    maxStake: q.maxStake,
    minPayout: q.minPayout,
    result: q.result,
    roundId: q.round,
  });
  return { items, nextCursor: items.length === q.limit ? items[items.length - 1]!.startedAt : null };
});
