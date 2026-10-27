import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fundHouse, publishGameConfig, setGameStatus, updateRiskLimits } from '@/server/admin/admin-service';
import { setUserRole, setUserStatus } from '@/server/admin/users';
import { adjustBalance } from '@/server/admin/wallet';
import { hasPermission, ROLE_PERMISSIONS } from '@/server/auth/rbac';
import { resolveSession } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { adminActions, auditLogs, gameConfigurations, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { listTransactions } from '@/server/wallet/wallet';
import { CATALOG } from '@/server/games/catalog';
import { expectLedgerConsistent, key, newPlayer, setGameStatus as rawSetGameStatus } from './helpers';

async function adminCtx() {
  const a = await newPlayer('adm');
  await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.userId));
  return { adminId: a.userId, ipHash: null, requestId: key() };
}

describe('RBAC', () => {
  it('players have no admin permissions; only ADMIN can adjust balances or manage roles', () => {
    expect(ROLE_PERMISSIONS.PLAYER.size).toBe(0);
    for (const role of ['SUPPORT', 'RISK_MANAGER', 'AUDITOR'] as const) {
      expect(hasPermission(role, 'ledger:adjust')).toBe(false);
      expect(hasPermission(role, 'roles:manage')).toBe(false);
      expect(hasPermission(role, 'admin:access')).toBe(true);
    }
    expect(hasPermission('ADMIN', 'ledger:adjust')).toBe(true);
    expect(hasPermission('AUDITOR', 'audit:read')).toBe(true);
    expect(hasPermission('SUPPORT', 'audit:read')).toBe(false);
    expect(hasPermission('RISK_MANAGER', 'risk:manage')).toBe(true);
  });
});

describe('audited admin actions', () => {
  it('game status change is recorded with before/after and reason', async () => {
    const ctx = await adminCtx();
    await setGameStatus(ctx, 'dice', 'SUSPENDED', 'Incident #1: testing suspension');
    const [action] = await getDb()
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.adminId, ctx.adminId), eq(adminActions.action, 'game.status')));
    expect(action!.before).toMatchObject({ status: 'ACTIVE' });
    expect(action!.after).toMatchObject({ status: 'SUSPENDED' });
    expect(action!.reason).toContain('Incident #1');
    const [log] = await getDb().select().from(auditLogs).where(eq(auditLogs.id, action!.auditLogId));
    expect(log!.actorId).toBe(ctx.adminId);
    await rawSetGameStatus('dice', 'ACTIVE');
  });

  it('config publishing only accepts the published reference configuration (rules shown to players cannot drift)', async () => {
    const ctx = await adminCtx();
    const code = (e: unknown) => (e instanceof AppError ? e.code : null);
    // A different edge, a zero edge and malformed config are all refused; nothing changes.
    expect(code(await publishGameConfig(ctx, 'dice', { houseEdgeBp: 150, minWinCount: 100, maxWinCount: 9800 }, 'Raise edge for test').catch((e) => e))).toBe('VALIDATION_ERROR');
    expect(code(await publishGameConfig(ctx, 'dice', { houseEdgeBp: 0, minWinCount: 100, maxWinCount: 9800 }, 'zero edge attempt').catch((e) => e))).toBe('VALIDATION_ERROR');
    expect(code(await publishGameConfig(ctx, 'dice', { houseEdgeBp: 'x' }, 'malformed config').catch((e) => e))).toBe('VALIDATION_ERROR');
    // Re-publishing the active reference is a no-op conflict.
    expect(code(await publishGameConfig(ctx, 'dice', { houseEdgeBp: 100, minWinCount: 100, maxWinCount: 9800 }, 'Same as active').catch((e) => e))).toBe('CONFLICT');
    const versions = await getDb().select().from(gameConfigurations).where(eq(gameConfigurations.gameId, 'dice'));
    expect(versions.filter((v) => v.isActive)).toHaveLength(1);
    expect(versions).toHaveLength(1);
  });

  it('risk limits update is audited', async () => {
    const ctx = await adminCtx();
    await updateRiskLimits(ctx, 'roulette', { ...CATALOG.roulette!.limits, maxStake: 5_000_00 }, 'Lower table max');
    await updateRiskLimits(ctx, 'roulette', CATALOG.roulette!.limits, 'Restore table max');
    const rows = await getDb().select().from(adminActions).where(and(eq(adminActions.adminId, ctx.adminId), eq(adminActions.action, 'risk.limits_updated')));
    expect(rows).toHaveLength(2);
  });

  it('balance corrections are compensating ledger entries visible to the player, exactly once per key', async () => {
    const ctx = await adminCtx();
    const p = await newPlayer('adj');
    const before = (await getWalletAccount(getDb(), p.userId))!.balance;
    const k = key();
    const first = await adjustBalance(ctx, p.userId, 12_345, 'Goodwill correction after incident', k);
    // A retry with the same key replays the original answer and posts nothing.
    const retry = await adjustBalance(ctx, p.userId, 12_345, 'Goodwill correction after incident', k);
    expect(retry).toMatchObject({ replayed: true, body: first.body });
    // The same key with a different request is refused.
    await expect(adjustBalance(ctx, p.userId, 999, 'Goodwill correction after incident', k)).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'IDEMPOTENCY_CONFLICT');
    expect((await getWalletAccount(getDb(), p.userId))!.balance).toBe(before + 12_345);
    const tx = await listTransactions(p.userId, { limit: 1 });
    expect(tx[0]!.type).toBe('ADJUSTMENT');
    expect(tx[0]!.description).toContain('Goodwill correction');
    await expect(adjustBalance(ctx, p.userId, -(before + 1_000_000), 'Overdraw attempt test', key())).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'INSUFFICIENT_FUNDS');
    await expectLedgerConsistent();
  });

  it('suspension revokes sessions; admins cannot change their own role or status', async () => {
    const ctx = await adminCtx();
    const p = await newPlayer('sus');
    await setUserStatus(ctx, p.userId, 'SUSPENDED', 'Suspicious activity review');
    expect(await resolveSession(p.token)).toBeNull();
    await setUserStatus(ctx, p.userId, 'ACTIVE', 'Review completed');
    await expect(setUserRole(ctx, ctx.adminId, 'PLAYER', 'self demotion test')).rejects.toBeInstanceOf(AppError);
    await expect(setUserStatus(ctx, ctx.adminId, 'SUSPENDED', 'self suspend test')).rejects.toBeInstanceOf(AppError);
  });

  it('house funding (owner only) issues virtual chips through the ledger', async () => {
    const admin = await adminCtx();
    await expect(fundHouse(admin, 1_000_00, 'Admin may not fund the house', key())).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'FORBIDDEN');
    const o = await newPlayer('own');
    await getDb().update(users).set({ role: 'OWNER' }).where(eq(users.id, o.userId));
    const res = await fundHouse({ adminId: o.userId, ipHash: null, requestId: key() }, 1_000_00, 'Top up reserve for test', key());
    expect(res.body.balance).toBeGreaterThan(0);
    await expectLedgerConsistent();
  });
});
