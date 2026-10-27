import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeMfaLogin } from '@/server/auth/mfa';
import { readJson, route, withSessionCookie } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ challenge: z.string().min(10).max(400), code: z.string().trim().min(6).max(20) }).strict();

/** Second sign-in step: exchanges the password step's challenge and a TOTP or recovery code for a session. */
export const POST = route({ name: 'auth.login.mfa', auth: 'public', rateLimit: [RATE_LIMITS.loginIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const res = await completeMfaLogin(body.challenge, body.code, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return withSessionCookie(NextResponse.json({ user: res.user }), res.session.token, res.session.expiresAt);
});
