/**
 * Support tickets. A player opens a ticket (category, subject, message, an
 * optional attachment) and replies in its thread; support agents
 * (support:manage) answer, add internal notes the player never sees, assign
 * and change the status. Messages and attachments are append-only.
 *
 * Notifications about a reply say only that there is one, with the ticket's
 * subject: the message itself is read on the site, so nothing sensitive is
 * ever copied into an e-mail.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { audit, recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Tx } from '../db/client';
import { supportAttachments, supportMessages, supportTickets, users, type TicketCategory, type TicketStatus } from '../db/schema';
import { errors } from '../errors';
import { notify } from '../notifications/notifications';
import { checkUpload, putPrivateFile, readPrivateFile, type CheckedUpload } from '../storage/private-files';
import { tierFor } from '../vip/vip';

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  ACCOUNT: 'Account and sign-in',
  PAYMENTS: 'Deposits and withdrawals',
  VERIFICATION: 'Identity verification',
  BONUSES: 'Bonuses and promotions',
  GAMES: 'Games and results',
  RESPONSIBLE_PLAY: 'Responsible play',
  OTHER: 'Something else',
};
const MAX_OPEN_TICKETS = 5;

type TicketRow = typeof supportTickets.$inferSelect;

function ticketView(t: TicketRow) {
  return {
    id: t.id,
    category: t.category,
    categoryLabel: CATEGORY_LABELS[t.category],
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
  };
}

async function storeAttachment(file: { name: string; bytes: Buffer } | null): Promise<(CheckedUpload & { storageKey: string }) | null> {
  if (!file) return null;
  const checked = checkUpload(file.bytes, file.name);
  return { ...checked, storageKey: await putPrivateFile('support', checked.bytes) };
}

async function addMessage(tx: Tx, ticketId: string, authorId: string, fromStaff: boolean, internal: boolean, body: string, file: (CheckedUpload & { storageKey: string }) | null) {
  const [m] = await tx.insert(supportMessages).values({ ticketId, authorId, fromStaff, internal, body }).returning();
  if (file) {
    await tx.insert(supportAttachments).values({ ticketId, messageId: m!.id, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, sha256: file.sha256, storageKey: file.storageKey });
  }
  return m!;
}

function cleanBody(body: string): string {
  const b = body.replace(/\r\n/g, '\n').trim();
  if (b.length < 1) throw errors.validation('Write a message.');
  if (b.length > 5000) throw errors.validation('Messages can be at most 5,000 characters.');
  return b;
}

export async function createTicket(userId: string, input: { category: TicketCategory; subject: string; body: string }, file: { name: string; bytes: Buffer } | null) {
  if (!(input.category in CATEGORY_LABELS)) throw errors.validation('Choose a category.');
  const subject = input.subject.trim();
  if (subject.length < 3 || subject.length > 120) throw errors.validation('The subject must be 3–120 characters.');
  const body = cleanBody(input.body);
  const db = getDb();
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(and(eq(supportTickets.userId, userId), inArray(supportTickets.status, ['OPEN', 'AWAITING_PLAYER'])));
  if ((open?.n ?? 0) >= MAX_OPEN_TICKETS) throw errors.conflict(`You have ${MAX_OPEN_TICKETS} open tickets. Please continue in one of them.`);
  const [u] = await db.select({ vipLevel: users.vipLevel }).from(users).where(eq(users.id, userId));
  const priority = (await tierFor(db, u?.vipLevel ?? 1))?.prioritySupport ? 'HIGH' : 'NORMAL';
  const stored = await storeAttachment(file);
  return withTransaction(async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ userId, category: input.category, subject, priority }).returning();
    await addMessage(tx, t!.id, userId, false, false, body, stored);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'support.ticket_created', resourceType: 'support_ticket', resourceId: t!.id, after: { category: input.category, attachment: Boolean(stored) } });
    return ticketView(t!);
  });
}

export async function listTickets(userId: string) {
  const rows = await getDb().select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.updatedAt)).limit(100);
  return rows.map(ticketView);
}

async function thread(ticketId: string, includeInternal: boolean) {
  const db = getDb();
  const messages = await db
    .select({ m: supportMessages, author: users.username, displayName: users.displayName })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorId))
    .where(and(eq(supportMessages.ticketId, ticketId), includeInternal ? undefined : eq(supportMessages.internal, false)))
    .orderBy(asc(supportMessages.id));
  const files = await db.select().from(supportAttachments).where(eq(supportAttachments.ticketId, ticketId));
  return messages.map(({ m, author, displayName }) => ({
    id: m.id,
    // Players see "Support" for staff, never an agent's account name.
    author: m.fromStaff ? (includeInternal ? (displayName ?? author) : 'Aurovane support') : includeInternal ? author : 'You',
    fromStaff: m.fromStaff,
    internal: m.internal,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    attachments: files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes })),
  }));
}

export async function getTicket(userId: string, ticketId: string) {
  const [t] = await getDb().select().from(supportTickets).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)));
  if (!t) throw errors.notFound('Ticket');
  return { ticket: ticketView(t), messages: await thread(t.id, false) };
}

export async function playerReply(userId: string, ticketId: string, body: string, file: { name: string; bytes: Buffer } | null, now = new Date()) {
  const text = cleanBody(body);
  const [t] = await getDb().select().from(supportTickets).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)));
  if (!t) throw errors.notFound('Ticket');
  if (t.status === 'CLOSED') throw errors.conflict('This ticket is closed. Please open a new one.');
  const stored = await storeAttachment(file);
  return withTransaction(async (tx) => {
    await addMessage(tx, t.id, userId, false, false, text, stored);
    const [u] = await tx.update(supportTickets).set({ status: 'OPEN', updatedAt: now }).where(eq(supportTickets.id, t.id)).returning();
    return ticketView(u!);
  });
}

export async function closeTicket(userId: string, ticketId: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId))).for('update');
    if (!t) throw errors.notFound('Ticket');
    if (t.status === 'CLOSED') return ticketView(t);
    const [u] = await tx.update(supportTickets).set({ status: 'CLOSED', closedAt: now, updatedAt: now }).where(eq(supportTickets.id, t.id)).returning();
    return ticketView(u!);
  });
}

/** An attachment for the ticket's owner (public messages only) or for support staff. */
export async function attachmentFile(viewer: { userId: string; isSupport: boolean }, attachmentId: string) {
  const [row] = await getDb()
    .select({ a: supportAttachments, ownerId: supportTickets.userId, internal: supportMessages.internal })
    .from(supportAttachments)
    .innerJoin(supportTickets, eq(supportTickets.id, supportAttachments.ticketId))
    .innerJoin(supportMessages, eq(supportMessages.id, supportAttachments.messageId))
    .where(eq(supportAttachments.id, attachmentId));
  if (!row) throw errors.notFound('Attachment');
  const allowed = viewer.isSupport || (row.ownerId === viewer.userId && !row.internal);
  if (!allowed) throw errors.notFound('Attachment');
  return { bytes: await readPrivateFile(row.a.storageKey), contentType: row.a.contentType, fileName: row.a.fileName };
}

