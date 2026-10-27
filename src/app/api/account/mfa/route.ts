import { mfaStatus } from '@/server/auth/mfa';
import { route } from '@/server/http/handler';

/** Two-factor status of the signed-in account. */
export const GET = route({ name: 'account.mfa', auth: 'user' }, async (ctx) => ({
  ...(await mfaStatus(ctx.session.userId)),
  sessionVerified: ctx.session.mfaVerifiedAt !== null,
}));
