import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { markRead, unreadCount } from '@/server/notifications/notifications';

const schema = z.union([z.object({ ids: z.array(z.int().positive()).min(1).max(100) }).strict(), z.object({ all: z.literal(true) }).strict()]);

export const POST = route({ name: 'notifications.read', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ req, session }) => {
  const body = await readJson(req, schema);
  await markRead(session.userId, 'ids' in body ? body.ids : 'all');
  return { unread: await unreadCount(session.userId) };
});
