import { AppError } from '@/server/errors';
import { flowUserId, route } from '@/server/http/handler';
import { resendSignupCode, VERIFY_LIMITS } from '@/server/users/verification';

/** A new code for the pending registration (supersedes the previous one; cooldown and hourly limits apply). */
export const POST = route({ name: 'auth.verify_email.resend', auth: 'public', rateLimit: [VERIFY_LIMITS.sendIp] }, async (ctx) => {
  const userId = flowUserId(ctx.req);
  if (!userId) throw new AppError('UNAUTHENTICATED', 'This verification session has ended. Sign in with your e-mail and password to continue.');
  const res = await resendSignupCode(userId, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return { sent: res.sent, verification: res.status };
});
