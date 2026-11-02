/**
 * The player's own sessions ("devices") and sign-in history. A remembered
 * session is shown as a remembered device; signing a device out revokes its
 * session at once. Only the owner can see or revoke their sessions.
 */
import { and, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { getDb } from '../db/client';
import { auditLogs, sessions } from '../db/schema';
import { errors } from '../errors';

/** A short, non-identifying device description from a user-agent string. */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${browser} on ${os}`;
}

export async function listDevices(userId: string, currentSessionId: string, now = new Date()) {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(50);
  return rows.map((s) => ({
    id: s.id,
    device: describeAgent(s.userAgent),
    current: s.id === currentSessionId,
    remembered: s.remember,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  }));
}

export async function signOutDevice(userId: string, sessionId: string, meta: { ipHash: string | null }) {
  const res = await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (!res.length) throw errors.notFound('Session');
  await audit(getDb(), { actorId: userId, actorType: 'USER', action: 'auth.session_revoked', resourceType: 'session', resourceId: sessionId, ipHash: meta.ipHash });
  return { revoked: 1 };
}

export async function signOutOtherDevices(userId: string, currentSessionId: string, meta: { ipHash: string | null }) {
  const res = await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, currentSessionId)))
    .returning({ id: sessions.id });
  await audit(getDb(), { actorId: userId, actorType: 'USER', action: 'auth.other_sessions_revoked', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, metadata: { count: res.length } });
  return { revoked: res.length };
}

const SIGN_IN_EVENTS = ['auth.login', 'auth.login_failed', 'auth.account_locked', 'auth.mfa_failed', 'auth.logout', 'auth.session_revoked', 'auth.other_sessions_revoked'];

/** The account's own sign-in events, newest first (no addresses are shown: they are stored only as keyed hashes). */
export async function signInHistory(userId: string, limit = 50) {
  const rows = await getDb()
    .select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.createdAt, metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, userId), inArray(auditLogs.action, SIGN_IN_EVENTS)))
    .orderBy(desc(auditLogs.id))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({ id: r.id, action: r.action, at: r.at.toISOString(), mfa: Boolean((r.metadata as { mfa?: string } | null)?.mfa) }));
}
