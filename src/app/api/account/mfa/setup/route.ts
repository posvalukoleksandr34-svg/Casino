import { beginEnrollment } from '@/server/auth/mfa';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

/** Issues a new authenticator secret (shown once). Nothing changes until it is confirmed with a code. */
export const POST = route({ name: 'account.mfa.setup', auth: 'user', rateLimit: [RATE_LIMITS.mfaUser] }, async (ctx) => beginEnrollment(ctx.session.userId, ctx.session.email));
