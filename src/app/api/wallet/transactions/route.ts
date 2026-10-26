import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listTransactions } from '@/server/wallet/wallet';

const query = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(['BET_PLACED', 'BET_SETTLED', 'ROUND_VOIDED', 'BONUS_GRANTED', 'ADJUSTMENT']).optional(),
});

export const GET = route({ name: 'wallet.transactions', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  const items = await listTransactions(ctx.session.userId, { beforeEntryId: q.before, limit: q.limit, type: q.type });
  return { items, nextCursor: items.length === q.limit ? items[items.length - 1]!.entryId : null };
});
