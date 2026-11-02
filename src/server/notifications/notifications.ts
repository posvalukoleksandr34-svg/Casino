/**
 * Player notifications. Written inside the transaction that caused them (so a
 * notification never exists for something that rolled back); e-mail copies go
 * through an outbox the `notification-mail` job sends after commit.
 *
 * Preferences (users.preferences.notifications): per kind, `email` on/off.
 * Security, verification and system notices are always shown in-app. No
 * notification ever contains a password, token or code.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Executor } from '../db/client';
import { notifications, users, type NotificationKind } from '../db/schema';
import { getMailer } from '../mail/mailer';
import { env, mailboxAddress } from '../env';

export const NOTIFICATION_KINDS: NotificationKind[] = ['deposit', 'withdrawal', 'bonus', 'vip', 'security', 'verification', 'support', 'system'];
/** Kinds whose e-mail copy is on unless the player turns it off. */
const EMAIL_DEFAULT_ON = new Set<NotificationKind>(['withdrawal', 'security', 'verification']);

export const notificationPrefsSchema = z
  .object(Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, z.object({ email: z.boolean() }).strict().optional()])) as Record<NotificationKind, z.ZodOptional<z.ZodObject<{ email: z.ZodBoolean }>>>)
  .strict();

export function emailWanted(prefs: Record<string, unknown> | null | undefined, kind: NotificationKind): boolean {
  const n = (prefs?.notifications ?? {}) as Record<string, { email?: boolean } | undefined>;
  return n[kind]?.email ?? EMAIL_DEFAULT_ON.has(kind);
}

export async function notify(db: Executor, userId: string, n: { kind: NotificationKind; title: string; body: string; link?: string }) {
  const [u] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  await db.insert(notifications).values({
    userId,
    kind: n.kind,
    title: n.title.slice(0, 120),
    body: n.body.slice(0, 600),
    link: n.link ?? null,
    emailStatus: emailWanted(u?.preferences, n.kind) && env().MAIL_TRANSPORT !== 'disabled' ? 'PENDING' : 'SKIPPED',
  });
}

export async function listNotifications(userId: string, opts: { before?: number; limit?: number; unreadOnly?: boolean } = {}) {
  const rows = await getDb()
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), opts.before ? lt(notifications.id, opts.before) : undefined, opts.unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.id))
    .limit(Math.min(opts.limit ?? 30, 100));
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: r.readAt !== null, createdAt: r.createdAt.toISOString() }));
}

export async function unreadCount(userId: string): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

/** Marks the player's own notifications read (all, or the given ids). */
export async function markRead(userId: string, ids: number[] | 'all') {
  const where = ids === 'all' ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : and(eq(notifications.userId, userId), isNull(notifications.readAt), inArray(notifications.id, ids));
  const res = await getDb().update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
  return res.length;
}

/** Sends pending e-mail copies (scheduler). Plain text only, with a link to the account. */
export async function sendNotificationEmails(limit = 50): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: notifications, email: users.email })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.emailStatus, 'PENDING'))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  let sent = 0;
  for (const { n, email } of rows) {
    const to = mailboxAddress(email);
    let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
    if (to) {
      try {
        await getMailer().send({ to, subject: `Aurovane: ${n.title}`, text: `${n.body}\n\n${env().APP_URL.replace(/\/$/, '')}${n.link ?? '/notifications'}\n\nYou can change which notices are e-mailed under Settings → Notifications.` });
        status = 'SENT';
        sent += 1;
      } catch {
        status = 'FAILED';
      }
    }
    await db.update(notifications).set({ emailStatus: status }).where(eq(notifications.id, n.id));
  }
  return sent;
}
