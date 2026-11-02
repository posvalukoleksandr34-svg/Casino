import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { getDb } from '@/server/db/client';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { cashierSettingsPatchSchema, listMethods, updateCashierSettings } from '@/server/payments/admin';
import { getCashierSettings } from '@/server/payments/config';

export const GET = route({ name: 'admin.payments.settings', auth: 'payments:read', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({
  settings: await getCashierSettings(getDb()),
  methods: await listMethods(),
}));

const schema = z.object({ patch: cashierSettingsPatchSchema, reason: reasonSchema }).strict();

export const PATCH = route({ name: 'admin.payments.settings_update', auth: 'payments:configure', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return { settings: await updateCashierSettings(adminCtx(ctx), body.patch, body.reason) };
});
