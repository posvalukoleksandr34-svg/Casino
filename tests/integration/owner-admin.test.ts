import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as grantRoute } from '@/app/api/admin/users/[userId]/grant/route';
import { POST as roleRoute } from '@/app/api/admin/users/[userId]/role/route';
import { POST as statusRoute } from '@/app/api/admin/users/[userId]/status/route';
import { GET as usersRoute } from '@/app/api/admin/users/route';
import { GET as userRoute } from '@/app/api/admin/users/[userId]/route';
import { POST as configRoute } from '@/app/api/admin/games/[gameId]/config/route';
import { GET as ledgerRoute } from '@/app/api/admin/ledger/route';
import { GET as auditRoute } from '@/app/api/admin/audit/route';
import { POST as securityRoute } from '@/app/api/admin/security/route';
import { POST as eventRoute } from '@/app/api/admin/sports/events/[eventId]/route';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { fundHouse, limitProblems, setGameStatus, updateRiskLimits } from '@/server/admin/admin-service';
import { overviewMetrics } from '@/server/admin/overview';
import { resolvePeriod } from '@/server/admin/period';
import { provisionOwner } from '@/server/admin/provision';
import { listUsers, revokeUserSessions, setUserRole, setUserStatus, userDetail } from '@/server/admin/users';
import { adjustBalance, grantChips, MAX_GRANT } from '@/server/admin/wallet';
import { beginEnrollment, completeMfaLogin, confirmEnrollment, setStaffMfaRequired, staffMfaBlocks, verifySession } from '@/server/auth/mfa';
import { resolveSession, SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { base32Decode, hotp, timeStep } from '@/server/auth/totp';
import { getDb, getPool } from '@/server/db/client';
import { adminActions, auditLogs, ledgerTransactions, platformSettings, sportsEvents, sportsMarkets, users, type UserRole } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { CATALOG } from '@/server/games/catalog';
import { actOnRound, startRound } from '@/server/games/round-service';
import { runChecksWith } from '@/server/jobs/reconciliation';
import { getWalletAccount } from '@/server/ledger/accounts';
import { claimDailyBonus } from '@/server/promotions/bonuses';
import { adminCreateDemoFixture, adminSetMarketWindow, previewSettlement } from '@/server/sports/admin';
import { adminCorrectResult, getEvent, listEvents } from '@/server/sports/queries';
import { ensureDemoFixtures } from '@/server/sports/sync';
import { placeSlip } from '@/server/sports/tickets';
import { deleteAccount, login } from '@/server/users/accounts';
import { expectLedgerConsistent, key, newPlayer, setPlatform } from './helpers';

const BASE = 'http://localhost:3000';
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
function req(path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.method && opts.method !== 'GET') headers.origin = BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const meta = { ipHash: null, userAgent: 'vitest', requestId: null };

async function staff(role: UserRole, prefix = role.toLowerCase().slice(0, 4)) {
  const p = await newPlayer(prefix);
  await getDb().update(users).set({ role }).where(eq(users.id, p.userId));
  return { ...p, ctx: { adminId: p.userId, ipHash: null, requestId: key() } };
}
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;

/** Leaves exactly one active owner (the one given) by demoting the others, as the recovery runbook does. */
async function onlyOwner(ownerId: string) {
  const c = await getPool().connect();
  try {
    await c.query('ALTER TABLE users DISABLE TRIGGER users_keep_an_owner');
    await c.query(`UPDATE users SET role = 'ADMIN' WHERE role = 'OWNER' AND id <> $1`, [ownerId]);
  } finally {
    await c.query('ALTER TABLE users ENABLE TRIGGER users_keep_an_owner');
    c.release();
  }
}

afterAll(async () => {
  await getDb().update(platformSettings).set({ staffMfaRequired: false }).where(eq(platformSettings.id, 1));
});

describe('authorisation at the API boundary', () => {
  it('anonymous callers get 401; players 403 with a throttled security event; moderators cannot do owner/admin work', async () => {
    const p = await newPlayer('az');
    const target = await newPlayer('azt');
    const mod = await staff('SUPPORT');
    const admin = await staff('ADMIN');
    const grantBody = { amount: 100, reason: 'Authorisation test grant' };
    const call = (token?: string) => grantRoute(req(`/api/admin/users/${target.userId}/grant`, { method: 'POST', token, body: grantBody, headers: { 'idempotency-key': key() } }), params({ userId: target.userId }));
    expect((await call()).status).toBe(401);
    expect((await call(p.token)).status).toBe(403);
    expect((await call(mod.token)).status).toBe(403);
    expect((await call(admin.token)).status).toBe(403); // grants are owner-only
    const denied = await getDb().select().from(auditLogs).where(and(eq(auditLogs.actorId, p.userId), eq(auditLogs.action, 'security.access_denied')));
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ outcome: 'DENIED', actorRole: 'PLAYER', resourceId: 'ledger:grant' });

    // The same rules hold on every admin route, not only in the interface.
    expect((await usersRoute(req('/api/admin/users', { token: p.token }), params({}))).status).toBe(403);
    expect((await ledgerRoute(req('/api/admin/ledger', { token: mod.token }), params({}))).status).toBe(200);
    expect((await auditRoute(req('/api/admin/audit', { token: mod.token }), params({}))).status).toBe(403);
    expect((await roleRoute(req(`/api/admin/users/${target.userId}/role`, { method: 'POST', token: mod.token, body: { role: 'SUPPORT', reason: 'Moderator tries roles' } }), params({ userId: target.userId }))).status).toBe(403);
    expect((await configRoute(req('/api/admin/games/dice/config', { method: 'POST', token: mod.token, body: { config: {}, reason: 'Moderator tries config' } }), params({ gameId: 'dice' }))).status).toBe(403);
    expect((await securityRoute(req('/api/admin/security', { method: 'POST', token: admin.token, body: { staffMfaRequired: true, reason: 'Admin tries policy' } }), params({}))).status).toBe(403);
    // A moderator can suspend a player through the API.
    const ok = await statusRoute(req(`/api/admin/users/${target.userId}/status`, { method: 'POST', token: mod.token, body: { status: 'SUSPENDED', reason: 'Moderator suspension test' } }), params({ userId: target.userId }));
    expect(ok.status).toBe(200);
  });

  it('malformed identifiers and bodies are rejected without side effects', async () => {
    const owner = await staff('OWNER');
    expect((await userRoute(req('/api/admin/users/not-a-uuid', { token: owner.token }), params({ userId: 'not-a-uuid' }))).status).toBe(404);
    expect((await statusRoute(req('/api/admin/users/x/status', { method: 'POST', token: owner.token, body: { status: 'SUSPENDED', reason: 'Bad id test' } }), params({ userId: 'x' }))).status).toBe(400);
    const p = await newPlayer('mal');
    const g = (body: unknown) => grantRoute(req(`/api/admin/users/${p.userId}/grant`, { method: 'POST', token: owner.token, body, headers: { 'idempotency-key': key() } }), params({ userId: p.userId }));
    for (const body of [{ amount: 0, reason: 'zero amount' }, { amount: -5, reason: 'negative amount' }, { amount: 1.5, reason: 'fractional amount' }, { amount: MAX_GRANT + 1, reason: 'too large amount' }, { amount: 100, reason: 'x' }, { amount: 100, reason: 'Balance injection', balance: 999 }]) {
      expect((await g(body)).status).toBe(400);
    }
    // No idempotency key: refused.
    const noKey = await grantRoute(req(`/api/admin/users/${p.userId}/grant`, { method: 'POST', token: owner.token, body: { amount: 100, reason: 'Missing key test' } }), params({ userId: p.userId }));
    expect(noKey.status).toBe(400);
    expect(await balance(p.userId)).toBe(1_000_000);
  });

  it('public registration cannot ask for a role', async () => {
    const res = await registerRoute(
      req('/api/auth/register', { method: 'POST', body: { email: `role${Date.now()}@example.test`, username: `role${Date.now().toString(36)}`, password: 'correct horse battery staple', ageConfirmed: true, termsAccepted: true, role: 'OWNER' } }),
      params({}),
    );
    expect(res.status).toBe(400);
  });
});

