import { z } from 'zod';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { resolveRiskFlag } from '@/server/kyc/kyc';

const schema = z.object({ resolution: z.string().trim().min(5).max(500) }).strict();

export const POST = route<'kyc:review', { flagId: string }>({ name: 'admin.risk_flag.resolve', auth: 'kyc:review', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const id = z.coerce.number().int().positive().parse(ctx.params.flagId);
  const body = await readJson(ctx.req, schema);
  return resolveRiskFlag(adminCtx(ctx), id, body.resolution);
});