// ---------------------------------------------------------------------------
// Support staff
// ---------------------------------------------------------------------------

export async function supportQueue(view: 'open' | 'all' = 'open') {
  const rows = await getDb()
    .select({ t: supportTickets, username: users.username })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(view === 'open' ? inArray(supportTickets.status, ['OPEN', 'AWAITING_PLAYER']) : undefined)
    .orderBy(desc(sql`${supportTickets.priority} = 'HIGH'`), view === 'open' ? asc(supportTickets.updatedAt) : desc(supportTickets.updatedAt))
    .limit(200);
  return rows.map((r) => ({ ...ticketView(r.t), userId: r.t.userId, username: r.username, assignedTo: r.t.assignedTo }));
}

export async function staffTicket(ticketId: string) {
  const [r] = await getDb().select({ t: supportTickets, username: users.username, email: users.email }).from(supportTickets).innerJoin(users, eq(users.id, supportTickets.userId)).where(eq(supportTickets.id, ticketId));
  if (!r) throw errors.notFound('Ticket');
  return { ticket: { ...ticketView(r.t), userId: r.t.userId, username: r.username, assignedTo: r.t.assignedTo }, messages: await thread(ticketId, true) };
}

export async function staffReply(ctx: AdminCtx, ticketId: string, input: { body: string; internal: boolean }, file: { name: string; bytes: Buffer } | null, now = new Date()) {
  const text = cleanBody(input.body);
  const [t] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!t) throw errors.notFound('Ticket');
  if (t.userId === ctx.adminId) throw errors.forbidden('You cannot answer your own ticket as staff.');
  if (t.status === 'CLOSED') throw errors.conflict('This ticket is closed.');
  const stored = await storeAttachment(file);
  return withTransaction(async (tx) => {
    await addMessage(tx, t.id, ctx.adminId, true, input.internal, text, stored);
    if (!input.internal) {
      await tx.update(supportTickets).set({ status: 'AWAITING_PLAYER', updatedAt: now, assignedTo: t.assignedTo ?? ctx.adminId }).where(eq(supportTickets.id, t.id));
      await notify(tx, t.userId, { kind: 'support', title: 'Support replied', body: `There is a new reply to your request "${t.subject}". Read it on the site.`, link: `/support/${t.id}` });
    }
    await recordAdminAction(tx, { ...ctx, action: input.internal ? 'support.internal_note' : 'support.replied', targetType: 'support_ticket', targetId: t.id, reason: input.internal ? 'Internal note' : 'Reply to player' });
    return { ok: true };
  });
}

export async function setTicketStatus(ctx: AdminCtx, ticketId: string, status: Exclude<TicketStatus, 'OPEN'> | 'OPEN', reason: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update');
    if (!t) throw errors.notFound('Ticket');
    if (t.status === 'CLOSED') throw errors.conflict('A closed ticket cannot be changed.');
    await tx.update(supportTickets).set({ status, updatedAt: now, closedAt: status === 'CLOSED' ? now : null }).where(eq(supportTickets.id, t.id));
    if (status === 'RESOLVED') await notify(tx, t.userId, { kind: 'support', title: 'Request resolved', body: `We have marked "${t.subject}" as resolved. Reply on the site if anything is still open.`, link: `/support/${t.id}` });
    await recordAdminAction(tx, { ...ctx, action: 'support.status_changed', targetType: 'support_ticket', targetId: t.id, reason, before: { status: t.status }, after: { status } });
    return { ok: true };
  });
}

export async function assignTicket(ctx: AdminCtx, ticketId: string) {
  return withTransaction(async (tx) => {
    const [t] = await tx.update(supportTickets).set({ assignedTo: ctx.adminId }).where(eq(supportTickets.id, ticketId)).returning();
    if (!t) throw errors.notFound('Ticket');
    await recordAdminAction(tx, { ...ctx, action: 'support.assigned', targetType: 'support_ticket', targetId: t.id, reason: 'Assigned to self' });
    return { ok: true };
  });
}