describe('roles and the owner', () => {
  it('only owners grant admin/owner; staff never act on peers or superiors; changes are audited with the actor role', async () => {
    const owner = await staff('OWNER');
    const admin = await staff('ADMIN');
    const p = await newPlayer('rl');
    expect(code(await setUserRole(admin.ctx, p.userId, 'ADMIN', 'Admin tries to make an admin').catch((e) => e))).toBe('FORBIDDEN');
    await setUserRole(admin.ctx, p.userId, 'SUPPORT', 'Promote to moderator');
    expect(code(await setUserRole(admin.ctx, owner.userId, 'PLAYER', 'Admin tries to demote owner').catch((e) => e))).toBe('FORBIDDEN');
    expect(code(await setUserStatus(admin.ctx, owner.userId, 'SUSPENDED', 'Admin tries to suspend owner').catch((e) => e))).toBe('FORBIDDEN');
    const other = await staff('ADMIN');
    expect(code(await setUserStatus(admin.ctx, other.userId, 'SUSPENDED', 'Admin suspends a peer').catch((e) => e))).toBe('FORBIDDEN');
    await setUserRole(owner.ctx, p.userId, 'ADMIN', 'Owner appoints an admin');
    const [row] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.actorId, owner.userId), eq(auditLogs.action, 'user.role'))).orderBy(sql`${auditLogs.id} desc`).limit(1);
    expect(row).toMatchObject({ actorRole: 'OWNER', outcome: 'SUCCESS', resourceId: p.userId });
    expect(row!.after).toMatchObject({ role: 'ADMIN' });
    expect(code(await setUserRole(owner.ctx, p.userId, 'ADMIN', 'Same role again').catch((e) => e))).toBe('CONFLICT');
    expect(code(await setUserRole(owner.ctx, owner.userId, 'PLAYER', 'Self demotion').catch((e) => e))).toBe('CONFLICT');
  });

  it('the last active owner cannot be demoted, suspended or deleted; concurrent demotions leave one owner', async () => {
    const a = await staff('OWNER');
    const b = await staff('OWNER');
    await onlyOwner(a.userId);
    await getDb().update(users).set({ role: 'OWNER' }).where(eq(users.id, b.userId));
    // Each owner tries to demote the other at the same time: row locks serialise them.
    const results = await Promise.allSettled([
      setUserRole(a.ctx, b.userId, 'ADMIN', 'Concurrent demotion A'),
      setUserRole(b.ctx, a.userId, 'ADMIN', 'Concurrent demotion B'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const owners = await getDb().select().from(users).where(and(eq(users.role, 'OWNER'), eq(users.status, 'ACTIVE')));
    expect(owners).toHaveLength(1);
    const last = owners[0]!;
    // The database refuses it too, whatever the caller.
    await expect(getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, last.id))).rejects.toThrow();
    await expect(getDb().update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, last.id))).rejects.toThrow();
    expect(code(await deleteAccount(last.id, 'correct horse battery staple', meta).catch((e) => e))).toBe('CONFLICT');
  });

  it('owner provisioning promotes an existing account, refuses while an owner exists (unless break-glass) and is audited', async () => {
    const p = await newPlayer('prov');
    expect(code(await provisionOwner({ email: 'nobody-here@example.test', reason: 'Initial owner' }).catch((e) => e))).toBe('NOT_FOUND');
    await staff('OWNER'); // an owner exists
    expect(code(await provisionOwner({ email: p.email, reason: 'Initial owner' }).catch((e) => e))).toBe('CONFLICT');
    const res = await provisionOwner({ email: p.email, reason: 'Recovery: owners lost access', allowAdditional: true });
    expect(res).toMatchObject({ userId: p.userId, previousRole: 'PLAYER', breakGlass: true });
    expect(await resolveSession(p.token)).toBeNull(); // signed out to pick up the new role
    const [row] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.action, 'owner.provisioned'), eq(auditLogs.resourceId, p.userId)));
    expect(row).toMatchObject({ actorType: 'SYSTEM', reason: 'Recovery: owners lost access' });
    expect(code(await provisionOwner({ email: p.email, reason: 'Again', allowAdditional: true }).catch((e) => e))).toBe('CONFLICT');
  });
});

