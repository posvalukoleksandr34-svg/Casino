import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { financeSummary } from '@/server/payments/admin';

export const GET = route({ name: 'admin.payments.summary', auth: 'payments:read', rateLimit: [RATE_LIMITS.adminUser] }, async () => financeSummary());
