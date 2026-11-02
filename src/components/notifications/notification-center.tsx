'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Callout } from '../ui/misc';
import { useToast } from '../ui/toast';

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus',
  vip: 'VIP',
  security: 'Security',
  verification: 'Verification',
  support: 'Support',
  system: 'Aurovane',
};

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function markAll() {
    setBusy(true);
    try {
      await api('/api/notifications/read', { method: 'POST', body: { all: true } });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function open(n: NotificationItem) {
    if (!n.read) await api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => undefined);
    if (n.link) router.push(n.link);
    else router.refresh();
  }
  if (items.length === 0) return <p className="py-6 text-center text-sm text-ink-400">No notifications yet.</p>;
  return (
    <div className="space-y-3">
      {items.some((n) => !n.read) && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={markAll} loading={busy} data-testid="mark-all-read">
            Mark all as read
          </Button>
        </div>
      )}
      <ul className="divide-y divide-white/[0.06]" data-testid="notification-list">
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)} className={cn('flex w-full items-start gap-3 py-3 text-left', !n.read && 'font-medium')}>
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-gold-400')} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-100">{n.title}</span>
                  <Badge>{KIND_LABELS[n.kind] ?? n.kind}</Badge>
                  {!n.read && <span className="sr-only">(unread)</span>}
                </span>
                <span className="mt-0.5 block text-sm font-normal text-ink-300">{n.body}</span>
                <span className="mt-0.5 block text-xs font-normal text-ink-400">{new Date(n.createdAt).toLocaleString()}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotificationPrefs({ prefs, emailAvailable }: { prefs: Record<string, { email: boolean }>; emailAvailable: boolean }) {
  const toast = useToast();
  const [state, setState] = useState(prefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(state).filter(([k]) => k !== 'security'));
      const res = await api<{ preferences: Record<string, { email: boolean }> }>('/api/notifications/preferences', { method: 'PUT', body });
      setState(res.preferences);
      toast.push({ tone: 'positive', title: 'Preferences saved' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4" data-testid="notification-prefs">
      {!emailAvailable && <Callout tone="neutral">E-mail delivery is not configured on this site, so notifications are shown here only.</Callout>}
      <ul className="space-y-2 text-sm">
        {Object.entries(state).map(([kind, v]) => (
          <li key={kind} className="flex items-center justify-between gap-3">
            <span className="text-ink-200">{KIND_LABELS[kind] ?? kind}</span>
            <label className="flex items-center gap-2 text-ink-300">
              <input
                type="checkbox"
                checked={v.email}
                disabled={kind === 'security'}
                onChange={(e) => setState((s) => ({ ...s, [kind]: { email: e.target.checked } }))}
                className="accent-[var(--color-gold-500)]"
              />
              E-mail copy{kind === 'security' ? ' (always on)' : ''}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-400">Every notification also appears on this page. E-mails never contain passwords, codes you did not ask for, or the content of support messages.</p>
      {error && <Callout tone="negative">{error}</Callout>}
      <Button variant="primary" onClick={save} loading={busy}>
        Save preferences
      </Button>
      <p className="text-xs text-ink-400">
        Looking for marketing settings? Aurovane does not send marketing e-mails. <Link href="/settings" className="text-gold-300">Settings</Link>
      </p>
    </div>
  );
}
