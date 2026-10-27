import { NextResponse } from 'next/server';
import { readJson, route, withFlowCookie } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { register, registerSchema } from '@/server/users/accounts';
import { signupStatus } from '@/server/users/verification';

/**
 * Step 1: creates a pending account and e-mails a verification code. No
 * session is issued; the response sets the signup-flow cookie used by the
 * verification page. The code itself never appears in a response.
 */
export const POST = route({ name: 'auth.register', auth: 'public', rateLimit: [RATE_LIMITS.registerIp] }, async (ctx) => {
  const body = await readJson(ctx.req, registerSchema);
  const res = await register(body, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return withFlowCookie(
    NextResponse.json({ status: 'verification_required', next: '/verify-email', sent: res.sent, verification: await signupStatus(res.user.id) }, { status: 201 }),
    res.flow.token,
    res.flow.expiresAt,
  );
});
