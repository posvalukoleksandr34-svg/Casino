/**
 * Identity verification (KYC).
 *
 *   NOT_STARTED → (player uploads the required documents and submits) → PENDING
 *   PENDING → (a compliance reviewer decides) → VERIFIED | REJECTED
 *   REJECTED → (player uploads again and resubmits) → PENDING
 *
 * Uploading a document never changes the verification status, and the player
 * is told so: only a reviewer's recorded decision does. Documents are kept in
 * private storage and can be downloaded only by their owner and by staff with
 * kyc:review (every staff download is audited). A reviewer can never decide
 * their own verification.
 *
 * The decision is made by people in this code base: there is no automated
 * identity-verification provider (see ./provider.ts for the interface one
 * would implement).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { audit, recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Executor } from '../db/client';
import { kycDocuments, kycReviews, riskFlags, users, type KycDocumentKind, type KycStatus, type RiskFlagKind } from '../db/schema';
import { errors } from '../errors';
import { notify } from '../notifications/notifications';
import { checkUpload, putPrivateFile, readPrivateFile } from '../storage/private-files';
import { identityProvider } from './provider';

export const REQUIRED_KINDS: KycDocumentKind[] = ['ID_FRONT', 'PROOF_OF_ADDRESS'];
export const KIND_LABELS: Record<KycDocumentKind, string> = {
  ID_FRONT: 'Identity document (front)',
  ID_BACK: 'Identity document (back)',
  PROOF_OF_ADDRESS: 'Proof of address (dated within 3 months)',
  SELFIE: 'Selfie holding the identity document',
  OTHER: 'Other supporting document',
};
const MAX_PENDING_DOCUMENTS = 10;

function docView(d: typeof kycDocuments.$inferSelect) {
  return {
    id: d.id,
    kind: d.kind,
    kindLabel: KIND_LABELS[d.kind],
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    status: d.status,
    reviewNote: d.reviewNote,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

/** What the player's verification page shows. */
export async function kycOverview(userId: string) {
  const db = getDb();
  const [u] = await db.select({ status: users.kycStatus, updatedAt: users.kycUpdatedAt }).from(users).where(eq(users.id, userId));
  const docs = await db.select().from(kycDocuments).where(eq(kycDocuments.userId, userId)).orderBy(desc(kycDocuments.uploadedAt));
  const [last] = await db.select().from(kycReviews).where(eq(kycReviews.userId, userId)).orderBy(desc(kycReviews.id)).limit(1);
  const usable = docs.filter((d) => d.status !== 'REJECTED');
  const missing = REQUIRED_KINDS.filter((k) => !usable.some((d) => d.kind === k));
  const status = (u?.status ?? 'NOT_STARTED') as KycStatus;
  return {
    status,
    updatedAt: u?.updatedAt?.toISOString() ?? null,
    lastDecision: last && last.decision !== 'SUBMITTED' ? { decision: last.decision, note: last.note, at: last.createdAt.toISOString() } : null,
    documents: docs.map(docView),
    required: REQUIRED_KINDS.map((k) => ({ kind: k, label: KIND_LABELS[k], provided: !missing.includes(k) })),
    canUpload: status === 'NOT_STARTED' || status === 'REJECTED',
    canSubmit: (status === 'NOT_STARTED' || status === 'REJECTED') && missing.length === 0 && docs.some((d) => d.status === 'PENDING'),
  };
}

export async function uploadKycDocument(userId: string, kind: KycDocumentKind, file: { name: string; bytes: Buffer }) {
  if (!(kind in KIND_LABELS)) throw errors.validation('Choose the type of document.');
  const checked = checkUpload(file.bytes, file.name);
  const db = getDb();
  const [u] = await db.select({ status: users.kycStatus }).from(users).where(eq(users.id, userId));
  if (u?.status === 'VERIFIED') throw errors.conflict('Your identity is already verified.');
  if (u?.status === 'PENDING' || u?.status === 'UNDER_REVIEW') throw errors.conflict('Your documents are being reviewed. You can upload again if we ask for more.');
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(kycDocuments).where(and(eq(kycDocuments.userId, userId), eq(kycDocuments.status, 'PENDING')));
  if ((count?.n ?? 0) >= MAX_PENDING_DOCUMENTS) throw errors.conflict(`You can have at most ${MAX_PENDING_DOCUMENTS} documents waiting. Submit them for review first.`);
  const storageKey = await putPrivateFile('kyc', checked.bytes);
  return withTransaction(async (tx) => {
    const [row] = await tx
      .insert(kycDocuments)
      .values({ userId, kind, fileName: checked.fileName, contentType: checked.contentType, sizeBytes: checked.bytes.length, sha256: checked.sha256, storageKey })
      .returning();
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'kyc.document_uploaded', resourceType: 'kyc_document', resourceId: row!.id, after: { kind, sizeBytes: checked.bytes.length, contentType: checked.contentType } });
    return docView(row!);
  });
}

