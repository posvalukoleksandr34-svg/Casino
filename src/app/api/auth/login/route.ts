import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJson, route, withFlowCookie, withSessionCookie } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { login, VerificationRequiredError } from '@/server/users/accounts';

const schema = z.object({ email: z.string().max(254), password: z.string().min(1).max(200) }).strict();

export const POST = route({ name: 'auth.login', auth: 'public', rateLimit: [RATE_LIMITS.loginIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  try {
    const res = await login(body.email, body.password, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
    return withSessionCookie(NextResponse.json({ user: res.user, onboardingRequired: res.onboardingPending }), res.session.token, res.session.expiresAt);
  } catch (err) {
    // Correct password, unverified e-mail: no session; continue on the verification page.
    if (err instanceof VerificationRequiredError) {
      return withFlowCookie(
        NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null, requestId: ctx.requestId } }, { status: err.status }),
        err.flow.token,
        err.flow.expiresAt,
      );
    }
    throw err;
  }
});
