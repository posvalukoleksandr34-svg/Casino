import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { hasPermission, type Permission } from './rbac';
import { resolveSession, sessionCookieName, type SessionUser } from './sessions';
import { recordAccessDenied } from '../security/denied';
import { staffMfaBlocks } from './mfa';

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

/** One denied-access record per request, however many layouts and pages check. */
const deniedThisRequest = cache((_userId: string) => ({ recorded: false }));

/**
 * Staff-only pages respond 404 to everyone without the permission, so the
 * admin area is not discoverable by players. Refusals of signed-in accounts
 * are recorded as security events.
 */
export async function requirePermission(permission: Permission, opts: { allowWithoutMfa?: boolean } = {}): Promise<SessionUser> {
  const session = await currentSession();
  if (!session) notFound();
  if (hasPermission(session.role, permission) && !opts.allowWithoutMfa && (await staffMfaBlocks(session))) redirect('/admin/security');
  if (!hasPermission(session.role, permission)) {
    const state = deniedThisRequest(session.userId);
    if (!state.recorded) {
      state.recorded = true;
      await recordAccessDenied({ userId: session.userId, permission, target: `page:${permission}` });
    }
    notFound();
  }
  return session;
}
