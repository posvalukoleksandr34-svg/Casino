import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { announcementPatchSchema, updateAnnouncement } from '@/server/content/announcements';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ patch: announcementPatchSchema, reason: reasonSchema }).strict();

export const PATCH = route<'content:manage', { id: string }>({ name: 'admin.content.update', auth: 'content:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const id = z.coerce.number().int().positive().parse(ctx.params.id);
  const body = await readJson(ctx.req, schema);
  return { announcement: await updateAnnouncement(adminCtx(ctx), id, body.patch, body.reason) };
});