describe('account suspension is enforced on the server', () => {
  it('a suspended account cannot sign in, keep sessions, play, predict or claim chips; reinstatement restores access', async () => {
    const mod = await staff('SUPPORT');
    const p = await newPlayer('sus');
    await setUserStatus(mod.ctx, p.userId, 'SUSPENDED', 'Suspicious activity review');
    expect(await resolveSession(p.token)).toBeNull();
    expect(code(await login(p.email, 'correct horse battery staple', meta).catch((e) => e))).toBe('FORBIDDEN');
    expect(code(await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 4950, direction: 'under' }, idempotencyKey: key() }).catch((e) => e))).toBe('UNAUTHENTICATED');
    await ensureDemoFixtures(new Date());
    const ev = (await listEvents()).upcoming.find((e) => e.open && e.market);
    const sel = ev!.market!.selections[0]!;
    expect(code(await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: sel.id, stake: 100, oddsE2: sel.oddsE2 }] } }).catch((e) => e))).toBe('FORBIDDEN');
    expect(code(await claimDailyBonus(p.userId).catch((e) => e))).toBe('FORBIDDEN');
    expect(code(await setUserStatus(mod.ctx, p.userId, 'SUSPENDED', 'Suspend twice').catch((e) => e))).toBe('CONFLICT');
    await setUserStatus(mod.ctx, p.userId, 'ACTIVE', 'Review completed');
    expect((await login(p.email, 'correct horse battery staple', meta)).user.id).toBe(p.userId);
    const actions = await getDb().select().from(adminActions).where(and(eq(adminActions.targetId, p.userId), eq(adminActions.adminId, mod.userId)));
    expect(actions.map((a) => a.action).sort()).toEqual(['user.reinstated', 'user.suspended']);
  });

  it('signing out everywhere revokes sessions without suspending', async () => {
    const admin = await staff('ADMIN');
    const p = await newPlayer('rev');
    expect((await revokeUserSessions(admin.ctx, p.userId, 'Suspected compromise')).revoked).toBe(1);
    expect(await resolveSession(p.token)).toBeNull();
    expect((await login(p.email, 'correct horse battery staple', meta)).user.id).toBe(p.userId);
  });

  it('user search filters, masks e-mail without users:pii and never returns secrets', async () => {
    const p = await newPlayer('srch');
    const withPii = await listUsers({ q: p.email, canSeePii: true });
    expect(withPii.rows.map((r) => r.id)).toContain(p.userId);
    const withoutPii = await listUsers({ q: p.email, canSeePii: false });
    expect(withoutPii.rows.map((r) => r.id)).not.toContain(p.userId); // e-mail is not searchable either
    const byName = await listUsers({ q: p.email.split('@')[0]!, canSeePii: false, status: 'ACTIVE', role: 'PLAYER' });
    expect(byName.rows[0]!.email).toMatch(/•••/);
    expect(byName.rows[0]!.balance).toBe(1_000_000);
    const wildcard = await listUsers({ q: '%', canSeePii: true, pageSize: 5 });
    expect(wildcard.rows.every((r) => r.username.includes('%') || r.email.includes('%'))).toBe(true);
    const auditor = await staff('AUDITOR');
    expect(auditor.userId).toBeTruthy();
    const d = await userDetail(p.userId, { role: 'AUDITOR' });
    expect(d.user.email).toMatch(/•••/);
    expect(JSON.stringify(d)).not.toMatch(/password|token_hash|tokenHash|secret/i);
    expect(d.allowed).toMatchObject({ changeStatus: false, grant: false, adjust: false, roles: [] });
  });
});

