import { z } from 'zod';
import { dateRange } from '@/server/admin/period';
import { LEDGER_TYPES, listLedger } from '@/server/admin/wallet';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({
  type: z.enum(LEDGER_TYPES as [string, ...string[]]).optional(),
  userId: z.uuid().optional(),
  transactionId: z.coerce.number().int().positive().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Ledger transactions, newest first (keyset pagination with `before`). Read-only. */
export const GET = route({ name: 'admin.ledger', auth: 'ledger:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const { from, to, type, ...q } = parseQuery(ctx.req, query);
  return listLedger({ ...q, type: type as never, ...dateRange({ from, to }) });
});
