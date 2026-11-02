import { z } from 'zod';
import { parseInput, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { readUpload } from '@/server/storage/private-files';
import { createTicket, listTickets } from '@/server/support/tickets';

export const GET = route({ name: 'support.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({ tickets: await listTickets(session.userId) }));

const fields = z
  .object({
    category: z.enum(['ACCOUNT', 'PAYMENTS', 'VERIFICATION', 'BONUSES', 'GAMES', 'RESPONSIBLE_PLAY', 'OTHER']),
    subject: z.string().max(200),
    body: z.string().max(6000),
  })
  .strict();

/** Opens a ticket (multipart: category, subject, body and an optional file). */
export const POST = route({ name: 'support.create', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser, RATE_LIMITS.supportUser] }, async ({ req, session }) => {
  const { fields: raw, file } = await readUpload(req);
  return { ticket: await createTicket(session.userId, parseInput(fields, raw), file) };
});
