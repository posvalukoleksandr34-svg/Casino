import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { PHONE_LIMITS, phoneVerificationStatus, startPhoneVerification } from '@/server/users/phone-verification';

/** Phone verification state: whether SMS verification is available, the number's status, any pending code. */
export const GET = route({ name: 'account.phone.status', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => ({ phone: await phoneVerificationStatus(ctx.session.userId) }));

/** Sends a code to the account's current number (503 when no SMS provider is configured). */
export const POST = route({ name: 'account.phone.verify', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, PHONE_LIMITS.sendIp] }, async (ctx) => ({
  phone: await startPhoneVerification(ctx.session.userId, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId }),
}));
