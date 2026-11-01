/**
 * Four-eyes approvals: request → second staff member approves (executes once,
 * atomically) or rejects; no self-approval; expiry; failed execution leaves no
 * posting; concurrent approvals execute once; decided requests are immutable;
 * the HTTP routes create requests instead of executing; every stage audited;
 * reconciliation still holds.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as adjustRoute } from '@/app/api/admin/users/[userId]/adjust/route';
import { POST as grantRoute } from '@/app/api/admin/users/[userId]/grant/route';
import { POST as fundRoute } from '@/app/api/admin/house/fund/route';
import { POST as securityRoute } from '@/app/api/admin/security/route';
import { POST as decideRoute } from '@/app/api/admin/approvals/[requestId]/route';
import { decideApproval, listApprovals, pendingApprovalCount, requestApproval } from '@/server/admin/approvals';
import { GRANT_APPROVAL_THRESHOLD, grantChips } from '@/server/admin/wallet';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { adminActions, adminApprovalRequests, ledgerTransactions, platformSettings, users, type UserRole } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { expectDbError, expectLedgerConsistent, key, newPlayer } from './helpers';

const BASE = 'http://localhost:3000';
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;

async function staff(role: UserRole) {
  const p = await newPlayer(role.toLowerCase().slice(0, 4));
  await getDb().update(users).set({ role }).where(eq(users.id, p.userId));
  return { ...p, role, ctx: { adminId: p.userId, ipHash: null, requestId: key() } };
}

function call<P>(handler: (r: NextRequest, c: { params: Promise<P> }) => Promise<Response>, path: string, token: string, body: unknown, params: P = {} as P) {
  const headers = { cookie: `${SESSION_COOKIE_DEV}=${token}`, origin: BASE, 'content-type': 'application/json', 'idempotency-key': randomUUID() };
  return handler(new NextRequest(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
}

const txCount = async (userId: string, type: 'ADJUSTMENT' | 'CHIP_GRANT') =>
  (await getDb().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.userId, userId), eq(ledgerTransactions.type, type)))).length;

afterAll(async () => {
  await getDb().update(platformSettings).set({ staffMfaRequired: false }).where(eq(platformSettings.id, 1));
});

describe('balance corrections are four-eyes', () => {
  it('the route only creates a request; a second admin executes it exactly once', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apr')];
    const before = await balance(p.userId);
    const res = await call(adjustRoute, `/api/admin/users/${p.userId}/adjust`, a.token, { amount: 12_345, reason: 'Goodwill after incident 42' }, { userId: p.userId });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.approvalRequired).toBe(true);
    expect(await balance(p.userId)).toBe(before); // nothing posted yet
    const id = body.request.id as string;
    expect(await pendingApprovalCount({ userId: b.userId, role: 'ADMIN' })).toBeGreaterThan(0);

    // The requester cannot decide their own request, neither through the service nor over HTTP.
    expect(code(await decideApproval(a.ctx, id, 'approve', undefined).catch((e) => e))).toBe('FORBIDDEN');
    expect((await call(decideRoute, `/api/admin/approvals/${id}`, a.token, { decision: 'approve' }, { requestId: id })).status).toBe(403);
    // Neither can a moderator (no ledger:adjust).
    const mod = await staff('SUPPORT');
    expect(code(await decideApproval(mod.ctx, id, 'approve', undefined).catch((e) => e))).toBe('FORBIDDEN');

    const ok = await call(decideRoute, `/api/admin/approvals/${id}`, b.token, { decision: 'approve', note: 'Checked the incident ticket' }, { requestId: id });
    expect(ok.status).toBe(200);
    expect((await ok.json()).request.status).toBe('EXECUTED');
    expect(await balance(p.userId)).toBe(before + 12_345);
    expect(code(await decideApproval(b.ctx, id, 'approve', undefined).catch((e) => e))).toBe('CONFLICT');
    expect(await balance(p.userId)).toBe(before + 12_345);
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(1);

    // Attributed as before (requester posts the correction) plus the approver's decision.
    const actions = await getDb().select({ action: adminActions.action, adminId: adminActions.adminId }).from(adminActions).where(sql`${adminActions.targetId} IN (${id}, ${p.userId})`);
    expect(actions).toEqual(expect.arrayContaining([
      { action: 'approval.requested', adminId: a.userId },
      { action: 'ledger.adjustment', adminId: a.userId },
      { action: 'approval.approved', adminId: b.userId },
    ]));
    await expectLedgerConsistent();
  });

  it('concurrent approvals execute once', async () => {
    const [a, b, c, p] = [await staff('ADMIN'), await staff('ADMIN'), await staff('OWNER'), await newPlayer('apc')];
    const before = await balance(p.userId);
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 777 }, reason: 'Concurrency check' }, key());
    const results = await Promise.allSettled([b, c, b, c].map((s) => decideApproval({ ...s.ctx, requestId: key() }, body.request.id, 'approve', undefined)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(p.userId)).toBe(before + 777);
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(1);
  });

  it('a rejection needs a reason and the request can never execute afterwards', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apj')];
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 500 }, reason: 'Request to reject' }, key());
    expect(code(await decideApproval(b.ctx, body.request.id, 'reject', '').catch((e) => e))).toBe('VALIDATION_ERROR');
    await decideApproval(b.ctx, body.request.id, 'reject', 'No supporting incident');
    expect(code(await decideApproval(b.ctx, body.request.id, 'approve', undefined).catch((e) => e))).toBe('CONFLICT');
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(0);
  });

  it('the requester can cancel; others cannot', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apx')];
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 500 }, reason: 'Request to cancel' }, key());
    expect(code(await decideApproval(b.ctx, body.request.id, 'cancel', undefined).catch((e) => e))).toBe('FORBIDDEN');
    expect((await decideApproval(a.ctx, body.request.id, 'cancel', undefined)).request.status).toBe('CANCELLED');
  });

  it('expired requests are refused and recorded as expired', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('ape')];
    const [row] = await getDb()
      .insert(adminApprovalRequests)
      .values({ action: 'ledger.adjustment', targetType: 'user', targetId: p.userId, params: { amount: 300 }, reason: 'Old request', requestedBy: a.userId, requestedRole: 'ADMIN', requestedAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) })
      .returning();
    const err = await decideApproval(b.ctx, row!.id, 'approve', undefined).catch((e) => e);
    expect(code(err)).toBe('CONFLICT');
    expect((err as AppError).details?.status).toBe('EXPIRED');
    const [after] = await getDb().select().from(adminApprovalRequests).where(eq(adminApprovalRequests.id, row!.id));
    expect(after!.status).toBe('EXPIRED');
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(0);
  });

  it('a failed execution posts nothing and closes the request as FAILED', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apf')];
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: -((await balance(p.userId)) + 1) }, reason: 'Debit larger than balance' }, key());
    const err = await decideApproval(b.ctx, body.request.id, 'approve', undefined).catch((e) => e);
    expect(code(err)).toBe('CONFLICT');
    expect((err as AppError).details?.status).toBe('FAILED');
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(0);
    const [row] = await getDb().select().from(adminApprovalRequests).where(eq(adminApprovalRequests.id, body.request.id));
    expect(row!.status).toBe('FAILED');
  });

  it('a requester who lost the permission before approval cannot have it executed', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apd')];
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 400 }, reason: 'Then demoted' }, key());
    await getDb().update(users).set({ role: 'SUPPORT' }).where(eq(users.id, a.userId));
    expect(code(await decideApproval(b.ctx, body.request.id, 'approve', undefined).catch((e) => e))).toBe('CONFLICT');
    expect(await txCount(p.userId, 'ADJUSTMENT')).toBe(0);
  });

  it('decided requests are immutable in the database', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('api')];
    const { body } = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 100 }, reason: 'Immutability check' }, key());
    await expectDbError(getDb().execute(sql`UPDATE admin_approval_requests SET params = '{"amount": 999999}' WHERE id = ${body.request.id}`), /cannot change/);
    await decideApproval(b.ctx, body.request.id, 'approve', undefined);
    await expectDbError(getDb().execute(sql`UPDATE admin_approval_requests SET status = 'PENDING', decided_at = NULL WHERE id = ${body.request.id}`), /immutable/);
    await expectDbError(getDb().execute(sql`DELETE FROM admin_approval_requests WHERE id = ${body.request.id}`), /cannot be deleted|permission denied/);
    // Self-decision is refused by the database too.
    await expectDbError(
      getDb().execute(sql`INSERT INTO admin_approval_requests (action, target_type, target_id, reason, requested_by, requested_role, expires_at, status, decided_by, decided_at)
                          VALUES ('house.fund', 'account', 'HOUSE_BANKROLL', 'self approved', ${a.userId}, 'OWNER', now() + interval '1 hour', 'EXECUTED', ${a.userId}, now())`),
      /check/i,
    );
  });
});

describe('large grants, house funding and the MFA policy', () => {
  it('grants up to the threshold are immediate; above it a second owner must approve', async () => {
    const [o1, o2, admin, p] = [await staff('OWNER'), await staff('OWNER'), await staff('ADMIN'), await newPlayer('apg')];
    const small = await call(grantRoute, `/api/admin/users/${p.userId}/grant`, o1.token, { amount: 5_000, reason: 'Small QA grant' }, { userId: p.userId });
    expect(small.status).toBe(201);
    expect(code(await grantChips(o1.ctx, p.userId, GRANT_APPROVAL_THRESHOLD + 1, 'Too big for direct', key()).catch((e) => e))).toBe('CONFLICT');
    const big = await call(grantRoute, `/api/admin/users/${p.userId}/grant`, o1.token, { amount: GRANT_APPROVAL_THRESHOLD + 100, reason: 'Large QA grant' }, { userId: p.userId });
    expect(big.status).toBe(202);
    const id = (await big.json()).request.id as string;
    expect(code(await decideApproval(admin.ctx, id, 'approve', undefined).catch((e) => e))).toBe('FORBIDDEN'); // admins cannot grant
    const before = await balance(p.userId);
    await decideApproval(o2.ctx, id, 'approve', undefined);
    expect(await balance(p.userId)).toBe(before + GRANT_APPROVAL_THRESHOLD + 100);
    await expectLedgerConsistent();
  });

  it('house funding waits for a second owner', async () => {
    const [o1, o2] = [await staff('OWNER'), await staff('OWNER')];
    const res = await call(fundRoute, '/api/admin/house/fund', o1.token, { amount: 50_000, reason: 'Reserve top-up' });
    expect(res.status).toBe(202);
    const id = (await res.json()).request.id as string;
    const done = await decideApproval(o2.ctx, id, 'approve', undefined);
    expect(done.request.status).toBe('EXECUTED');
    expect(done.request.result).toMatchObject({ transactionId: expect.any(Number) });
  });

  it('switching the staff MFA policy off needs another owner; switching it on does not', async () => {
    const [o1, o2] = [await staff('OWNER'), await staff('OWNER')];
    await getDb().update(platformSettings).set({ staffMfaRequired: true }).where(eq(platformSettings.id, 1));
    const res = await call(securityRoute, '/api/admin/security', o1.token, { staffMfaRequired: false, reason: 'Temporarily relax' });
    // The requester has MFA off, so with the policy on the request is refused before anything happens.
    expect(res.status).toBe(403);
    await getDb().update(platformSettings).set({ staffMfaRequired: false }).where(eq(platformSettings.id, 1));
    const { body } = await requestApproval(o1.ctx, { action: 'security.staff_mfa_disable', params: {}, reason: 'Relax for maintenance' }, key());
    await getDb().update(platformSettings).set({ staffMfaRequired: true }).where(eq(platformSettings.id, 1));
    const [still] = await getDb().select({ r: platformSettings.staffMfaRequired }).from(platformSettings);
    expect(still!.r).toBe(true);
    await decideApproval(o2.ctx, body.request.id, 'approve', undefined);
    const [after] = await getDb().select({ r: platformSettings.staffMfaRequired }).from(platformSettings);
    expect(after!.r).toBe(false);
  });

  it('lists what each viewer may decide, and requests are idempotent per key', async () => {
    const [a, b, p] = [await staff('ADMIN'), await staff('ADMIN'), await newPlayer('apl')];
    const k = key();
    const first = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 250 }, reason: 'Idempotent request' }, k);
    const again = await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 250 }, reason: 'Idempotent request' }, k);
    expect(again.body.request.id).toBe(first.body.request.id);
    expect(again.replayed).toBe(true);
    const mine = (await listApprovals({ userId: a.userId, role: 'ADMIN' })).find((r) => r.id === first.body.request.id)!;
    expect(mine).toMatchObject({ canDecide: false, canCancel: true });
    const theirs = (await listApprovals({ userId: b.userId, role: 'ADMIN' })).find((r) => r.id === first.body.request.id)!;
    expect(theirs).toMatchObject({ canDecide: true, canCancel: false });
    const player = await listApprovals({ userId: p.userId, role: 'PLAYER' });
    expect(player.find((r) => r.id === first.body.request.id)).toBeUndefined();
  });

  it('rejects invalid parameters and unknown targets', async () => {
    const a = await staff('ADMIN');
    expect(code(await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: randomUUID(), params: { amount: 5 }, reason: 'Unknown user' }, key()).catch((e) => e))).toBe('NOT_FOUND');
    const p = await newPlayer('apv');
    expect(code(await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 0 }, reason: 'Zero amount' }, key()).catch((e) => e))).toBe('VALIDATION_ERROR');
    expect(code(await requestApproval(a.ctx, { action: 'ledger.adjustment', targetId: p.userId, params: { amount: 5, balance: 99 }, reason: 'Smuggled field' }, key()).catch((e) => e))).toBe('VALIDATION_ERROR');
    expect(code(await requestApproval(a.ctx, { action: 'house.fund', params: { amount: 5 }, reason: 'Admins cannot fund' }, key()).catch((e) => e))).toBe('FORBIDDEN');
  });
});