/** Sends the uploaded documents for review. This does not verify anything by itself. */
export async function submitKyc(userId: string, now = new Date()) {
  const overview = await kycOverview(userId);
  if (!overview.canSubmit) {
    const missing = overview.required.filter((r) => !r.provided).map((r) => r.label);
    throw errors.conflict(missing.length ? `Upload these first: ${missing.join(', ')}.` : 'There is nothing new to submit.');
  }
  return withTransaction(async (tx) => {
    const [u] = await tx.select({ status: users.kycStatus }).from(users).where(eq(users.id, userId)).for('update');
    if (u?.status !== 'NOT_STARTED' && u?.status !== 'REJECTED') throw errors.conflict('Your verification is already in progress.');
    const docs = await tx.select().from(kycDocuments).where(and(eq(kycDocuments.userId, userId), eq(kycDocuments.status, 'PENDING')));
    const ref = await identityProvider().submit({ userId, documentIds: docs.map((d) => d.id) });
    await tx.update(users).set({ kycStatus: 'PENDING', kycUpdatedAt: now }).where(eq(users.id, userId));
    await tx.insert(kycReviews).values({ userId, decision: 'SUBMITTED', actorId: userId, note: `provider ${ref.provider}: ${ref.reference}` });
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'kyc.submitted', resourceType: 'user', resourceId: userId, after: { documents: docs.length } });
    await notify(tx, userId, {
      kind: 'verification',
      title: 'Documents received',
      body: 'Thank you. A member of our compliance team will review them; you will be notified of the result. Your identity is not verified until then.',
      link: '/account/verification',
    });
    return { status: 'PENDING' as const };
  });
}

/** A document's bytes for its owner, or for staff with kyc:review (audited). */
export async function kycDocumentFile(viewer: { userId: string; canReview: boolean }, documentId: string) {
  const [d] = await getDb().select().from(kycDocuments).where(eq(kycDocuments.id, documentId));
  if (!d || (d.userId !== viewer.userId && !viewer.canReview)) throw errors.notFound('Document');
  const bytes = await readPrivateFile(d.storageKey);
  if (d.userId !== viewer.userId) {
    await audit(getDb(), { actorId: viewer.userId, actorType: 'ADMIN', action: 'kyc.document_viewed', resourceType: 'kyc_document', resourceId: d.id, metadata: { owner: d.userId } });
  }
  return { bytes, contentType: d.contentType, fileName: d.fileName };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export async function kycQueue() {
  const rows = await getDb()
    .select({ id: users.id, username: users.username, status: users.kycStatus, updatedAt: users.kycUpdatedAt, createdAt: users.createdAt })
    .from(users)
    .where(inArray(users.kycStatus, ['PENDING', 'UNDER_REVIEW']))
    .orderBy(asc(users.kycUpdatedAt))
    .limit(200);
  const flags = rows.length
    ? await getDb()
        .select({ userId: riskFlags.userId, n: sql<number>`count(*)::int` })
        .from(riskFlags)
        .where(and(inArray(riskFlags.userId, rows.map((r) => r.id)), isNull(riskFlags.resolvedAt)))
        .groupBy(riskFlags.userId)
    : [];
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), openFlags: flags.find((f) => f.userId === r.id)?.n ?? 0 }));
}

