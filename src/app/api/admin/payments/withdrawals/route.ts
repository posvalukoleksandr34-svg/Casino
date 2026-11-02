import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { adminWithdrawals } from '@/server/payments/admin';

const query = z.object({ view: z.enum(['queue', 'processing', 'all']).default('queue') });

export const GET = route({ name: 'admin.payments.withdrawals', auth: 'payments:read', rateLimit: [RATE_LIMITS.adminUser] }, async ({ req }) => ({
  withdrawals: await adminWithdrawals({ view: parseQuery(req, query).view }),
}));
