import { NotificationList, NotificationPrefs } from '@/components/notifications/notification-center';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { env } from '@/server/env';
import { listNotifications, notificationPrefs } from '@/server/notifications/notifications';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const session = await requireUser('/notifications');
  const [items, prefs] = await Promise.all([listNotifications(session.userId, { limit: 100 }), notificationPrefs(session.userId)]);
  return (
    <>
      <PageHeader eyebrow="Account" title="Notifications" subtitle="Deposits, withdrawals, bonuses, verification, support replies and security events." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Inbox" />
          <CardBody>
            <NotificationList items={items} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="E-mail copies" subtitle="Choose which notifications are also e-mailed to you." />
          <CardBody>
            <NotificationPrefs prefs={prefs} emailAvailable={env().MAIL_TRANSPORT !== 'disabled'} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
