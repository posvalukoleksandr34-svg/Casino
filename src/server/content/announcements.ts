/**
 * Site announcements and homepage banners, edited in the back office
 * (content:manage) and shown on the home page and/or the lobby while active.
 * Text only: no HTML is stored or rendered; links are site-relative.
 */
import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction } from '../db/client';
import { siteAnnouncements } from '../db/schema';
import { errors } from '../errors';

export type Announcement = typeof siteAnnouncements.$inferSelect;

export async function activeAnnouncements(placement: 'HOME' | 'LOBBY', now = new Date()) {
  const rows = await getDb()
    .select()
    .from(siteAnnouncements)
    .where(
      and(
        eq(siteAnnouncements.active, true),
        lte(siteAnnouncements.startsAt, now),
        or(isNull(siteAnnouncements.endsAt), gt(siteAnnouncements.endsAt, now)),
        or(eq(siteAnnouncements.placement, placement), eq(siteAnnouncements.placement, 'ALL')),
      ),
    )
    .orderBy(asc(siteAnnouncements.sortOrder), desc(siteAnnouncements.id))
    .limit(5);
  return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, link: a.link, tone: a.tone }));
}

export async function listAnnouncements() {
  return getDb().select().from(siteAnnouncements).orderBy(desc(siteAnnouncements.id)).limit(200);
}

const fields = {
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(3).max(300),
  link: z
    .string()
    .regex(/^\/[A-Za-z0-9/_?=&#.-]*$/, 'Links must be site-relative, like /promotions')
    .nullable(),
  tone: z.enum(['info', 'promo', 'warning']),
  placement: z.enum(['HOME', 'LOBBY', 'ALL']),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  active: z.boolean(),
  sortOrder: z.int().min(0).max(1000),
};
export const announcementCreateSchema = z
  .object({ ...fields, link: fields.link.optional(), startsAt: fields.startsAt.optional(), endsAt: fields.endsAt.optional(), active: fields.active.optional(), sortOrder: fields.sortOrder.optional() })
  .strict();
export const announcementPatchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

function dates<T extends { startsAt?: string; endsAt?: string | null }>(p: T) {
  const out: Record<string, unknown> = { ...p };
  if (p.startsAt !== undefined) out.startsAt = new Date(p.startsAt);
  if (p.endsAt !== undefined) out.endsAt = p.endsAt === null ? null : new Date(p.endsAt);
  return out;
}

export async function createAnnouncement(ctx: AdminCtx, input: z.infer<typeof announcementCreateSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const [row] = await tx
      .insert(siteAnnouncements)
      .values({ ...(dates(input) as typeof siteAnnouncements.$inferInsert), createdBy: ctx.adminId })
      .returning();
    await recordAdminAction(tx, { ...ctx, action: 'content.announcement_created', targetType: 'announcement', targetId: String(row!.id), reason, after: input });
    return row!;
  });
}

export async function updateAnnouncement(ctx: AdminCtx, id: number, patch: z.infer<typeof announcementPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const [before] = await tx.select().from(siteAnnouncements).where(eq(siteAnnouncements.id, id)).for('update');
    if (!before) throw errors.notFound('Announcement');
    const next = { ...before, ...(dates(patch) as Partial<Announcement>) };
    if (next.endsAt && next.endsAt <= next.startsAt) throw errors.validation('The end must be after the start.');
    const [row] = await tx
      .update(siteAnnouncements)
      .set({ ...(dates(patch) as Partial<Announcement>), updatedAt: new Date() })
      .where(eq(siteAnnouncements.id, id))
      .returning();
    await recordAdminAction(tx, { ...ctx, action: 'content.announcement_updated', targetType: 'announcement', targetId: String(id), reason, before: { title: before.title, active: before.active }, after: patch });
    return row!;
  });
}
