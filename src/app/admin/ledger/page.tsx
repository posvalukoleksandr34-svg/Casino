import Link from 'next/link';
import { TX_LABELS } from '@/components/account/labels';
import { CursorPagination, FilterBar, FilterField, filterInputClass, type Params } from '@/components/admin/list-controls';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { dateRange, resolvePeriod } from '@/server/admin/period';
import { LEDGER_TYPES, ledgerTotals, listLedger, systemBalances } from '@/server/admin/wallet';
import { requirePermission } from '@/server/auth/current';
import type { LedgerTxType } from '@/server/db/schema';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Virtual ledger' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utc(d: Date) {
  return `${d.toISOString().slice(0, 19).replace('T', ' ')}`;
}

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission('ledger:read');
  const sp = await searchParams;
  const type = LEDGER_TYPES.includes(sp.type as LedgerTxType) ? (sp.type as LedgerTxType) : undefined;
  const userId = sp.userId && UUID.test(sp.userId) ? sp.userId : undefined;
  const transactionId = sp.tx && /^\d{1,15}$/.test(sp.tx) ? Number(sp.tx) : undefined;
  const before = sp.before && /^\d{1,15}$/.test(sp.before) ? Number(sp.before) : undefined;
  let problem: string | null = null;
  let range: { from?: Date; to?: Date } = {};
  try {
    range = dateRange({ from: sp.from, to: sp.to });
  } catch (err) {
    problem = err instanceof AppError ? err.message : 'Invalid date range';
  }
  // Totals follow the date filter; without one, the last 30 days.
  const totalsRange = range.from || range.to ? range : resolvePeriod({ period: '30d' });
  const totalsLabel = range.from || range.to ? `${sp.from ?? 'start'} – ${sp.to ?? 'now'} (UTC)` : 'last 30 days';
  const [list, totals, accounts] = await Promise.all([
    listLedger({ type, userId, transactionId, ...range, before, limit: 50 }),
    ledgerTotals(totalsRange),
    systemBalances(),
  ]);
  const params: Params = { type, userId, tx: sp.tx, from: sp.from, to: sp.to };
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Virtual ledger"
        subtitle="Every chip movement is a balanced, append-only ledger transaction. This view is read-only: grants and corrections are made from a player's page and are posted as new transactions."
        actions={
          <Link href="/admin/reconciliation" className="text-sm text-gold-400">
            Reconciliation →
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Totals by type" subtitle={`Chips credited to and debited from player wallets · ${totalsLabel} · all players`} />
          <CardBody>
            {totals.length === 0 ? (
              <EmptyState title="No transactions in this period" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th className="text-right">Transactions</Th>
                    <Th className="text-right">To wallets</Th>
                    <Th className="text-right">From wallets</Th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((r) => (
                    <Tr key={r.type}>
                      <Td>
                        <Link href={`/admin/ledger?type=${r.type}`} className="hover:text-gold-300">
                          {TX_LABELS[r.type] ?? r.type}
                        </Link>
                      </Td>
                      <Td className="num text-right">{r.count.toLocaleString()}</Td>
                      <Td className="text-right">
                        <Chips amount={r.walletIn} compact suffix={false} />
                      </Td>
                      <Td className="text-right">
                        <Chips amount={r.walletOut} compact suffix={false} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="System accounts" subtitle="Current balances (virtual)" />
          <CardBody>
            <ul className="divide-y divide-ink-800 text-sm">
              {accounts.map((a) => (
                <li key={a.code} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink-300">{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <Chips amount={a.balance} compact />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Transactions" subtitle="Newest first" />
        <CardBody>
          <FilterBar action="/admin/ledger" resetHref="/admin/ledger">
            <FilterField label="Type" htmlFor="ledger-type">
              <select id="ledger-type" name="type" defaultValue={type ?? ''} className={filterInputClass}>
                <option value="">Any</option>
                {LEDGER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TX_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Player id" htmlFor="ledger-user">
              <input id="ledger-user" name="userId" defaultValue={sp.userId ?? ''} placeholder="UUID" className={`${filterInputClass} w-72`} />
            </FilterField>
            <FilterField label="Transaction #" htmlFor="ledger-tx">
              <input id="ledger-tx" name="tx" inputMode="numeric" defaultValue={sp.tx ?? ''} className={`${filterInputClass} w-32`} />
            </FilterField>
            <FilterField label="From (UTC)" htmlFor="ledger-from">
              <input id="ledger-from" name="from" type="date" defaultValue={sp.from ?? ''} className={filterInputClass} />
            </FilterField>
            <FilterField label="To (UTC)" htmlFor="ledger-to">
              <input id="ledger-to" name="to" type="date" defaultValue={sp.to ?? ''} className={filterInputClass} />
            </FilterField>
          </FilterBar>
          {(problem || (sp.userId && !userId)) && (
            <Callout tone="warning" className="mb-4">
              {problem ?? 'The player id is not a valid UUID and was ignored.'}
            </Callout>
          )}
          {list.rows.length === 0 ? (
            <EmptyState title="No transactions match these filters" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Time (UTC)</Th>
                  <Th>Type</Th>
                  <Th>Player</Th>
                  <Th>Description</Th>
                  <Th className="text-right">Wallet</Th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="num text-xs">
                      <Link href={`/admin/ledger/${r.id}`} className="text-gold-300 hover:text-gold-200">
                        {r.id}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-400">{utc(r.createdAt)}</Td>
                    <Td className="whitespace-nowrap">{TX_LABELS[r.type] ?? r.type}</Td>
                    <Td className="max-w-36 truncate text-ink-300">
                      {r.userId ? (
                        <Link href={`/admin/users/${r.userId}`} className="hover:text-gold-300">
                          {r.username}
                        </Link>
                      ) : (
                        <span className="text-ink-400">system</span>
                      )}
                    </Td>
                    <Td className="max-w-72 truncate text-xs text-ink-400">{r.description}</Td>
                    <Td className="text-right">{r.walletDelta === null ? <span className="text-ink-400">—</span> : <Chips amount={r.walletDelta} sign colored suffix={false} />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <CursorPagination basePath="/admin/ledger" params={params} nextBefore={list.nextBefore} isFirstPage={!before} />
        </CardBody>
      </Card>
    </>
  );
}