describe('virtual chip grants and corrections', () => {
  it('a grant posts one CHIP_GRANT with its audited action; retries replay; reuse with other data is refused', async () => {
    const owner = await staff('OWNER');
    const p = await newPlayer('gr');
    const k = key();
    const first = await grantChips(owner.ctx, p.userId, 25_000, 'Test chips for QA session', k);
    expect(first.body.balance).toBe(1_025_000);
    const again = await grantChips(owner.ctx, p.userId, 25_000, 'Test chips for QA session', k);
    expect(again).toMatchObject({ replayed: true, body: first.body });
    expect(code(await grantChips(owner.ctx, p.userId, 30_000, 'Test chips for QA session', k).catch((e) => e))).toBe('IDEMPOTENCY_CONFLICT');
    expect(await balance(p.userId)).toBe(1_025_000);
    const txs = await getDb().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.userId, p.userId), eq(ledgerTransactions.type, 'CHIP_GRANT')));
    expect(txs).toHaveLength(1);
    expect(txs[0]!.actorId).toBe(owner.userId);
    const [act] = await getDb().select().from(adminActions).where(and(eq(adminActions.targetId, p.userId), eq(adminActions.action, 'ledger.grant')));
    expect(act!.after).toMatchObject({ amount: 25_000, transactionId: txs[0]!.id, balance: 1_025_000 });
    await expectLedgerConsistent();
  });

  it('grants are refused for admins, suspended accounts, invalid amounts and above the balance cap', async () => {
    const owner = await staff('OWNER');
    const admin = await staff('ADMIN');
    const p = await newPlayer('grr');
    expect(code(await grantChips(admin.ctx, p.userId, 100, 'Admin tries to grant', key()).catch((e) => e))).toBe('FORBIDDEN');
    for (const amount of [0, -1, 0.5, MAX_GRANT + 1]) {
      expect(code(await grantChips(owner.ctx, p.userId, amount, 'Invalid amount', key()).catch((e) => e))).toBe('VALIDATION_ERROR');
    }
    const [settings] = await getDb().select().from(platformSettings);
    await setPlatform({ maxPlayerBalance: 1_000_500 });
    try {
      expect(code(await grantChips(owner.ctx, p.userId, 1_000, 'Over the balance cap', key()).catch((e) => e))).toBe('VALIDATION_ERROR');
      expect((await grantChips(owner.ctx, p.userId, 500, 'Exactly up to the cap', key())).body.balance).toBe(1_000_500);
    } finally {
      await setPlatform({ maxPlayerBalance: settings!.maxPlayerBalance });
    }
    await getDb().update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, p.userId));
    expect(code(await grantChips(owner.ctx, p.userId, 100, 'Suspended target', key()).catch((e) => e))).toBe('CONFLICT');
    await getDb().update(users).set({ status: 'ACTIVE' }).where(eq(users.id, p.userId));
    expect(await balance(p.userId)).toBe(1_000_500);
  });

  it('concurrent grants under different keys are all applied exactly; a failure rolls the whole grant back', async () => {
    const owner = await staff('OWNER');
    const p = await newPlayer('grc');
    await Promise.all(Array.from({ length: 6 }, (_, i) => grantChips(owner.ctx, p.userId, 1_000 + i, `Concurrent grant ${i}`, key())));
    expect(await balance(p.userId)).toBe(1_000_000 + 6 * 1_000 + 15);
    // The audit row is written after the ledger posting in the same transaction: a reason the
    // database refuses (shorter than 5 characters) must undo the posting and release the key.
    const k = key();
    await expect(grantChips(owner.ctx, p.userId, 500, 'no', k)).rejects.toThrow();
    expect(await balance(p.userId)).toBe(1_000_000 + 6 * 1_000 + 15);
    const res = await grantChips(owner.ctx, p.userId, 500, 'Retried with a proper reason', k);
    expect(res.replayed).toBe(false);
    await expectLedgerConsistent();
  });

  it('corrections cannot make a wallet negative; reconciliation flags a grant without its audited action', async () => {
    const admin = await staff('ADMIN');
    const owner = await staff('OWNER');
    const p = await newPlayer('adj2');
    expect(code(await adjustBalance(admin.ctx, p.userId, -2_000_000, 'Overdraw attempt test', key()).catch((e) => e))).toBe('INSUFFICIENT_FUNDS');
    const g = await grantChips(owner.ctx, p.userId, 700, 'Grant to tamper with', key());
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      expect((await runChecksWith(client)).filter((c) => c.mismatches > 0)).toEqual([]);
      await client.query('ALTER TABLE admin_actions DISABLE TRIGGER admin_actions_append_only');
      await client.query(`DELETE FROM admin_actions WHERE action = 'ledger.grant' AND (after->>'transactionId')::bigint = $1`, [g.body.transactionId]);
      const flagged = (await runChecksWith(client)).filter((c) => c.mismatches > 0).map((c) => c.name);
      expect(flagged).toContain('admin_money_movements_audited');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await expectLedgerConsistent();
  });

  it('house funding is owner-only', async () => {
    const admin = await staff('ADMIN');
    expect(code(await fundHouse(admin.ctx, 100, 'Admin funds house', key()).catch((e) => e))).toBe('FORBIDDEN');
  });
});

