import type { ReactNode } from 'react';
import { AdminNav, type NavItem } from '@/components/admin/admin-nav';
import { Badge } from '@/components/ui/badge';
import { hasPermission, type Permission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: { default: 'Admin', template: '%s · Admin · Aurovane' }, robots: { index: false } };

const NAV: (NavItem & { permission: Permission })[] = [
  { href: '/admin', label: 'Overview', permission: 'admin:access' },
  { href: '/admin/analytics', label: 'Analytics', permission: 'analytics:read' },
  { href: '/admin/users', label: 'Users', permission: 'users:read' },
  { href: '/admin/rounds', label: 'Rounds', permission: 'rounds:read' },
  { href: '/admin/sports', label: 'Sports', permission: 'admin:access' },
  { href: '/admin/games', label: 'Games & config', permission: 'admin:access' },
  { href: '/admin/risk', label: 'Risk & platform', permission: 'admin:access' },
  { href: '/admin/alerts', label: 'Alerts', permission: 'system:read' },
  { href: '/admin/reconciliation', label: 'Reconciliation', permission: 'system:read' },
  { href: '/admin/audit', label: 'Audit log', permission: 'audit:read' },
  { href: '/admin/health', label: 'System health', permission: 'system:read' },
];

/** The admin area answers 404 to anyone without staff permissions. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requirePermission('admin:access');
  const items = NAV.filter((n) => hasPermission(session.role, n.permission));
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-4 hidden lg:block">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-500">Back office</div>
          <div className="mt-2">
            <Badge tone="gold">{session.role.replace('_', ' ').toLowerCase()}</Badge>
          </div>
        </div>
        <AdminNav items={items} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
