import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { claimDailyBonus } from '@/server/promotions/bonuses';

export const POST = route({ name: 'wallet.daily_bonus', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ session }) =>
  claimDailyBonus(session.userId),
);
