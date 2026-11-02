/** Internal staff notes on a player: append-only, never shown to the player, every note audited. */
import { desc, eq } from 'drizzle-orm';
import { recordAdminAction } from '../audit/audit';
import { getDb, withTransaction } from '../db/client';
import { userNotes, users } from '../db/schema';
import { errors } from '../errors';
import type { AdminCtx } from './admin-service';

export async function listUserNotes(userId: string) {
  const rows = await getDb()
    .select({ n: userNotes, author: users.username })
    .from(userNotes)
    .innerJoin(users, eq(users.id, userNotes.authorId))
    .where(eq(userNotes.userId, userId))
    .orderBy(desc(userNotes.id))
    .limit(100);
  return rows.map(({ n, author }) => ({ id: n.id, body: n.body, author, createdAt: n.createdAt.toISOString() }));
}

export async function addUserNote(ctx: AdminCtx, userId: string, body: string) {
  const text = body.trim();
  if (text.length < 3 || text.length > 2000) throw errors.validation('A note is 3–2,000 characters.');
  if (userId === ctx.adminId) throw errors.forbidden('You cannot add notes to your own account.');
  return withTransaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) throw errors.notFound('User');
    const [row] = await tx.insert(userNotes).values({ userId, authorId: ctx.adminId, body: text }).returning();
    await recordAdminAction(tx, { ...ctx, action: 'user.note_added', targetType: 'user', targetId: userId, reason: 'Internal note', after: { noteId: row!.id } });
    return { id: row!.id };
  });
}
