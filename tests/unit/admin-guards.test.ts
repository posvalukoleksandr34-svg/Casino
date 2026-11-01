import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/server/auth/rbac';

function walk(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p, name) : e === name ? [p] : [];
  });
}

describe('admin access control is declared on every entry point', () => {
  it('every admin page checks a permission itself (layouts alone are not sufficient)', () => {
    const pages = walk('src/app/admin', 'page.tsx');
    expect(pages.length).toBeGreaterThan(10);
    for (const p of pages) expect(readFileSync(p, 'utf8'), p).toMatch(/requirePermission\('[a-z:]+'(, \{[^}]*\})?\)/);
  });

  it('every admin API handler requires a staff permission (never public or plain user)', () => {
    const routes = walk('src/app/api/admin', 'route.ts');
    expect(routes.length).toBeGreaterThan(15);
    for (const r of routes) {
      const src = readFileSync(r, 'utf8');
      const handlers = src.match(/export const (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
      const auths = [...src.matchAll(/auth: '([^']+)'/g)].map((m) => m[1]);
      expect(handlers.length, r).toBeGreaterThan(0);
      expect(auths.length, `${r}: each handler declares auth`).toBe(handlers.length);
      for (const a of auths) expect(PERMISSIONS as readonly string[], `${r}: ${a}`).toContain(a);
    }
  });
});

describe('four-eyes operations cannot be executed directly over HTTP', () => {
  it('correction, house-funding and MFA-policy routes create approval requests instead of executing', () => {
    const adjust = readFileSync('src/app/api/admin/users/[userId]/adjust/route.ts', 'utf8');
    const fund = readFileSync('src/app/api/admin/house/fund/route.ts', 'utf8');
    const security = readFileSync('src/app/api/admin/security/route.ts', 'utf8');
    const grant = readFileSync('src/app/api/admin/users/[userId]/grant/route.ts', 'utf8');
    expect(adjust).not.toMatch(/adjustBalance|executeAdjustment/);
    expect(adjust).toContain("action: 'ledger.adjustment'");
    expect(fund).not.toMatch(/fundHouse|executeHouseFunding/);
    expect(fund).toContain("action: 'house.fund'");
    expect(security).toMatch(/setStaffMfaRequired\(ctx\.session, true,/);
    expect(security).toContain("action: 'security.staff_mfa_disable'");
    expect(grant).toMatch(/GRANT_APPROVAL_THRESHOLD/);
    // No other route may call the executors.
    for (const r of walk('src/app/api', 'route.ts')) {
      const src = readFileSync(r, 'utf8');
      expect(src, r).not.toMatch(/\b(adjustBalance|fundHouse|executeAdjustment|executeHouseFunding|executeGrant|applyStaffMfaPolicy)\(/);
    }
  });
});
