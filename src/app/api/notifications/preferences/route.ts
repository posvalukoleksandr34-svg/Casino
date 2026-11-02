import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { notificationPrefs, notificationPrefsSchema, setNotificationPrefs } from '@/server/notifications/notifications';

export const GET = route({ name: 'notifications.prefs', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({ preferences: await notificationPrefs(session.userId) }));

/** E-mail copies per kind. In-app notifications are always kept; security e-mails cannot be switched off. */
export const PUT = route({ name: 'notifications.prefs_update', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ req, session }) => {
  const body = await readJson(req, notificationPrefsSchema);
  if (body.security && body.security.email === false) delete body.security;
  return { preferences: await setNotificationPrefs(session.userId, body) };
});
