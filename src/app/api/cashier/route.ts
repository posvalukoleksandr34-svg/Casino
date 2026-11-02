import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { depositOptions } from '@/server/payments/deposits';
import { withdrawalOptions } from '@/server/payments/withdrawals';

/** Everything the cashier shows, computed on the server: methods, limits, fees, bonuses and every reason something is unavailable. */
export const GET = route({ name: 'cashier.options', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({
  deposit: await depositOptions(session.userId),
  withdrawal: await withdrawalOptions(session.userId),
}));
