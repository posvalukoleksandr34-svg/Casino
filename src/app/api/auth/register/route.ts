import { NextResponse } from 'next/server';
import { readJson, route, withSessionCookie } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { register, registerSchema } from '@/server/users/accounts';

export const POST = route({ name: 'auth.register', auth: 'public', rateLimit: [RATE_LIMITS.registerIp] }, async (ctx) => {
  const body = await readJson(ctx.req, registerSchema);
  const res = await register(body, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return withSessionCookie(
    NextResponse.json({ user: res.user, signupBonus: res.signupBonus }, { status: 201 }),
    res.session.token,
    res.session.expiresAt,
  );
});
