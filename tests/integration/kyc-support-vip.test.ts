/**
 * Identity verification, private uploads, support tickets, notifications and
 * VIP tiers: who can see what, what changes a status, and what never does.
 */
import { randomInt } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as uploadRoute } from '@/app/api/kyc/documents/route';
import { GET as documentRoute } from '@/app/api/kyc/documents/[documentId]/route';
import { POST as ticketCreateRoute } from '@/app/api/support/tickets/route';
import { GET as attachmentRoute } from '@/app/api/support/attachments/[attachmentId]/route';
import { GET as kycQueueRoute } from '@/app/api/admin/kyc/route';
import { PUT as prefsRoute } from '@/app/api/notifications/preferences/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { kycDocuments, notifications, users, type UserRole } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { addRiskFlag, decideKyc, kycDocumentFile, kycOverview, resolveRiskFlag, submitKyc, uploadKycDocument } from '@/server/kyc/kyc';
import { listNotifications, markRead, notificationPrefs, unreadCount } from '@/server/notifications/notifications';
import { createDeposit } from '@/server/payments/deposits';
import { sandboxCheckout } from '@/server/payments/sandbox-actions';
import { requestWithdrawal, withdrawalOptions } from '@/server/payments/withdrawals';
import { dailyBonusStatus } from '@/server/promotions/bonuses';
import { checkUpload, sniffType } from '@/server/storage/private-files';
import { attachmentFile, closeTicket, createTicket, getTicket, playerReply, setTicketStatus, staffReply, staffTicket, supportQueue } from '@/server/support/tickets';
import { levelForWagered, recordVipWagering, updateTier, vipOverview } from '@/server/vip/vip';
import { withTransaction } from '@/server/db/client';
import { key, newPlayer } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body for tests')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg body')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected the call to be refused');
}
async function staff(role: UserRole) {
  const p = await newPlayer(role.toLowerCase().slice(0, 4));
  await getDb().update(users).set({ role }).where(eq(users.id, p.userId));
  return { ...p, ctx: { adminId: p.userId, ipHash: null, requestId: key() } };
}

