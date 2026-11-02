import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { announcementCreateSchema, createAnnouncement, listAnnouncements } from '@/server/content/announcements';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

export const GET = route({ name: 'admin.content.list', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ announcements: await listAnnouncements() }));

const schema = z.object({ announcement: announcementCreateSchema, reason: reasonSchema }).strict();

export const POST = route({ name: 'admin.content.create', auth: 'content:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return { announcement: await createAnnouncement(adminCtx(ctx), body.announcement, body.reason) };
});
