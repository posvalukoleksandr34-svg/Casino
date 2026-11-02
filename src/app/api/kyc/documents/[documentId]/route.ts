import { z } from 'zod';
import { hasPermission } from '@/server/auth/rbac';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { kycDocumentFile } from '@/server/kyc/kyc';
import { privateFileResponse } from '@/server/storage/private-files';

/** Downloads an identity document: its owner, or compliance staff (audited). Never a public URL. */
export const GET = route<'user', { documentId: string }>({ name: 'kyc.document', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.documentId).success) throw errors.notFound('Document');
  const f = await kycDocumentFile({ userId: session.userId, canReview: hasPermission(session.role, 'kyc:review') }, params.documentId);
  return privateFileResponse(f.bytes, f.contentType, f.fileName);
});
