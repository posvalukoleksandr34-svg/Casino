import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { preferencesSchema, updatePreferences } from '@/server/users/accounts';

export const PATCH = route({ name: 'account.preferences', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, preferencesSchema);
  return { preferences: await updatePreferences(ctx.session.userId, body) };
});
