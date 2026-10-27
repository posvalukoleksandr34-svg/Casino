import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { confirmEmailChange, VERIFY_LIMITS } from '@/server/users/verification';

const schema = z.object({ code: z.string().max(20) }).strict();

/** Switches the account to the new address; other sessions are signed out. */
export const POST = route({ name: 'account.email.confirm', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser, VERIFY_LIMITS.verifyIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return confirmEmailChange(ctx.session.userId, ctx.session.sessionId, body.code.replace(/\D/g, ''), { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
});