describe('game administration', () => {
  it('limits are validated against hard bounds and enforced by the engine on every wager', async () => {
    const admin = await staff('ADMIN');
    expect(limitProblems({ minStake: 0, maxStake: 10, maxPayoutPerRound: 100, maxGameExposure: 1000 }, 10 ** 12)).toContain('The minimum stake must be at least 0.01 chip');
    expect(limitProblems({ minStake: 10, maxStake: 10, maxPayoutPerRound: 5, maxGameExposure: 1000 }, 10 ** 12).length).toBe(1);
    expect(code(await updateRiskLimits(admin.ctx, 'dice', { minStake: 10, maxStake: 100_000_000_00, maxPayoutPerRound: 100_000_000_00, maxGameExposure: 100_000_000_00 }, 'Absurd maximum').catch((e) => e))).toBe('VALIDATION_ERROR');
    await updateRiskLimits(admin.ctx, 'dice', { minStake: 10, maxStake: 500, maxPayoutPerRound: 100_000, maxGameExposure: 50_000_000_00 }, 'Lower dice maximum for test');
    const p = await newPlayer('lim');
    const over = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 600, target: 4950, direction: 'under' }, idempotencyKey: key() }).catch((e) => e);
    expect(code(over)).toBe('RISK_LIMIT');
    await updateRiskLimits(admin.ctx, 'dice', CATALOG.dice!.limits, 'Restore dice limits');
    expect(await balance(p.userId)).toBe(1_000_000);
  });

  it('maintenance needs confirmation when rounds are open; open rounds can finish, new ones are refused', async () => {
    const admin = await staff('ADMIN');
    const p = await newPlayer('mnt');
    const started = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 100, mines: 3 }, idempotencyKey: key() });
    expect(started.body.round.status).toBe('OPEN');
    const first = await setGameStatus(admin.ctx, 'mines', 'SUSPENDED', 'Maintenance window').catch((e) => e);
    expect(code(first)).toBe('CONFLICT');
    expect((first as AppError).details).toMatchObject({ needsConfirmation: true });
    try {
      expect(await setGameStatus(admin.ctx, 'mines', 'SUSPENDED', 'Maintenance window', { confirmOpenRounds: true })).toMatchObject({ status: 'SUSPENDED' });
      expect(code(await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 4950, direction: 'under' }, idempotencyKey: key() }).then(() => null).catch((e) => e))).not.toBe('GAME_UNAVAILABLE');
      const other = await newPlayer('mnt2');
      expect(code(await startRound({ userId: other.userId, gameId: 'mines', bet: { amount: 100, mines: 3 }, idempotencyKey: key() }).catch((e) => e))).toBe('GAME_UNAVAILABLE');
      const done = await actOnRound({ userId: p.userId, roundId: started.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() }).catch((e) => e);
      // Cashing out with no reveal is a rule error in Mines; revealing works instead.
      if (code(done) === 'GAME_RULE') {
        const r = await actOnRound({ userId: p.userId, roundId: started.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() });
        expect(r.body.round.id).toBe(started.body.round.id);
      }
    } finally {
      await setGameStatus(admin.ctx, 'mines', 'ACTIVE', 'Maintenance finished');
    }
  });

  it('a client cannot supply an outcome: extra fields in a wager are rejected', async () => {
    const p = await newPlayer('cli');
    expect(code(await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 4950, direction: 'under', roll: 0 }, idempotencyKey: key() }).catch((e) => e))).toBe('VALIDATION_ERROR');
    const owner = await staff('OWNER');
    const ev = (await listEvents()).upcoming[0]!;
    const res = await eventRoute(req(`/api/admin/sports/events/${ev.id}`, { method: 'POST', token: owner.token, body: { action: 'result', home: 1, away: 0, winner: 'HOME', payout: 10, reason: 'Client-chosen winner' } }), params({ eventId: ev.id }));
    expect(res.status).toBe(400);
  });
});

