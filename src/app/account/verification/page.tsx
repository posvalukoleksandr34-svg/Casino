import Link from 'next/link';
import { DocStatus, KycSubmit, KycUpload } from '@/components/account/kyc-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { kycOverview } from '@/server/kyc/kyc';

export const metadata = { title: 'Identity verification' };

const STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'positive' | 'negative' | 'warning'; text: string }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral', text: 'Upload the required documents, then submit them for review. You only need to do this once.' },
  PENDING: { label: 'Under review', tone: 'info', text: 'Your documents are with our compliance team. Your identity is not verified until they decide; you will be notified.' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info', text: 'Your documents are with our compliance team. Your identity is not verified until they decide; you will be notified.' },
  VERIFIED: { label: 'Verified', tone: 'positive', text: 'Your identity is verified. Nothing else is needed.' },
  REJECTED: { label: 'Not verified', tone: 'negative', text: 'We could not verify your identity from the documents you sent. Upload new ones and submit again.' },
};

export default async function VerificationPage() {
  const session = await requireUser('/account/verification');
  const o = await kycOverview(session.userId);
  const s = STATUS[o.status] ?? STATUS.NOT_STARTED!;
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Identity verification"
        subtitle="Needed once before your first withdrawal (anti-money-laundering rules). Documents are stored privately, seen only by you and our compliance team, and never shared publicly."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Status" />
          <CardBody className="space-y-4">
            <div className="flex items-center gap-3" data-testid="kyc-status" data-status={o.status}>
              <Badge tone={s.tone}>{s.label}</Badge>
              {o.updatedAt && <span className="text-xs text-ink-400">since {new Date(o.updatedAt).toLocaleString()}</span>}
            </div>
            <p className="text-sm text-ink-300">{s.text}</p>
            {o.lastDecision?.decision === 'REJECTED' && o.lastDecision.note && (
              <Callout tone="warning" title="Reviewer's note">
                {o.lastDecision.note}
              </Callout>
            )}
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-ink-300">Required</div>
              <ul className="space-y-1.5 text-sm">
                {o.required.map((r) => (
                  <li key={r.kind} className="flex items-center justify-between gap-3">
                    <span className="text-ink-200">{r.label}</span>
                    {r.provided ? <Badge tone="positive">Uploaded</Badge> : <Badge>Missing</Badge>}
                  </li>
                ))}
              </ul>
            </div>
            {(o.status === 'NOT_STARTED' || o.status === 'REJECTED') && <KycSubmit canSubmit={o.canSubmit} />}
            <p className="text-xs text-ink-400">
              Questions? <Link href="/support" className="text-gold-300 hover:text-gold-200">Contact support</Link>.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documents" subtitle="JPEG, PNG or PDF, up to 5 MB each. Make sure all four corners and the text are readable." />
          <CardBody className="space-y-6">
            <KycUpload canUpload={o.canUpload} />
            {o.documents.length > 0 ? (
              <ul className="divide-y divide-white/[0.06] text-sm" data-testid="kyc-documents">
                {o.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-ink-100">{d.kindLabel}</span>
                      <a href={`/api/kyc/documents/${d.id}`} className="block truncate text-xs text-gold-300 hover:text-gold-200">
                        {d.fileName}
                      </a>
                      {d.reviewNote && d.status === 'REJECTED' && <span className="block text-xs text-ink-400">{d.reviewNote}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-ink-400">{new Date(d.uploadedAt).toLocaleDateString()}</span>
                      <DocStatus status={d.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">No documents uploaded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
