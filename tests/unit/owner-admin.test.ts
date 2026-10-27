import { describe, expect, it } from 'vitest';
import { assignableRoles, canManageUser, hasPermission, maskEmail, OWNER_ONLY, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '@/server/auth/rbac';
import { base32Decode, base32Encode, hotp, matchTotp, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUri, timeStep } from '@/server/auth/totp';
import { dateRange, resolvePeriod } from '@/server/admin/period';
import { predictionWindow } from '@/server/sports/config';
import { AppError } from '@/server/errors';

describe('role model', () => {
  it('owners hold every permission; admins everything except the owner-only set; players nothing', () => {
    for (const p of PERMISSIONS) expect(hasPermission('OWNER', p)).toBe(true);
    for (const p of OWNER_ONLY) expect(hasPermission('ADMIN', p)).toBe(false);
    for (const p of PERMISSIONS.filter((x) => !OWNER_ONLY.includes(x))) expect(hasPermission('ADMIN', p)).toBe(true);
    expect(ROLE_PERMISSIONS.PLAYER.size).toBe(0);
  });

  it('moderators (SUPPORT) read and suspend players but cannot manage roles, money, games or the audit log', () => {
    expect(hasPermission('SUPPORT', 'users:suspend')).toBe(true);
    expect(hasPermission('SUPPORT', 'users:pii')).toBe(true);
    for (const p of ['roles:manage', 'ledger:adjust', 'ledger:grant', 'games:manage', 'audit:read', 'house:fund', 'security:manage'] as const) {
      expect(hasPermission('SUPPORT', p)).toBe(false);
    }
    expect(hasPermission('AUDITOR', 'users:pii')).toBe(false);
    expect(hasPermission('RISK_MANAGER', 'users:pii')).toBe(false);
  });

  it('staff act only on lower-ranked accounts; owners may act on owners', () => {
    expect(canManageUser('SUPPORT', 'PLAYER')).toBe(true);
    expect(canManageUser('SUPPORT', 'SUPPORT')).toBe(false);
    expect(canManageUser('SUPPORT', 'ADMIN')).toBe(false);
    expect(canManageUser('ADMIN', 'AUDITOR')).toBe(true);
    expect(canManageUser('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageUser('ADMIN', 'OWNER')).toBe(false);
    expect(canManageUser('OWNER', 'OWNER')).toBe(true);
  });

  it('only owners can grant or remove admin and owner roles; nobody without roles:manage can assign anything', () => {
    expect(assignableRoles('OWNER', 'PLAYER')).toEqual([...ROLES]);
    expect(assignableRoles('ADMIN', 'PLAYER')).toEqual(['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR']);
    expect(assignableRoles('ADMIN', 'ADMIN')).toEqual([]);
    expect(assignableRoles('ADMIN', 'OWNER')).toEqual([]);
    expect(assignableRoles('SUPPORT', 'PLAYER')).toEqual([]);
    expect(assignableRoles('AUDITOR', 'PLAYER')).toEqual([]);
  });

  it('masks e-mail addresses for roles without users:pii', () => {
    expect(maskEmail('alice@example.com')).toBe('a•••@e•••.com');
    expect(maskEmail('x@y.z')).toBe('x•••@y•••.z');
    expect(maskEmail('broken')).toBe('•••');
  });
});

describe('TOTP (RFC 6238)', () => {
  const secret = Buffer.from('12345678901234567890');
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    for (const [t, code] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ] as const) {
      expect(hotp(secret, Math.floor(t / 30), 8)).toBe(code);
    }
  });

  it('accepts the current step and one step of drift, never an already-used step, never malformed input', () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32).equals(secret)).toBe(true);
    const at = 1_700_000_000_000;
    const step = timeStep(at);
    const code = hotp(secret, step);
    expect(matchTotp(b32, code, { at })).toBe(step);
    expect(matchTotp(b32, hotp(secret, step - 1), { at })).toBe(step - 1);
    expect(matchTotp(b32, hotp(secret, step - 2), { at })).toBeNull();
    expect(matchTotp(b32, code, { at, notAfterStep: step })).toBeNull();
    expect(matchTotp(b32, '12345', { at })).toBeNull();
    expect(matchTotp(b32, 'abcdef', { at })).toBeNull();
  });

  it('issues 160-bit secrets, distinct recovery codes and a standard otpauth URI', () => {
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(normaliseRecoveryCode(` ${codes[0]!.toUpperCase()} `)).toBe(codes[0]!.replace('-', ''));
    expect(otpauthUri('ABC', 'a@b.c')).toBe('otpauth://totp/Aurovane:a%40b.c?secret=ABC&issuer=Aurovane&algorithm=SHA1&digits=6&period=30');
  });
});

describe('reporting periods (UTC, half-open)', () => {
  const now = new Date('2026-10-27T15:30:00Z');
  it('resolves presets', () => {
    expect(resolvePeriod({ period: 'today' }, now)).toMatchObject({ from: new Date('2026-10-27T00:00:00Z'), to: now });
    expect(resolvePeriod({ period: '7d' }, now).from).toEqual(new Date('2026-10-20T15:30:00Z'));
    expect(resolvePeriod({ period: '30d' }, now).from).toEqual(new Date('2026-09-27T15:30:00Z'));
    expect(resolvePeriod({}, now).key).toBe('7d');
  });

  it('custom ranges include both dates and reject invalid input', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-03' }, now);
    expect(p.from).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(p.to).toEqual(new Date('2026-10-04T00:00:00Z'));
    for (const bad of [
      { from: '2026-10-05', to: '2026-10-01' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: 'yesterday', to: '2026-10-01' },
      { from: '2024-01-01', to: '2026-01-01' },
      { from: '2027-01-01', to: '2027-01-02' },
    ]) {
      expect(() => resolvePeriod({ period: 'custom', ...bad }, now)).toThrow(AppError);
    }
    expect(dateRange({})).toEqual({ from: undefined, to: undefined });
    expect(dateRange({ to: '2026-10-01' }).to).toEqual(new Date('2026-10-02T00:00:00Z'));
  });
});

describe('prediction window', () => {
  const kickoff = new Date('2026-10-27T18:00:00Z');
  it('closes at the earlier of the operator close and kick-off; opens at the operator time', () => {
    expect(predictionWindow({ opensAt: null, closesAt: null }, kickoff, new Date('2026-10-27T17:00:00Z')).state).toBe('open');
    expect(predictionWindow({ opensAt: null, closesAt: null }, kickoff, kickoff).state).toBe('closed');
    const early = new Date('2026-10-27T16:00:00Z');
    expect(predictionWindow({ opensAt: null, closesAt: early }, kickoff, new Date('2026-10-27T16:30:00Z')).state).toBe('closed');
    expect(predictionWindow({ opensAt: null, closesAt: new Date('2026-10-28T00:00:00Z') }, kickoff, new Date('2026-10-27T17:00:00Z')).closesAt).toEqual(kickoff);
    expect(predictionWindow({ opensAt: new Date('2026-10-27T12:00:00Z'), closesAt: null }, kickoff, new Date('2026-10-27T11:00:00Z')).state).toBe('not_open');
  });
});