describe('sports operations', () => {
  beforeAll(async () => {
    await ensureDemoFixtures(new Date());
  });

  /** A fixture of this test's own (shared demo events are used by other test files). */
  let slot = 0;
  async function ownEvent(minutesAhead: number) {
    slot += 1;
    const ops = await staff('RISK_MANAGER');
    const { DEMO_COMPETITIONS } = await import('@/engine/sports/demo-data');
    const comp = DEMO_COMPETITIONS[slot % DEMO_COMPETITIONS.length]!;
    const kickoffAt = new Date(Date.now() + minutesAhead * 60_000 + slot * 1_000 + randomInt(1_000));
    const { eventId } = await adminCreateDemoFixture(ops.ctx, { competitionId: comp.id, homeId: comp.teams[0]!, awayId: comp.teams[1]! , kickoffAt }, 'Fixture for an isolated test');
    return getEvent(eventId);
  }

  it('the prediction window is validated and enforced at placement', async () => {
    const ops = await staff('RISK_MANAGER');
    const e = await ownEvent(120);
    const kickoff = new Date(e.kickoffAt);
    expect(code(await adminSetMarketWindow(ops.ctx, e.id, { opensAt: null, closesAt: new Date(kickoff.getTime() + 60_000) }, 'Close after kick-off').catch((x) => x))).toBe('VALIDATION_ERROR');
    expect(code(await adminSetMarketWindow(ops.ctx, e.id, { opensAt: null, closesAt: new Date(Date.now() - 60_000) }, 'Close in the past').catch((x) => x))).toBe('VALIDATION_ERROR');
    const closesAt = new Date(kickoff.getTime() - 10 * 60_000);
    await adminSetMarketWindow(ops.ctx, e.id, { opensAt: null, closesAt }, 'Close predictions early');
    const p = await newPlayer('win');
    const sel = e.market!.selections[0]!;
    const late = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: sel.id, stake: 100, oddsE2: sel.oddsE2 }] }, now: new Date(closesAt.getTime() + 60_000) });
    expect(late.body.tickets[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'Predictions on this market have closed' });
    await adminSetMarketWindow(ops.ctx, e.id, { opensAt: new Date(Date.now() + 30 * 60_000), closesAt: null }, 'Open later');
    const early = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: sel.id, stake: 100, oddsE2: sel.oddsE2 }] } });
    expect(early.body.tickets[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'Predictions on this market have not opened yet' });
    await adminSetMarketWindow(ops.ctx, e.id, { opensAt: null, closesAt: null }, 'Default window');
    const ok = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: sel.id, stake: 100, oddsE2: sel.oddsE2 }] } });
    expect(ok.body.tickets[0]!.status).toBe('ACCEPTED');
    expect(await balance(p.userId)).toBe(1_000_000 - 100);
    const actions = await getDb().select().from(adminActions).where(and(eq(adminActions.targetId, e.id), eq(adminActions.action, 'sports.window')));
    expect(actions).toHaveLength(3);
  });

  it('the settlement preview matches what settlement credits; repeating a result settles nothing twice', async () => {
    const ops = await staff('RISK_MANAGER');
    const e = await ownEvent(30);
    const p = await newPlayer('prev');
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: e.market!.selections.map((s) => ({ selectionId: s.id, stake: 1_000, oddsE2: s.oddsE2 })) } });
    await getDb().update(sportsEvents).set({ kickoffAt: new Date(Date.now() - 15 * 60_000) }).where(eq(sportsEvents.id, e.id));
    await getDb().update(sportsMarkets).set({ status: 'CLOSED' }).where(eq(sportsMarkets.eventId, e.id));
    const before = await balance(p.userId);
    const preview = await previewSettlement(e.id, { kind: 'RESULT', home: 2, away: 1 });
    expect(preview).toMatchObject({ tickets: 3, won: 1, lost: 2, voided: 0, sameAsCurrent: false, isCorrection: false });
    const home = e.market!.selections.find((s) => s.code === 'HOME')!;
    expect(preview.credit).toBe(Math.floor((1_000 * home.oddsE2!) / 100));
    await adminCorrectResult(ops.ctx, e.id, 2, 1, 'Result from the operator');
    expect(await balance(p.userId)).toBe(before + preview.credit);
    expect((await previewSettlement(e.id, { kind: 'RESULT', home: 2, away: 1 })).sameAsCurrent).toBe(true);
    expect(await adminCorrectResult(ops.ctx, e.id, 2, 1, 'Same result again')).toMatchObject({ changed: false, settled: 0 });
    // A correction to a draw credits the draw ticket, takes nothing back.
    const corr = await previewSettlement(e.id, { kind: 'RESULT', home: 1, away: 1 });
    const draw = e.market!.selections.find((s) => s.code === 'DRAW')!;
    expect(corr).toMatchObject({ isCorrection: true, credit: Math.floor((1_000 * draw.oddsE2!) / 100) });
    expect(code(await adminCorrectResult(ops.ctx, (await ownEvent(60)).id, 1, 0, 'Too early').catch((x) => x))).toBe('CONFLICT');
    await expectLedgerConsistent();
  });

  it('operators can schedule demo fixtures priced by the model, never with chosen odds', async () => {
    const ops = await staff('RISK_MANAGER');
    const kickoffAt = new Date(Date.now() + 3 * 3600_000 + 7 * 60_000);
    const { DEMO_COMPETITIONS } = await import('@/engine/sports/demo-data');
    const comp = DEMO_COMPETITIONS[0]!;
    const other = DEMO_COMPETITIONS[1]!;
    const tryCreate = (input: { competitionId: string; homeId: string; awayId: string; kickoffAt: Date }) => adminCreateDemoFixture(ops.ctx, input, 'Invalid fixture test').catch((x) => x);
    expect(code(await tryCreate({ competitionId: comp.id, homeId: comp.teams[0]!, awayId: comp.teams[0]!, kickoffAt }))).toBe('VALIDATION_ERROR');
    expect(code(await tryCreate({ competitionId: comp.id, homeId: comp.teams[0]!, awayId: other.teams[0]!, kickoffAt }))).toBe('VALIDATION_ERROR');
    expect(code(await tryCreate({ competitionId: 'real-premier-league', homeId: comp.teams[0]!, awayId: comp.teams[1]!, kickoffAt }))).toBe('VALIDATION_ERROR');
    expect(code(await tryCreate({ competitionId: comp.id, homeId: comp.teams[0]!, awayId: comp.teams[1]!, kickoffAt: new Date(Date.now() + 60_000) }))).toBe('VALIDATION_ERROR');
    const res = await adminCreateDemoFixture(ops.ctx, { competitionId: comp.id, homeId: comp.teams[0]!, awayId: comp.teams[1]!, kickoffAt }, 'Extra fixture for a demo');
    const [ev] = await getDb().select().from(sportsEvents).where(eq(sportsEvents.id, res.eventId));
    expect(ev).toMatchObject({ isDemo: true, status: 'SCHEDULED' });
    expect(ev!.seedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(code(await adminCreateDemoFixture(ops.ctx, { competitionId: comp.id, homeId: comp.teams[0]!, awayId: comp.teams[1]!, kickoffAt }, 'Duplicate fixture').catch((x) => x))).toBe('CONFLICT');
  });
});

