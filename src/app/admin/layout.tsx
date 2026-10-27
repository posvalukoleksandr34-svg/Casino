import type { ReactNode } from 'react';
import { AdminShell, type NavGroup, type NavItem } from '@/components/admin/admin-shell';
import { hasPermission, ROLE_LABELS, type Permission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';
import { staffMfaState } from '@/server/auth/mfa';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';

export const metadata = { title: { default: 'Admin', template: '%s · Admin · Aurovane' }, robots: { index: false } };

const NAV: { label: string; items: (NavItem & { permission: Permission })[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: 'overview', permission: 'admin:access' },
      { href: '/admin/analytics', label: 'Game analytics', icon: 'analytics', permission: 'analytics:read' },
    ],
  },
  {
    label: 'Players',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'users', permission: 'users:read' },
      { href: '/admin/ledger', label: 'Virtual ledger', icon: 'ledger', permission: 'ledger:read' },
    ],
  },
  {
    label: 'Games',
    items: [
      { href: '/admin/games', label: 'Games', icon: 'games', permission: 'admin:access' },
      { href: '/admin/rounds', label: 'Rounds', icon: 'rounds', permission: 'rounds:read' },
      { href: '/admin/sports', label: 'Sports', icon: 'sports', permission: 'admin:access' },
    ],
  },
  {
    label: 'Risk & integrity',
    items: [
      { href: '/admin/risk', label: 'Risk & platform', icon: 'risk', permission: 'admin:access' },
      { href: '/admin/reconciliation', label: 'Reconciliation', icon: 'reconciliation', permission: 'system:read' },
      { href: '/admin/alerts', label: 'Alerts', icon: 'alerts', permission: 'system:read' },
    ],
  },
  {
    label: 'Security',
    items: [
      { href: '/admin/audit', label: 'Audit log', icon: 'audit', permission: 'audit:read' },
      { href: '/admin/health', label: 'System health', icon: 'health', permission: 'system:read' },
      { href: '/admin/security', label: 'Staff security', icon: 'security', permission: 'admin:access' },
    ],
  },
];

/**
 * The admin area answers 404 to anyone without staff permissions. The staff
 * MFA policy is enforced by each page (and every admin API), not here, so the
 * security page stays reachable for setting it up.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requirePermission('admin:access', { allowWithoutMfa: true });
  const groups: NavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => hasPermission(session.role, i.permission)).map(({ permission: _p, ...i }) => i),
  })).filter((g) => g.items.length > 0);
  const [alerts, mfa] = await Promise.all([
    hasPermission(session.role, 'system:read')
      ? getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM alerts WHERE acknowledged_at IS NULL`)
      : Promise.resolve(null),
    staffMfaState(session),
  ]);
  return (
    <AdminShell
      groups={groups}
      admin={{ name: session.displayName ?? session.username, roleLabel: ROLE_LABELS[session.role] }}
      openAlerts={alerts ? (alerts.rows[0]?.n ?? 0) : null}
      mfa={{ enabled: mfa.enabled, required: mfa.required }}
    >
      {children}
    </AdminShell>
  );
}
