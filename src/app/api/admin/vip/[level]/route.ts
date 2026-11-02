import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { tierPatchSchema, updateTier } from '@/server/vip/vip';

const schema = z.object({ patch: tierPatchSchema, reason: reasonSchema }).strict();

/** Edits a VIP tier (threshold, name, perks). Thresholds must keep increasing; nobody is ever moved down. */
export const PATCH = route<'promotions:manage', { level: string }>({ name: 'admin.vip.update', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const level = z.coerce.number().int().min(1).max(10).parse(ctx.params.level);
  const body = await readJson(ctx.req, schema);
  return { tier: await updateTier(adminCtx(ctx), level, body.patch, body.reason) };
});
