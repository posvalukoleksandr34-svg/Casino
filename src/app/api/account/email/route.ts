import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { emailSchema } from '@/server/users/accounts';
import { cancelEmailChange, emailChangeStatus, requestEmailChange, VERIFY_LIMITS } from '@/server/users/verification';

export const GET = route({ name: 'account.email', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => ({ pending: await emailChangeStatus(ctx.session.userId) }));

/** Starts (or, without `email`, resends) a change: the code goes to the new address; the old one stays until it is entered. */
const schema = z.object({ email: emailSchema.optional(), password: z.string().min(1).max(200).optional() }).strict();

export const POST = route({ name: 'account.email.change', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser, VERIFY_LIMITS.sendIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const res = await requestEmailChange(ctx.session.userId, body.email ?? null, body.password ?? null, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return { sent: res.sent, pending: res.status };
});

export const DELETE = route({ name: 'account.email.cancel', auth: 'user', onboarding: 'allow', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  await cancelEmailChange(ctx.session.userId, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  return { pending: null };
});
