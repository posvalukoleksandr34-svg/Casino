import { z } from 'zod';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { addRiskFlag } from '@/server/kyc/kyc';

const schema = z
  .object({
    kind: z.enum(['DOCUMENT_MISMATCH', 'MULTIPLE_ACCOUNTS', 'PAYMENT_CHARGEBACK', 'BONUS_ABUSE', 'SOURCE_OF_FUNDS', 'OTHER']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    note: z.string().trim().min(5).max(500),
  })
  .strict();

/** Adds a compliance flag; while it is open, every withdrawal of the account goes to manual review. */
export const POST = route<'kyc:review', { userId: string }>({ name: 'admin.kyc.flag', auth: 'kyc:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.userId).success) throw errors.notFound('User');
  const body = await readJson(ctx.req, schema);
  return { flag: await addRiskFlag(adminCtx(ctx), ctx.params.userId, body) };
});
