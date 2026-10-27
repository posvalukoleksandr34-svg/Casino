import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { evaluateAchievements } from '@/server/achievements/achievements';

/** Re-derives the player's badges from recorded facts (idempotent) and lists them. */
export const GET = route({ name: 'achievements.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => ({
  achievements: await evaluateAchievements(ctx.session.userId),
}));
