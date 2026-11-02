import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { getDb } from '@/server/db/client';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { getRewardSettings, rewardSettingsPatchSchema, updateRewardSettings } from '@/server/rewards/rewards';

export const GET = route({ name: 'admin.rewards.settings', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ settings: await getRewardSettings(getDb()) }));

const schema = z.object({ patch: rewardSettingsPatchSchema, reason: reasonSchema }).strict();

export const PATCH = route({ name: 'admin.rewards.settings_update', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return { settings: await updateRewardSettings(adminCtx(ctx), body.patch, body.reason) };
});
