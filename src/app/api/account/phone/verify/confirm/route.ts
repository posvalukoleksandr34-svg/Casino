import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { confirmPhoneVerification, PHONE_LIMITS } from '@/server/users/phone-verification';

const schema = z.object({ code: z.string().max(20) }).strict();

export const POST = route({ name: 'account.phone.confirm', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, PHONE_LIMITS.verifyIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return { phone: await confirmPhoneVerification(ctx.session.userId, body.code.replace(/\D/g, ''), { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId }) };
});
