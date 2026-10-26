import { describe, expect, it } from 'vitest';
import { planSeed, PUBLISHED_PASSWORDS, UnsafeSeedError } from '../../scripts/seed-plan';

const local = { NODE_ENV: 'development', APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://u:p@localhost:5432/casino_dev' };

describe('db:seed safety', () => {
  it('refuses production', () => {
    expect(() => planSeed({ ...local, NODE_ENV: 'production' })).toThrow(UnsafeSeedError);
  });

  it('refuses a public APP_URL and a remote database', () => {
    expect(() => planSeed({ ...local, APP_URL: 'https://casino.example.com' })).toThrow(/non-local APP_URL/);
    expect(() => planSeed({ ...local, DATABASE_URL: 'postgresql://u:p@db.internal.example.com/casino' })).toThrow(/non-local database/);
    expect(planSeed({ ...local, DATABASE_URL: 'postgresql://u:p@db.internal.example.com/casino', SEED_ALLOW_NON_LOCAL_DATABASE: 'true' })).toHaveLength(5);
    expect(planSeed({ ...local, DATABASE_URL: 'postgresql://u:p@db:5432/casino' })).toHaveLength(5); // Compose service
  });

  it('has no built-in password: generates a distinct random password per account', () => {
    const a = planSeed(local);
    const b = planSeed(local);
    expect(a.every((x) => x.generated && x.password.length >= 24)).toBe(true);
    expect(new Set(a.map((x) => x.password)).size).toBe(a.length);
    expect(a.map((x) => x.password)).not.toEqual(b.map((x) => x.password));
    expect(a.some((x) => PUBLISHED_PASSWORDS.includes(x.password))).toBe(false);
  });

  it('uses explicitly supplied passwords but rejects published, short or reused ones', () => {
    const plan = planSeed({ ...local, SEED_ADMIN_PASSWORD: 'Local-Admin-Only-77', SEED_PLAYER_PASSWORD: 'Local-Player-Only-88' });
    expect(plan.find((x) => x.role === 'ADMIN')).toMatchObject({ password: 'Local-Admin-Only-77', generated: false });
    expect(plan.find((x) => x.role === 'AUDITOR')!.generated).toBe(true);
    expect(() => planSeed({ ...local, SEED_ADMIN_PASSWORD: 'Velvet-Table-Seed-2026' })).toThrow(/published/);
    expect(() => planSeed({ ...local, SEED_ADMIN_PASSWORD: 'short' })).toThrow(/12 characters/);
    expect(() => planSeed({ ...local, SEED_ADMIN_PASSWORD: 'Same-Password-123', SEED_SUPPORT_PASSWORD: 'Same-Password-123' })).toThrow(/must all differ/);
  });
});
