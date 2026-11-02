import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddRiskFlag, KycDecision, ResolveRiskFlag } from '@/components/admin/compliance-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { kycCase } from '@/server/kyc/kyc';

export const metadata = { title: 'Verification case' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function KycCasePage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requirePermission('kyc:review');
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const c = await kycCase(userId).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const own = userId === session.userId;
  const pending = c.user.status === 'PENDING' || c.user.status === 'UNDER_REVIEW';
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/kyc" className="hover:text-gold-300">Verification</Link>}
        title={c.user.username}
        subtitle={`Status: ${c.user.status.toLowerCase().replace('_', ' ')}`}
        actions={<Link href={`/admin/users/${userId}`} className="text-sm text-gold-400 hover:text-gold-300">Player record →</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Profile on file" subtitle="Compare every document against these details." />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Name', [c.user.firstName, c.user.lastName].filter(Boolean).join(' ') || '—'],
                  ['Date of birth', c.user.dateOfBirth ?? '—'],
                  ['Country', c.user.countryCode ?? '—'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-white/[0.06] pb-1.5">
                  <dt className="text-ink-400">{k}</dt>
                  <dd className="text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5">
              {own ? (
                <p className="text-sm text-ink-400">You cannot review your own verification.</p>
              ) : pending ? (
                <KycDecision userId={userId} />
              ) : (
                <p className="text-sm text-ink-400">No submission is waiting for a decision.</p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documents" subtitle="Downloads are attachments (never shown inline) and are audited." />
          <CardBody>
            {c.documents.length === 0 ? (
              <EmptyState title="No documents" />
            ) : (
              <ul className="divide-y divide-white/[0.06] text-sm">
                {c.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span>
                      <span className="block text-ink-100">{d.kindLabel}</span>
                      <a href={`/api/kyc/documents/${d.id}`} className="text-xs text-gold-300 hover:text-gold-200">
                        {d.fileName} · {(d.sizeBytes / 1024).toFixed(0)} KB
                      </a>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-ink-400">{new Date(d.uploadedAt).toLocaleString()}</span>
                      <Badge tone={d.status === 'ACCEPTED' ? 'positive' : d.status === 'REJECTED' ? 'negative' : 'info'}>{d.status.toLowerCase()}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Risk flags" subtitle="While a flag is open, every withdrawal of this account goes to manual review." />
          <CardBody className="space-y-4">
            {c.flags.length > 0 && (
              <ul className="divide-y divide-white/[0.06] text-sm">
                {c.flags.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <span>
                      <span className="flex items-center gap-2">
                        <span className="text-ink-100">{f.kind.toLowerCase().replace(/_/g, ' ')}</span>
                        <Badge tone={f.severity === 'HIGH' ? 'negative' : f.severity === 'MEDIUM' ? 'warning' : 'neutral'}>{f.severity.toLowerCase()}</Badge>
                        {f.resolvedAt && <Badge tone="positive">resolved</Badge>}
                      </span>
                      <span className="block text-xs text-ink-400">{f.note}</span>
                      {f.resolution && <span className="block text-xs text-ink-400">Resolution: {f.resolution}</span>}
                    </span>
                    {!f.resolvedAt && !own && <ResolveRiskFlag flagId={f.id} />}
                  </li>
                ))}
              </ul>
            )}
            {!own && <AddRiskFlag userId={userId} />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {c.reviews.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-200">
                    {r.decision.toLowerCase()} {r.note && <span className="text-ink-400">— {r.note}</span>}
                  </span>
                  <span className="text-xs text-ink-400">{new Date(r.at).toLocaleString()}</span>
                </li>
              ))}
              {c.reviews.length === 0 && <li className="text-ink-400">Nothing yet.</li>}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
