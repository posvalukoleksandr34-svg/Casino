import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listRewards } from '@/server/rewards/rewards';

export const GET = route({ name: 'rewards.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => listRewards(session.userId));
