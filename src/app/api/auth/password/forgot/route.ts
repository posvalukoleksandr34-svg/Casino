import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { requestPasswordReset, type PasswordRecovery } from '@/server/users/accounts';

const schema = z.object({ email: z.string().max(254) }).strict();

const MESSAGES: Record<PasswordRecovery, string> = {
  email: 'If an account exists for that address, we have sent a reset link. It works once and expires in 30 minutes.',
  console: 'Development mode: if an account exists for that address, the reset link has been printed in the server console. No e-mail is sent.',
  unavailable: 'Password recovery by e-mail is not available on this site yet. Please contact support to regain access to your account.',
};

/**
 * The response depends only on how this deployment delivers resets — never on
 * whether the address has an account — so it cannot be used for enumeration.
 */
export const POST = route({ name: 'auth.password.forgot', auth: 'public', rateLimit: [RATE_LIMITS.passwordResetIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const { recovery } = await requestPasswordReset(body.email, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  return { ok: recovery !== 'unavailable', recovery, message: MESSAGES[recovery] };
});
