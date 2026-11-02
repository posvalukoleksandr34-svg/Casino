import { z } from 'zod';
import { errors } from '@/server/errors';
import { parseInput, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { readUpload } from '@/server/storage/private-files';
import { playerReply } from '@/server/support/tickets';

const fields = z.object({ body: z.string().max(6000) }).strict();

export const POST = route<'user', { ticketId: string }>({ name: 'support.reply', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.supportUser] }, async ({ req, params, session }) => {
  if (!z.uuid().safeParse(params.ticketId).success) throw errors.notFound('Ticket');
  const { fields: raw, file } = await readUpload(req);
  return { ticket: await playerReply(session.userId, params.ticketId, parseInput(fields, raw).body, file) };
});
