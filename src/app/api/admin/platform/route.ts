import { z } from 'zod';
import { platformPatchSchema, reasonSchema, updatePlatformSettings } from '@/server/admin/admin-service';
import { getDb } from '@/server/db/client';
import { adminCtx } from '@/server/http/admin';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { readJson, route } from '@/server/http/handler';
import { getPlatformSettings } from '@/server/risk/risk-service';

export const GET = route({ name: 'admin.platform', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ settings: await getPlatformSettings(getDb()) }));

const schema = z.object({ patch: platformPatchSchema, reason: reasonSchema }).strict();

/** Kill switch, incident banner, exposure and reserve limits, bonus amounts. */
export const PATCH = route({ name: 'admin.platform.update', auth: 'risk:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return updatePlatformSettings(adminCtx(ctx), body.patch, body.reason);
});
