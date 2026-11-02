'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Unread notifications in the header. Refreshed on navigation and every minute while the tab is visible. */
export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ unread: number }>('/api/notifications?unread=1')
        .then((r) => alive && setUnread(r.unread))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);
  return (
    <Link
      href="/notifications"
      className="relative grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-ink-200 transition-colors hover:border-white/20 hover:text-ink-100"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      data-testid="notification-bell"
    >
      <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v3L4 13.5h12L14.5 11V8A4.5 4.5 0 0 0 10 3.5Zm-2 12a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className={cn('absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-ink-950')} data-testid="notification-count">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
