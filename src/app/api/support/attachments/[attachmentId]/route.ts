import { z } from 'zod';
import { hasPermission } from '@/server/auth/rbac';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { privateFileResponse } from '@/server/storage/private-files';
import { attachmentFile } from '@/server/support/tickets';

/** A ticket attachment for the ticket's owner or support staff. */
export const GET = route<'user', { attachmentId: string }>({ name: 'support.attachment', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.attachmentId).success) throw errors.notFound('Attachment');
  const f = await attachmentFile({ userId: session.userId, isSupport: hasPermission(session.role, 'support:manage') }, params.attachmentId);
  return privateFileResponse(f.bytes, f.contentType, f.fileName);
});