export async function kycCase(userId: string) {
  const db = getDb();
  const [u] = await db.select({ id: users.id, username: users.username, status: users.kycStatus, firstName: users.firstName, lastName: users.lastName, dateOfBirth: users.dateOfBirth, countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
  if (!u) throw errors.notFound('User');
  const docs = await db.select().from(kycDocuments).where(eq(kycDocuments.userId, userId)).orderBy(desc(kycDocuments.uploadedAt));
  const reviews = await db.select().from(kycReviews).where(eq(kycReviews.userId, userId)).orderBy(desc(kycReviews.id)).limit(50);
  const flags = await db.select().from(riskFlags).where(eq(riskFlags.userId, userId)).orderBy(desc(riskFlags.id));
  return {
    user: u,
    documents: docs.map(docView),
    reviews: reviews.map((r) => ({ id: r.id, decision: r.decision, note: r.note, actorId: r.actorId, at: r.createdAt.toISOString() })),
    flags: flags.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), resolvedAt: f.resolvedAt?.toISOString() ?? null })),
  };
}

/** A reviewer's decision. Accepts or rejects the documents under review; the reason is shown to the player. */
export async function decideKyc(ctx: AdminCtx, userId: string, decision: 'VERIFIED' | 'REJECTED', note: string, now = new Date()) {
  if (userId === ctx.adminId) throw errors.forbidden('You cannot review your own verification.');
  return withTransaction(async (tx) => {
    const [u] = await tx.select({ status: users.kycStatus }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) throw errors.notFound('User');
    if (u.status !== 'PENDING' && u.status !== 'UNDER_REVIEW') throw errors.conflict('There is no submission waiting for a decision.');
    await tx
      .update(kycDocuments)
      .set({ status: decision === 'VERIFIED' ? 'ACCEPTED' : 'REJECTED', reviewNote: note, reviewedBy: ctx.adminId, reviewedAt: now })
      .where(and(eq(kycDocuments.userId, userId), eq(kycDocuments.status, 'PENDING')));
    await tx.update(users).set({ kycStatus: decision, kycUpdatedAt: now }).where(eq(users.id, userId));
    await tx.insert(kycReviews).values({ userId, decision, note, actorId: ctx.adminId });
    await recordAdminAction(tx, { ...ctx, action: decision === 'VERIFIED' ? 'kyc.verified' : 'kyc.rejected', targetType: 'user', targetId: userId, reason: note, before: { status: u.status }, after: { status: decision } });
    await notify(tx, userId, {
      kind: 'verification',
      title: decision === 'VERIFIED' ? 'Identity verified' : 'Verification needs another look',
      body: decision === 'VERIFIED' ? 'Your identity has been verified. Withdrawals are now available.' : `We could not verify your identity from these documents: ${note} Please upload new ones.`,
      link: '/account/verification',
    });
    return { status: decision };
  });
}

export async function addRiskFlag(ctx: AdminCtx, userId: string, input: { kind: RiskFlagKind; severity: 'LOW' | 'MEDIUM' | 'HIGH'; note: string }) {
  if (userId === ctx.adminId) throw errors.forbidden('You cannot flag your own account.');
  return withTransaction(async (tx) => {
    const [row] = await tx.insert(riskFlags).values({ userId, ...input, createdBy: ctx.adminId }).returning();
    await recordAdminAction(tx, { ...ctx, action: 'risk.flag_added', targetType: 'user', targetId: userId, reason: input.note, after: { kind: input.kind, severity: input.severity, flagId: row!.id } });
    return row!;
  });
}

export async function resolveRiskFlag(ctx: AdminCtx, flagId: number, resolution: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [f] = await tx.select().from(riskFlags).where(eq(riskFlags.id, flagId)).for('update');
    if (!f) throw errors.notFound('Flag');
    if (f.resolvedAt) throw errors.conflict('This flag is already resolved.');
    if (f.userId === ctx.adminId) throw errors.forbidden('You cannot resolve a flag on your own account.');
    await tx.update(riskFlags).set({ resolvedBy: ctx.adminId, resolvedAt: now, resolution }).where(eq(riskFlags.id, flagId));
    await recordAdminAction(tx, { ...ctx, action: 'risk.flag_resolved', targetType: 'user', targetId: f.userId, reason: resolution, before: { flagId, kind: f.kind } });
    return { ok: true };
  });
}

/** Open compliance flags on an account (an open flag sends every withdrawal to manual review). */
export async function openRiskFlagCount(db: Executor, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(riskFlags).where(and(eq(riskFlags.userId, userId), isNull(riskFlags.resolvedAt)));
  return r?.n ?? 0;
}
