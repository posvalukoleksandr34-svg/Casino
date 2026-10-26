import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJson, route, withSessionCookie } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { login } from '@/server/users/accounts';

const schema = z.object({ email: z.string().max(254), password: z.string().min(1).max(200) }).strict();

export const POST = route({ name: 'auth.login', auth: 'public', rateLimit: [RATE_LIMITS.loginIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const res = await login(body.email, body.password, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return withSessionCookie(NextResponse.json({ user: res.user }), res.session.token, res.session.expiresAt);
});