describe('two-factor authentication', () => {
  const totpNow = (secret: string, offset = 0) => hotp(base32Decode(secret), timeStep() + offset);

  it('enrolment, two-step sign-in, replay protection and recovery codes', async () => {
    const p = await newPlayer('mfa');
    const session = (await resolveSession(p.token))!;
    const { secret } = await beginEnrollment(p.userId, p.email);
    expect(code(await confirmEnrollment(session, '000000', meta).catch((e) => e))).toBe('VALIDATION_ERROR');
    const { recoveryCodes } = await confirmEnrollment(session, totpNow(secret), meta);
    expect(recoveryCodes).toHaveLength(10);
    expect((await resolveSession(p.token))!.mfaVerifiedAt).not.toBeNull();

    const err = await login(p.email, 'correct horse battery staple', meta).catch((e) => e);
    expect(code(err)).toBe('MFA_REQUIRED');
    const challenge = (err as AppError).details!.challenge as string;
    // The code used to confirm enrolment cannot be used again.
    expect(code(await completeMfaLogin(challenge, totpNow(secret), meta).catch((e) => e))).toBe('UNAUTHENTICATED');
    const ok = await completeMfaLogin(challenge, totpNow(secret, 1), meta);
    expect((await resolveSession(ok.session.token))!.mfaVerifiedAt).not.toBeNull();
    // A recovery code works exactly once.
    const viaRecovery = await completeMfaLogin(challenge, recoveryCodes[0]!, meta);
    expect(viaRecovery.user.id).toBe(p.userId);
    expect(code(await completeMfaLogin(challenge, recoveryCodes[0]!, meta).catch((e) => e))).toBe('UNAUTHENTICATED');
    expect(code(await completeMfaLogin('forged.challenge', totpNow(secret), meta).catch((e) => e))).toBe('UNAUTHENTICATED');
    const failures = await getDb().select().from(auditLogs).where(and(eq(auditLogs.actorId, p.userId), eq(auditLogs.action, 'auth.mfa_failed')));
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(failures.every((f) => f.outcome === 'FAILED')).toBe(true);
  });

  it('the staff MFA policy needs the owner to use MFA first and then blocks unverified staff sessions', async () => {
    const owner = await staff('OWNER');
    const s0 = (await resolveSession(owner.token))!;
    expect(code(await setStaffMfaRequired(s0, true, 'Require MFA', meta).catch((e) => e))).toBe('CONFLICT');
    const { secret } = await beginEnrollment(owner.userId, owner.email);
    await confirmEnrollment(s0, totpNow(secret), meta);
    const s1 = (await resolveSession(owner.token))!;
    await setStaffMfaRequired(s1, true, 'Require MFA for staff', meta);
    try {
      const mod = await staff('SUPPORT');
      const modSession = (await resolveSession(mod.token))!;
      expect(await staffMfaBlocks(modSession)).toBe(true);
      expect(await staffMfaBlocks(s1)).toBe(false);
      const target = await newPlayer('mfat');
      const res = await statusRoute(req(`/api/admin/users/${target.userId}/status`, { method: 'POST', token: mod.token, body: { status: 'SUSPENDED', reason: 'Blocked by MFA policy' } }), params({ userId: target.userId }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.details).toMatchObject({ mfaRequired: true });
      // Enrolling and verifying unblocks the moderator.
      const { secret: modSecret } = await beginEnrollment(mod.userId, mod.email);
      await confirmEnrollment(modSession, totpNow(modSecret), meta);
      const ok = await statusRoute(req(`/api/admin/users/${target.userId}/status`, { method: 'POST', token: mod.token, body: { status: 'SUSPENDED', reason: 'After MFA verification' } }), params({ userId: target.userId }));
      expect(ok.status).toBe(200);
      expect(code(await verifySession(modSession, '123456', meta).catch((e) => e))).toBe('UNAUTHENTICATED');
    } finally {
      await setStaffMfaRequired((await resolveSession(owner.token))!, false, 'Policy off after test', meta);
    }
  });
});

describe('owner dashboard metrics', () => {
  it('reflect recorded activity in the period', async () => {
    await setPlatform({ newRoundsEnabled: true });
    const period = resolvePeriod({ period: 'today' });
    const before = await overviewMetrics({ from: period.from, to: new Date(Date.now() + 60_000) });
    const p = await newPlayer('ovw');
    const r = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 1_234, target: 4950, direction: 'under' }, idempotencyKey: key() });
    const after = await overviewMetrics({ from: period.from, to: new Date(Date.now() + 60_000) });
    expect(after.users.registered - before.users.registered).toBe(1);
    expect(after.users.newAccounts - before.users.newAccounts).toBe(1);
    expect(after.casino.rounds - before.casino.rounds).toBe(1);
    expect(after.casino.stake - before.casino.stake).toBe(1_234);
    expect(after.casino.payout - before.casino.payout).toBe(r.body.round.payout);
    expect(after.totals.houseNet - before.totals.houseNet).toBe(1_234 - r.body.round.payout!);
    expect(after.issued.bonuses - before.issued.bonuses).toBeGreaterThan(0); // the sign-up chips
    expect(after.daily.length).toBe(1);
  });
});
