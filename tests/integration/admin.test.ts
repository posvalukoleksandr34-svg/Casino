import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adjustBalance, fundHouse, publishGameConfig, setGameStatus, setUserRole, setUserStatus, updateRiskLimits } from '@/server/admin/admin-service';
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

  it('config publishing creates a new immutable version and refuses a non-positive house edge', async () => {
    const ctx = await adminCtx();
    const res = await publishGameConfig(ctx, 'dice', { houseEdgeBp: 150, minWinCount: 100, maxWinCount: 9800 }, 'Raise edge for test');
    expect(res.theoretical.houseEdge).toBeCloseTo(0.015, 10);
    await expect(publishGameConfig(ctx, 'dice', { houseEdgeBp: 0, minWinCount: 100, maxWinCount: 9800 }, 'zero edge attempt')).rejects.toBeInstanceOf(AppError);
    const versions = await getDb().select().from(gameConfigurations).where(eq(gameConfigurations.gameId, 'dice'));
    expect(versions.filter((v) => v.isActive)).toHaveLength(1);
    await publishGameConfig(ctx, 'dice', { houseEdgeBp: 100, minWinCount: 100, maxWinCount: 9800 }, 'Restore default edge');
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
    await adjustBalance(ctx, p.userId, 12_345, 'Goodwill correction after incident', k);
    await expect(adjustBalance(ctx, p.userId, 12_345, 'Goodwill correction after incident', k)).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'CONFLICT');
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

  it('house funding issues virtual chips through the ledger', async () => {
    const ctx = await adminCtx();
    const res = await fundHouse(ctx, 1_000_00, 'Top up reserve for test', key());
    expect(res.balance).toBeGreaterThan(0);
    await expectLedgerConsistent();
  });
});
