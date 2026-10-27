import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { evaluateAchievements } from '@/server/achievements/achievements';
import { profileSchema, updateProfile } from '@/server/users/profile';

export const PATCH = route({ name: 'account.profile', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, profileSchema);
  const profile = await updateProfile(ctx.session.userId, body, { ipHash: ctx.ipHash, requestId: ctx.requestId });
  return { profile, achievements: await evaluateAchievements(ctx.session.userId) };
});
