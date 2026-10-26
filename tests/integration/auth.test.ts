import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { resolveSession } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { gameRounds, ledgerTransactions, passwordResetTokens, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { changePassword, deleteAccount, exportUserData, login, register, requestPasswordReset, resetPassword } from '@/server/users/accounts';
import { startRound } from '@/server/games/round-service';
import { sha256Hex } from '@/server/crypto';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const meta = { ipHash: null, userAgent: 'vitest' };
const PASSWORD = 'correct horse battery staple';
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

describe('registration', () => {
  it('creates user, wallet with welcome chips, seed pair and a working session', async () => {
    const p = await newPlayer('reg');
    expect((await getWalletAccount(getDb(), p.userId))!.balance).toBe(1_000_000);
    const session = await resolveSession(p.token);
    expect(session?.userId).toBe(p.userId);
    const [u] = await getDb().select().from(users).where(eq(users.id, p.userId));
    expect(u!.passwordHash).toMatch(/^scrypt\$/);
    expect(u!.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects duplicate e-mail (case-insensitive) and username', async () => {
    const p = await newPlayer('dup');
    await expect(
      register({ email: p.email.toUpperCase(), username: `other${Date.now()}`, password: PASSWORD, ageConfirmed: true, termsAccepted: true }, meta),
    ).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
  });

  it('enforces the password policy', async () => {
    await expect(register({ email: `weak${Date.now()}@example.test`, username: `weak${Date.now()}`, password: 'short', ageConfirmed: true, termsAccepted: true }, meta)).rejects.toSatisfy(
      (e) => code(e) === 'VALIDATION_ERROR',
    );
  });
});

describe('login', () => {
  it('accepts the right password and rejects the wrong one with a generic message', async () => {
    const p = await newPlayer('login');
    const ok = await login(p.email, PASSWORD, meta);
    expect(ok.user.id).toBe(p.userId);
    const err = await login(p.email, 'wrong password!!', meta).catch((e) => e);
    expect(code(err)).toBe('UNAUTHENTICATED');
    const unknown = await login('nobody@example.test', 'wrong password!!', meta).catch((e) => e);
    expect((unknown as AppError).message).toBe((err as AppError).message);
  });

  it('locks the account after repeated failures', async () => {
    const p = await newPlayer('lock');
    for (let i = 0; i < 8; i += 1) await login(p.email, `bad-password-${i}`, meta).catch(() => undefined);
    const err = await login(p.email, PASSWORD, meta).catch((e) => e);
    expect(code(err)).toBe('ACCOUNT_LOCKED');
  });

  it('suspended accounts cannot sign in and their sessions stop resolving', async () => {
    const p = await newPlayer('susp');
    await getDb().update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, p.userId));
    expect(await resolveSession(p.token)).toBeNull();
    expect(code(await login(p.email, PASSWORD, meta).catch((e) => e))).toBe('FORBIDDEN');
  });
});

describe('password management', () => {
  it('change password revokes other sessions but keeps the current one', async () => {
    const p = await newPlayer('chg');
    const other = await login(p.email, PASSWORD, meta);
    await changePassword(p.userId, p.sessionId, PASSWORD, 'a brand new passphrase', meta);
    expect(await resolveSession(p.token)).not.toBeNull();
    expect(await resolveSession(other.session.token)).toBeNull();
    await expect(login(p.email, PASSWORD, meta)).rejects.toBeInstanceOf(AppError);
    expect((await login(p.email, 'a brand new passphrase', meta)).user.id).toBe(p.userId);
  });

  it('reset tokens are single-use, hashed at rest and revoke all sessions', async () => {
    const p = await newPlayer('reset');
    await requestPasswordReset(p.email, meta);
    // Simulate the e-mailed token: create a known token directly (the real one is only ever e-mailed).
    const token = 'known-reset-token-for-integration-test-0001';
    await getDb().insert(passwordResetTokens).values({ userId: p.userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 60_000) });
    await resetPassword(token, 'reset passphrase works', meta);
    expect(await resolveSession(p.token)).toBeNull();
    await expect(resetPassword(token, 'reset passphrase again', meta)).rejects.toBeInstanceOf(AppError);
    expect((await login(p.email, 'reset passphrase works', meta)).user.id).toBe(p.userId);
    const rows = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, p.userId));
    expect(rows.every((r) => !r.tokenHash.includes(token))).toBe(true);
  });
});

describe('privacy', () => {
  it('exports the player data', async () => {
    const p = await newPlayer('exp');
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    const data = await exportUserData(p.userId);
    expect(data.user?.email).toBe(p.email);
    expect(data.rounds).toHaveLength(1);
    expect(data.transactions.length).toBeGreaterThanOrEqual(2); // welcome bonus + stake (+ payout if won)
    expect(JSON.stringify(data)).not.toMatch(/scrypt\$/);
  });

  it('deletion anonymises personal data but retains financial records', async () => {
    const p = await newPlayer('del');
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    await expect(deleteAccount(p.userId, 'wrong password!!', meta)).rejects.toBeInstanceOf(AppError);
    await deleteAccount(p.userId, PASSWORD, meta);
    const [u] = await getDb().select().from(users).where(eq(users.id, p.userId));
    expect(u!.status).toBe('DELETED');
    expect(u!.email).not.toBe(p.email);
    expect(u!.passwordHash).toBeNull();
    expect(await resolveSession(p.token)).toBeNull();
    expect(await getDb().select().from(gameRounds).where(eq(gameRounds.userId, p.userId))).toHaveLength(1);
    expect((await getDb().select().from(ledgerTransactions).where(eq(ledgerTransactions.userId, p.userId))).length).toBeGreaterThan(0);
    // The e-mail address is free to register again.
    await register({ email: p.email, username: `re${Date.now().toString(36)}`, password: PASSWORD, ageConfirmed: true, termsAccepted: true }, meta);
    await expectLedgerConsistent();
  });
});

describe('session expiry', () => {
  it('idle sessions expire', async () => {
    const p = await newPlayer('idle');
    await getDb().execute(sql`UPDATE sessions SET last_seen_at = now() - interval '1 day' WHERE id = ${p.sessionId}`);
    expect(await resolveSession(p.token)).toBeNull();
  });
});
