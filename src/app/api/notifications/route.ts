import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listNotifications, unreadCount } from '@/server/notifications/notifications';

const query = z.object({ before: z.coerce.number().int().positive().optional(), unread: z.enum(['1']).optional() });

export const GET = route({ name: 'notifications.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ req, session }) => {
  const q = parseQuery(req, query);
  return { unread: await unreadCount(session.userId), notifications: await listNotifications(session.userId, { before: q.before, unreadOnly: q.unread === '1' }) };
});
