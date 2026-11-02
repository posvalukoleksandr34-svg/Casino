import { z } from 'zod';
import { addUserNote, listUserNotes } from '@/server/admin/notes';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

export const GET = route<'users:read', { userId: string }>({ name: 'admin.users.notes', auth: 'users:read', rateLimit: [RATE_LIMITS.adminUser] }, async ({ params }) => {
  if (!z.uuid().safeParse(params.userId).success) throw errors.notFound('User');
  return { notes: await listUserNotes(params.userId) };
});

const schema = z.object({ body: z.string().trim().min(3).max(2000) }).strict();

/** Adds an internal note (append-only, never shown to the player, audited). */
export const POST = route<'users:read', { userId: string }>({ name: 'admin.users.note_add', auth: 'users:read', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.userId).success) throw errors.notFound('User');
  const { body } = await readJson(ctx.req, schema);
  return addUserNote(adminCtx(ctx), ctx.params.userId, body);
});