const BASE = 'http://localhost:3000';
function multipart(path: string, token: string, fields: Record<string, string>, file?: { name: string; bytes: Buffer; type?: string }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.type ?? 'application/octet-stream' }), file.name);
  return new NextRequest(`${BASE}${path}`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE_DEV}=${token}`, origin: BASE, 'x-forwarded-for': `10.66.${randomInt(250)}.${randomInt(250)}` }, body: form });
}
function get(path: string, token: string) {
  return new NextRequest(`${BASE}${path}`, { headers: { cookie: `${SESSION_COOKIE_DEV}=${token}`, 'x-forwarded-for': `10.66.${randomInt(250)}.${randomInt(250)}` } });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

describe('uploads are checked by content and kept private', () => {
  it('accepts JPEG, PNG and PDF by their bytes, not their names; refuses everything else', () => {
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(JPEG)).toBe('image/jpeg');
    expect(sniffType(PDF)).toBe('application/pdf');
    // An HTML page renamed to .png is refused.
    expect(code((() => { try { checkUpload(Buffer.from('<html><script>alert(1)</script></html>'), 'photo.png'); } catch (e) { return e; } })())).toBe('VALIDATION_ERROR');
    // A PDF with JavaScript is refused.
    expect(code((() => { try { checkUpload(Buffer.from('%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'x.pdf'); } catch (e) { return e; } })())).toBe('VALIDATION_ERROR');
    // Too large.
    expect(code((() => { try { checkUpload(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png'); } catch (e) { return e; } })())).toBe('VALIDATION_ERROR');
    // Names lose any path and get the extension of the real type.
    expect(checkUpload(PNG, '../../etc/passwd.exe').fileName).toBe('passwd.png');
  });

  it('documents can be read by their owner and compliance staff only, through the API (no public file)', async () => {
    const p = await newPlayer('kycpriv');
    const other = await newPlayer('kycother');
    const support = await staff('SUPPORT');
    const compliance = await staff('COMPLIANCE_MANAGER');
    const up = await uploadRoute(multipart('/api/kyc/documents', p.token, { kind: 'ID_FRONT' }, { name: 'passport.jpg', bytes: JPEG, type: 'image/jpeg' }), params({}));
    expect(up.status).toBe(200);
    const doc = (await up.json()).document;
    expect(doc).not.toHaveProperty('storageKey');
    const read = (token: string) => documentRoute(get(`/api/kyc/documents/${doc.id}`, token), params({ documentId: doc.id }));
    const own = await read(p.token);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(own.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await own.arrayBuffer()).equals(JPEG)).toBe(true);
    expect((await read(other.token)).status).toBe(404);
    expect((await read(support.token)).status).toBe(404);
    expect((await read(compliance.token)).status).toBe(200);
    // Nothing was written under public/.
    const pub = await readdir('public', { recursive: true });
    expect(pub.some((f) => String(f).includes(doc.id))).toBe(false);
    // A disguised file is refused at the API too.
    const fake = await uploadRoute(multipart('/api/kyc/documents', p.token, { kind: 'ID_BACK' }, { name: 'id.png', bytes: Buffer.from('MZ\x90\x00 not an image'), type: 'image/png' }), params({}));
    expect(fake.status).toBe(400);
  });
});

describe('identity verification', () => {
  it('uploading verifies nothing; submitting asks for review; only a different reviewer decides', async () => {
    const p = await newPlayer('kycflow');
    const reviewer = await staff('COMPLIANCE_MANAGER');
    await uploadKycDocument(p.userId, 'ID_FRONT', { name: 'id.jpg', bytes: JPEG });
    let o = await kycOverview(p.userId);
    expect(o.status).toBe('NOT_STARTED');
    expect(o.canSubmit).toBe(false);
    expect(code(await rejects(submitKyc(p.userId)))).toBe('CONFLICT');
    await uploadKycDocument(p.userId, 'PROOF_OF_ADDRESS', { name: 'bill.pdf', bytes: PDF });
    o = await kycOverview(p.userId);
    expect(o.status).toBe('NOT_STARTED');
    expect(o.canSubmit).toBe(true);
    await submitKyc(p.userId);
    expect((await kycOverview(p.userId)).status).toBe('PENDING');
    // Still not allowed to withdraw: pending is not verified.
    expect((await withdrawalOptions(p.userId)).blockers.some((b) => b.includes('Verify your identity'))).toBe(true);
    // No uploads while under review; the player cannot decide their own case; a reviewer can.
    expect(code(await rejects(uploadKycDocument(p.userId, 'OTHER', { name: 'x.png', bytes: PNG })))).toBe('CONFLICT');
    expect(code(await rejects(decideKyc({ adminId: p.userId, ipHash: null, requestId: key() }, p.userId, 'VERIFIED', 'Self approval attempt')))).toBe('FORBIDDEN');
    await decideKyc(reviewer.ctx, p.userId, 'REJECTED', 'The address document is older than three months.');
    o = await kycOverview(p.userId);
    expect(o).toMatchObject({ status: 'REJECTED', canUpload: true, lastDecision: { decision: 'REJECTED' } });
    expect(o.required.find((r) => r.kind === 'PROOF_OF_ADDRESS')!.provided).toBe(false);
    // Resubmission after new documents, then verified.
    await uploadKycDocument(p.userId, 'ID_FRONT', { name: 'id2.jpg', bytes: JPEG });
    await uploadKycDocument(p.userId, 'PROOF_OF_ADDRESS', { name: 'bill2.pdf', bytes: PDF });
    await submitKyc(p.userId);
    await decideKyc(reviewer.ctx, p.userId, 'VERIFIED', 'Documents match the profile.');
    expect((await kycOverview(p.userId)).status).toBe('VERIFIED');
    const titles = (await listNotifications(p.userId)).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['Documents received', 'Verification needs another look', 'Identity verified']));
    // Decided documents stay readable by their owner.
    const docs = await getDb().select().from(kycDocuments).where(eq(kycDocuments.userId, p.userId));
    expect((await kycDocumentFile({ userId: p.userId, canReview: false }, docs[0]!.id)).bytes.length).toBeGreaterThan(0);
  });

  it('the compliance queue is for compliance staff only', async () => {
    const support = await staff('SUPPORT');
    const finance = await staff('FINANCE_MANAGER');
    const compliance = await staff('COMPLIANCE_MANAGER');
    expect((await kycQueueRoute(get('/api/admin/kyc', support.token), params({}))).status).toBe(403);
    expect((await kycQueueRoute(get('/api/admin/kyc', finance.token), params({}))).status).toBe(403);
    expect((await kycQueueRoute(get('/api/admin/kyc', compliance.token), params({}))).status).toBe(200);
  });

  it('an open risk flag sends every withdrawal to manual review until it is resolved', async () => {
    const p = await newPlayer('flagged');
    const compliance = await staff('COMPLIANCE_MANAGER');
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 10_000 }, key());
    await sandboxCheckout(p.userId, d.deposit.id, 'pay');
    await getDb().update(users).set({ kycStatus: 'VERIFIED' }).where(eq(users.id, p.userId));
    const flag = await addRiskFlag(compliance.ctx, p.userId, { kind: 'MULTIPLE_ACCOUNTS', severity: 'MEDIUM', note: 'Same device as another account' });
    const small = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    expect(small.withdrawal.status).toBe('UNDER_REVIEW');
    expect(code(await rejects(addRiskFlag({ adminId: p.userId, ipHash: null, requestId: key() }, p.userId, { kind: 'OTHER', severity: 'LOW', note: 'flag myself' })))).toBe('FORBIDDEN');
    await resolveRiskFlag(compliance.ctx, flag.id, 'Household member, separate person verified');
    const after = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    expect(after.withdrawal.status).toBe('PROCESSING');
  });
});

describe('support tickets', () => {
  it('a player opens a ticket with an attachment; staff reply and add internal notes the player never sees', async () => {
    const p = await newPlayer('ticket');
    const other = await newPlayer('ticket-other');
    const agent = await staff('SUPPORT');
    const created = await ticketCreateRoute(
      multipart('/api/support/tickets', p.token, { category: 'PAYMENTS', subject: 'Withdrawal question', body: 'When will my withdrawal arrive?' }, { name: 'screenshot.png', bytes: PNG, type: 'image/png' }),
      params({}),
    );
    expect(created.status).toBe(200);
    const t = (await created.json()).ticket;
    expect(t).toMatchObject({ status: 'OPEN', priority: 'NORMAL', categoryLabel: 'Deposits and withdrawals' });
    await staffReply(agent.ctx, t.id, { body: 'Checked: account looks fine.', internal: true }, null);
    await staffReply(agent.ctx, t.id, { body: 'It is being processed and should arrive within a day.', internal: false }, { name: 'receipt.pdf', bytes: PDF });
    const seen = await getTicket(p.userId, t.id);
    expect(seen.ticket.status).toBe('AWAITING_PLAYER');
    expect(seen.messages.map((m) => m.body)).toEqual(['When will my withdrawal arrive?', 'It is being processed and should arrive within a day.']);
    expect(seen.messages[1]!.author).toBe('Aurovane support');
    const staffView = await staffTicket(t.id);
    expect(staffView.messages).toHaveLength(3);
    expect(staffView.messages.some((m) => m.internal)).toBe(true);
    // Notification says there is a reply; it does not copy the message.
    const [n] = await listNotifications(p.userId);
    expect(n).toMatchObject({ kind: 'support', title: 'Support replied' });
    expect(n!.body).not.toContain('processed');
    // Attachments: owner and support staff; never another player.
    const att = seen.messages[0]!.attachments[0]!;
    expect((await attachmentRoute(get(`/api/support/attachments/${att.id}`, p.token), params({ attachmentId: att.id }))).status).toBe(200);
    expect((await attachmentRoute(get(`/api/support/attachments/${att.id}`, other.token), params({ attachmentId: att.id }))).status).toBe(404);
    expect((await attachmentRoute(get(`/api/support/attachments/${att.id}`, agent.token), params({ attachmentId: att.id }))).status).toBe(200);
    expect(code(await rejects(getTicket(other.userId, t.id)))).toBe('NOT_FOUND');
    // The player answers (reopens), staff resolve, the player closes; a closed ticket takes no replies.
    await playerReply(p.userId, t.id, 'Thanks!', null);
    expect((await getTicket(p.userId, t.id)).ticket.status).toBe('OPEN');
    await setTicketStatus(agent.ctx, t.id, 'RESOLVED', 'Answered the question');
    await closeTicket(p.userId, t.id);
    expect(code(await rejects(playerReply(p.userId, t.id, 'One more thing', null)))).toBe('CONFLICT');
    // Agents cannot answer their own tickets as staff.
    const own = await createTicket(agent.userId, { category: 'OTHER', subject: 'My own issue', body: 'Help' }, null);
    expect(code(await rejects(staffReply(agent.ctx, own.id, { body: 'Answering myself', internal: false }, null)))).toBe('FORBIDDEN');
    expect(code(await rejects(attachmentFile({ userId: other.userId, isSupport: false }, att.id)))).toBe('NOT_FOUND');
  });

  it('priority follows the VIP perk; the queue shows priority tickets first', async () => {
    const p = await newPlayer('vipticket');
    await getDb().update(users).set({ vipLevel: 3 }).where(eq(users.id, p.userId));
    const t = await createTicket(p.userId, { category: 'GAMES', subject: 'A question about Plinko', body: 'How are the rows decided?' }, null);
    expect(t.priority).toBe('HIGH');
    const queue = await supportQueue('open');
    const firstNormal = queue.findIndex((q) => q.priority === 'NORMAL');
    const lastHigh = queue.map((q) => q.priority).lastIndexOf('HIGH');
    expect(firstNormal === -1 || lastHigh < firstNormal).toBe(true);
  });
});

describe('notifications and VIP', () => {
  it('unread counts, mark read, and e-mail preferences (security mail cannot be switched off)', async () => {
    const p = await newPlayer('notif');
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    await sandboxCheckout(p.userId, d.deposit.id, 'pay');
    expect(await unreadCount(p.userId)).toBeGreaterThanOrEqual(1);
    await markRead(p.userId, 'all');
    expect(await unreadCount(p.userId)).toBe(0);
    const res = await prefsRoute(
      new NextRequest(`${BASE}/api/notifications/preferences`, {
        method: 'PUT',
        headers: { cookie: `${SESSION_COOKIE_DEV}=${p.token}`, origin: BASE, 'content-type': 'application/json', 'x-forwarded-for': `10.66.${randomInt(250)}.${randomInt(250)}` },
        body: JSON.stringify({ deposit: { email: true }, security: { email: false } }),
      }),
      params({}),
    );
    expect(res.status).toBe(200);
    const prefs = await notificationPrefs(p.userId);
    expect(prefs.deposit.email).toBe(true);
    expect(prefs.security.email).toBe(true);
    const rows = await getDb().select().from(notifications).where(eq(notifications.userId, p.userId));
    expect(rows.every((r) => !/password/i.test(r.body))).toBe(true);
  });

  it('tiers follow lifetime wagering, are never lost, and their perks are applied', async () => {
    expect(levelForWagered([{ level: 1, minWagered: 0 }, { level: 2, minWagered: 100 }, { level: 3, minWagered: 500 }], 499)).toBe(2);
    const p = await newPlayer('vip');
    expect((await vipOverview(p.userId)).current).toMatchObject({ level: 1, name: 'Bronze' });
    await withTransaction((tx) => recordVipWagering(tx, p.userId, 5_000_000));
    const o = await vipOverview(p.userId);
    expect(o.current).toMatchObject({ level: 2, name: 'Silver' });
    expect(o.next).toMatchObject({ name: 'Gold', remaining: 20_000_000 });
    expect((await listNotifications(p.userId))[0]).toMatchObject({ kind: 'vip', title: 'Welcome to Silver' });
    // The Silver perk: a 25% larger daily free top-up.
    const status = await dailyBonusStatus(getDb(), p.userId);
    expect(status.amount).toBe(status.baseAmount + Math.floor(status.baseAmount / 4));
    // Thresholds must keep increasing; a bad edit is refused and audited edits apply.
    const admin = await staff('ADMIN');
    expect(code(await rejects(updateTier(admin.ctx, 2, { minWagered: 30_000_000 }, 'Above gold, should fail')))).toBe('VALIDATION_ERROR');
    await updateTier(admin.ctx, 2, { name: 'Silver' }, 'No-op rename for the test');
  });
});
