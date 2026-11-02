import { describe, expect, it } from 'vitest';
import { levelFromXp, xpForLevel, XP } from '@/server/users/levels';
import { hasPermission } from '@/server/auth/rbac';

describe('levels (cosmetic)', () => {
  it('reaching level L+1 takes 50·L·(L+1) XP in total', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(10)).toBe(4_500);
    expect(levelFromXp(0)).toMatchObject({ level: 1, tier: 'Bronze', levelXp: 0, levelSpan: 100 });
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(4_500)).toMatchObject({ level: 10, tier: 'Gold' });
    expect(levelFromXp(xpForLevel(35)).tier).toBe('Diamond');
  });

  it('a day of play is worth at most 60 XP, however long the session', () => {
    expect(XP.perRound * XP.roundsPerDayCap).toBe(60);
  });
});

describe('promotions permission', () => {
  it('admins and owners manage campaigns; specialists and players do not', () => {
    expect(hasPermission('OWNER', 'promotions:manage')).toBe(true);
    expect(hasPermission('ADMIN', 'promotions:manage')).toBe(true);
    for (const r of ['SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'PLAYER'] as const) expect(hasPermission(r, 'promotions:manage')).toBe(false);
  });
});
