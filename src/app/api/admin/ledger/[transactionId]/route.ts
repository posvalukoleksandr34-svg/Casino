import { z } from 'zod';
import { ledgerTransactionDetail } from '@/server/admin/wallet';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

/** One ledger transaction with its entries (read-only). */
export const GET = route<'ledger:read', { transactionId: string }>({ name: 'admin.ledger.tx', auth: 'ledger:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const id = z.coerce.number().int().positive().safeParse(ctx.params.transactionId);
  if (!id.success) throw errors.notFound('Transaction');
  return ledgerTransactionDetail(id.data);
});
