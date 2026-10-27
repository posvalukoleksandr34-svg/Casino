import Link from 'next/link';
import { FilterBar, FilterField, filterInputClass, Pagination, SortTh, type Params } from '@/components/admin/list-controls';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { dateRange } from '@/server/admin/period';
import { listUsers, USER_SORTS, type UserSort } from '@/server/admin/users';
import { requirePermission } from '@/server/auth/current';
import { hasPermission, ROLE_LABELS, ROLES } from '@/server/auth/rbac';
import type { UserRole, UserStatus } from '@/server/db/schema';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Users' };

const STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'DELETED'];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requirePermission('users:read');
  const sp = await searchParams;
  const canSeePii = hasPermission(session.role, 'users:pii');
  const status = STATUSES.includes(sp.status as UserStatus) ? (sp.status as UserStatus) : undefined;
  const role = ROLES.includes(sp.role as UserRole) ? (sp.role as UserRole) : undefined;
  const sort = USER_SORTS.includes(sp.sort as UserSort) ? (sp.sort as UserSort) : undefined;
  let filterError: string | null = null;
  let range: { from?: Date; to?: Date } = {};
  try {
    range = dateRange({ from: sp.from, to: sp.to });
  } catch (err) {
    filterError = err instanceof AppError ? err.message : 'Invalid date range';
  }
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const res = await listUsers({ q: sp.q, status, role, ...range, sort, dir: sp.dir === 'asc' ? 'asc' : 'desc', page, pageSize: 25, canSeePii });
  const params: Params = { q: sp.q, status, role, from: sp.from, to: sp.to, sort, dir: sp.dir };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Users"
        subtitle={canSeePii ? 'Search by username, display name, e-mail or user id.' : 'Search by username, display name or user id. E-mail addresses are masked for your role.'}
      />
      <FilterBar action="/admin/users" keep={{ sort, dir: sp.dir }} resetHref="/admin/users">
        <FilterField label="Search" htmlFor="users-q">
          <input id="users-q" name="q" defaultValue={sp.q ?? ''} maxLength={100} placeholder={canSeePii ? 'Name, e-mail or id' : 'Name or id'} className={`${filterInputClass} w-64`} />
        </FilterField>
        <FilterField label="Status" htmlFor="users-status">
          <select id="users-status" name="status" defaultValue={status ?? ''} className={filterInputClass}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Role" htmlFor="users-role">
          <select id="users-role" name="role" defaultValue={role ?? ''} className={filterInputClass}>
            <option value="">Any</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Joined from (UTC)" htmlFor="users-from">
          <input id="users-from" name="from" type="date" defaultValue={sp.from ?? ''} className={filterInputClass} />
        </FilterField>
        <FilterField label="Joined to (UTC)" htmlFor="users-to">
          <input id="users-to" name="to" type="date" defaultValue={sp.to ?? ''} className={filterInputClass} />
        </FilterField>
      </FilterBar>
      {filterError && (
        <Callout tone="warning" className="mb-4">
          {filterError} The date filter was ignored.
        </Callout>
      )}
      <Card>
        <CardBody>
          {res.rows.length === 0 ? (
            <EmptyState title="No users match these filters" action={<Link href="/admin/users" className="text-sm text-gold-400">Clear filters</Link>} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <SortTh label="User" sortKey="username" basePath="/admin/users" params={params} defaultDir="asc" />
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <SortTh label="Balance" sortKey="balance" basePath="/admin/users" params={params} className="text-right" />
                  <SortTh label="Joined" sortKey="created" basePath="/admin/users" params={params} />
                  <SortTh label="Last sign-in" sortKey="last_login" basePath="/admin/users" params={params} />
                </tr>
              </thead>
              <tbody>
                {res.rows.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-ink-100 hover:text-gold-300">
                        {u.displayName ?? u.username}
                      </Link>
                      <div className="text-xs text-ink-400">
                        {u.displayName ? `${u.username} · ` : ''}
                        {u.email}
                      </div>
                    </Td>
                    <Td>{u.role === 'PLAYER' ? <span className="text-xs text-ink-400">Player</span> : <Badge tone="gold">{ROLE_LABELS[u.role]}</Badge>}</Td>
                    <Td>
                      <StatusBadge status={u.status} />
                    </Td>
                    <Td className="text-right">
                      <Chips amount={u.balance ?? 0} suffix={false} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-400">{u.createdAt.toISOString().slice(0, 10)}</Td>
                    <Td className="whitespace-nowrap text-ink-400">{u.lastLoginAt ? `${u.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={res.page} pageSize={res.pageSize} total={res.total} basePath="/admin/users" params={params} />
        </CardBody>
      </Card>
    </>
  );
}
