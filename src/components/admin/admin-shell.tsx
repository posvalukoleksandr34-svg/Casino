'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from '../ui/badge';
import { AdminIcon, type AdminIconName } from './admin-icons';

export interface NavItem {
  href: string;
  label: string;
  icon: AdminIconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const COLLAPSE_KEY = 'aurovane.admin.sidebar';

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Back-office frame: grouped sidebar (collapsible on desktop, a drawer on
 * small screens) and a top bar with the signed-in staff member, open alerts
 * and the security status. Navigation is filtered on the server by
 * permission; every page and API re-checks its own permission regardless.
 */
export function AdminShell({
  groups,
  admin,
  openAlerts,
  mfa,
  children,
}: {
  groups: NavGroup[];
  admin: { name: string; roleLabel: string };
  openAlerts: number | null;
  mfa: { enabled: boolean; required: boolean };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Storage unavailable (private mode): keep the default.
    }
  }, []);
  useEffect(() => setDrawer(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // ignore
      }
      return !c;
    });
  };

  const nav = (compact: boolean) => (
    <nav aria-label="Back office" className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          {!compact && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-400">{g.label}</div>}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = isActive(pathname, i.href);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? 'page' : undefined}
                    title={compact ? i.label : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      compact && 'justify-center px-2',
                      active ? 'bg-ink-800 text-gold-200' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100',
                    )}
                  >
                    <AdminIcon name={i.icon} />
                    {compact ? <span className="sr-only">{i.label}</span> : <span className="truncate">{i.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={cn('grid grid-cols-1 gap-6 lg:gap-8', collapsed ? 'lg:grid-cols-[56px_minmax(0,1fr)]' : 'lg:grid-cols-[220px_minmax(0,1fr)]')}>
      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-400 hover:bg-ink-850 hover:text-ink-200', collapsed && 'justify-center px-2')}
          >
            <AdminIcon name={collapsed ? 'expand' : 'collapse'} />
            {!collapsed && <span>Collapse</span>}
          </button>
          {nav(collapsed)}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-ink-800 pb-4">
          <button
            type="button"
            onClick={() => setDrawer((d) => !d)}
            aria-expanded={drawer}
            aria-controls="admin-drawer"
            className="flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:border-gold-600 lg:hidden"
          >
            <AdminIcon name="menu" />
            Menu
          </button>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-500">Back office</div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            {openAlerts !== null && (
              <Link
                href="/admin/alerts"
                className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5', openAlerts > 0 ? 'border-warning/50 text-warning' : 'border-ink-700 text-ink-300 hover:border-ink-500')}
                aria-label={`${openAlerts} open alert${openAlerts === 1 ? '' : 's'}`}
              >
                <AdminIcon name="alerts" />
                <span className="num">{openAlerts}</span>
              </Link>
            )}
            <Link
              href="/admin/security"
              className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5', mfa.enabled ? 'border-ink-700 text-ink-300 hover:border-ink-500' : 'border-warning/50 text-warning')}
            >
              <AdminIcon name="security" />
              {mfa.enabled ? 'MFA on' : mfa.required ? 'MFA required' : 'MFA off'}
            </Link>
            <span className="flex items-center gap-2 rounded-lg border border-ink-700 px-2.5 py-1.5 text-ink-200">
              <span className="max-w-40 truncate">{admin.name}</span>
              <Badge tone="gold">{admin.roleLabel}</Badge>
            </span>
          </div>
        </div>
        {drawer && (
          <div id="admin-drawer" className="surface mb-6 p-4 lg:hidden">
            {nav(false)}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
