import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { decideKyc } from '@/server/kyc/kyc';

const schema = z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), note: reasonSchema }).strict();

/** Verifies or rejects a submission. The note is shown to the player; a reviewer cannot decide their own. */
export const POST = route<'kyc:review', { userId: string }>({ name: 'admin.kyc.decide', auth: 'kyc:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.userId).success) throw errors.notFound('User');
  const body = await readJson(ctx.req, schema);
  return decideKyc(adminCtx(ctx), ctx.params.userId, body.decision, body.note);
});
