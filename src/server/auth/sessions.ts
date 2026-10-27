/**
 * Opaque server-side sessions. The browser holds a random 256-bit token in an
 * HttpOnly, SameSite=Lax cookie (Secure + __Host- prefix in production); the
 * database stores only its SHA-256, so a database leak does not leak usable
 * session tokens. Sessions expire after an idle period and an absolute
 * lifetime, and are revoked on logout, password change and account deletion.
 */
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../crypto';
import { getDb, type Executor } from '../db/client';
import { sessions, users, type UserRole, type UserStatus } from '../db/schema';
import { env } from '../env';

export const SESSION_COOKIE_DEV = 'aurovane_session';
export const SESSION_COOKIE_SECURE = '__Host-aurovane_session';

export function sessionCookieName(): string {
  return env().APP_URL.startsWith('https://') ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
}

export function sessionCookieOptions(expires: Date) {
  const secure = env().APP_URL.startsWith('https://');
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', expires };
}

export interface SessionUser {
  sessionId: string;
  sessionCreatedAt: Date;
  userId: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  preferences: Record<string, unknown>;
  displayName: string | null;
  avatar: string | null;
  /** When this session passed TOTP MFA (null: not verified this session). */
  mfaVerifiedAt: Date | null;
  /**
   * True while a newly registered player still has to complete the profile
   * step: the request handler and page guards then allow only the onboarding
   * flow and essential account endpoints.
   */
  onboardingPending: boolean;
}

export async function createSession(db: Executor, userId: string, meta: { userAgent?: string | null; ipHash?: string | null; mfaVerifiedAt?: Date | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env().SESSION_ABSOLUTE_HOURS * 3600_000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ipHash: meta.ipHash ?? null,
      mfaVerifiedAt: meta.mfaVerifiedAt ?? null,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row!.id, expiresAt };
}

/** Resolves a session token to an active user, enforcing idle and absolute expiry. */
export async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      status: users.status,
      preferences: users.preferences,
      displayName: users.displayName,
      avatar: users.avatar,
      mfaVerifiedAt: sessions.mfaVerifiedAt,
      emailVerifiedAt: users.emailVerifiedAt,
      onboardingRequired: users.onboardingRequired,
      onboardingCompletedAt: users.onboardingCompletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  if (!row) return null;
  // Sessions are only issued after verification; refuse any other defensively.
  if (row.status !== 'ACTIVE' || !row.emailVerifiedAt) return null;
  const idleMs = env().SESSION_IDLE_MINUTES * 60_000;
  if (now.getTime() - row.lastSeenAt.getTime() > idleMs) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    sessionCreatedAt: row.createdAt,
    userId: row.userId,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    preferences: row.preferences,
    displayName: row.displayName,
    avatar: row.avatar,
    mfaVerifiedAt: row.mfaVerifiedAt,
    onboardingPending: row.onboardingRequired && row.onboardingCompletedAt === null,
  };
}

export async function revokeSession(db: Executor, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Revokes every live session of a user (optionally keeping one); returns how many were revoked. */
export async function revokeAllSessions(db: Executor, userId: string, exceptSessionId?: string): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return revoked.length;
}
