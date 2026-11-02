import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { kycQueue } from '@/server/kyc/kyc';

export const GET = route({ name: 'admin.kyc.queue', auth: 'kyc:review', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ queue: await kycQueue() }));
