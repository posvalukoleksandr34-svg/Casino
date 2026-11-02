import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { submitKyc } from '@/server/kyc/kyc';

/** Sends the uploaded documents to compliance review. */
export const POST = route({ name: 'kyc.submit', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ session }) => submitKyc(session.userId));
