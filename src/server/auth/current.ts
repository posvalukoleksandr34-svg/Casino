import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { hasPermission, type Permission } from './rbac';
import { resolveSession, sessionCookieName, type SessionUser } from './sessions';

/** Session for the current request (memoised per request). */
export const currentSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return resolveSession(store.get(sessionCookieName())?.value);
});

export async function requireUser(nextPath: string): Promise<SessionUser> {
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return session;
}

/**
 * Staff-only pages respond 404 to everyone without the permission, so the
 * admin area is not discoverable by players.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = await currentSession();
  if (!session || !hasPermission(session.role, permission)) notFound();
  return session;
}
