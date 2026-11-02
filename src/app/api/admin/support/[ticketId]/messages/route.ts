import { z } from 'zod';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { parseInput, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { readUpload } from '@/server/storage/private-files';
import { staffReply } from '@/server/support/tickets';

const fields = z.object({ body: z.string().max(6000), internal: z.enum(['true', 'false']).default('false') }).strict();

/** Replies to the player, or adds an internal note (multipart: body, internal, optional file). */
export const POST = route<'support:manage', { ticketId: string }>({ name: 'admin.support.reply', auth: 'support:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.ticketId).success) throw errors.notFound('Ticket');
  const { fields: raw, file } = await readUpload(ctx.req);
  const f = parseInput(fields, raw);
  return staffReply(adminCtx(ctx), ctx.params.ticketId, { body: f.body, internal: f.internal === 'true' }, file);
});
