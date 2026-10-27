import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { completeOnboarding } from '@/server/users/onboarding';

/** Step 3: stores the player's details and completes onboarding (completeOnboarding validates every field). */
export const POST = route({ name: 'onboarding.complete', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, z.record(z.string(), z.unknown()));
  await completeOnboarding(ctx.session.userId, body, { ipHash: ctx.ipHash, requestId: ctx.requestId });
  return { completed: true, next: '/lobby?welcome=1' };
});
