import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { kycCase } from '@/server/kyc/kyc';

export const GET = route<'kyc:review', { userId: string }>({ name: 'admin.kyc.case', auth: 'kyc:review', rateLimit: [RATE_LIMITS.adminUser] }, async ({ params }) => {
  if (!z.uuid().safeParse(params.userId).success) throw errors.notFound('User');
  return kycCase(params.userId);
});
