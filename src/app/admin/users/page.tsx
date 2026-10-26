import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { Chips, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { listUsers } from '@/server/admin/admin-service';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Users' };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePermission('users:read');
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const users = await listUsers({ q: sp.q, limit: 50, offset: page * 50 });
  return (
    <>
      <PageHeader eyebrow="Admin" title="Users" subtitle="Search by e-mail, username or user id." />
      <form className="mb-4 flex gap-2" action="/admin/users">
        <Input name="q" defaultValue={sp.q ?? ''} placeholder="Search users…" aria-label="Search users" className="max-w-md" />
        <button className="h-11 rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">Search</button>
      </form>
      <Card>
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Balance</Th>
                <Th>Joined</Th>
                <Th>Last login</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <Link href={`/admin/users/${u.id}`} className="font-medium text-ink-100 hover:text-gold-300">
                      {u.username}
                    </Link>
                    <div className="text-xs text-ink-500">{u.email}</div>
                  </Td>
                  <Td className="text-xs">{u.role}</Td>
                  <Td>
                    <StatusBadge status={u.status} />
                  </Td>
                  <Td className="text-right"><Chips amount={u.balance ?? 0} suffix={false} /></Td>
                  <Td className="whitespace-nowrap text-ink-400">{u.createdAt.toLocaleDateString()}</Td>
                  <Td className="whitespace-nowrap text-ink-400">{u.lastLoginAt?.toLocaleString() ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex justify-between text-sm">
            {page > 0 ? <Link href={`/admin/users?page=${page - 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`} className="text-gold-400">← Previous</Link> : <span />}
            {users.length === 50 && <Link href={`/admin/users?page=${page + 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`} className="text-gold-400">Next →</Link>}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
