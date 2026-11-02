import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { kycOverview } from '@/server/kyc/kyc';

export const GET = route({ name: 'kyc.get', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => kycOverview(session.userId));
