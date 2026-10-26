/**
 * Password recovery over a real SMTP conversation (a minimal SMTP server runs
 * inside the test), plus the token lifecycle and login lockout under
 * concurrency.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { auditLogs, passwordResetTokens } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { AppError } from '@/server/errors';
import { resolveSession } from '@/server/auth/sessions';
import { flushMail, setMailerForTests } from '@/server/mail/mailer';
import { login, requestPasswordReset, resetPassword } from '@/server/users/accounts';
import { newPlayer } from './helpers';

const meta = { ipHash: null, userAgent: 'vitest' };

interface Received {
  from: string;
  to: string[];
  data: string;
}

/** Just enough SMTP (RFC 5321) for nodemailer: EHLO, MAIL, RCPT, DATA, QUIT. */
function fakeSmtp(opts: { rejectRcpt?: boolean } = {}) {
  const inbox: Received[] = [];
  const server: Server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    let current: Received = { from: '', to: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          inbox.push(current);
          current = { from: '', to: [], data: '' };
          reply('250 2.0.0 queued');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') reply('250 fake.test');
        else if (cmd === 'MAIL') {
          current.from = line;
          reply('250 2.1.0 ok');
        } else if (cmd === 'RCPT') {
          if (opts.rejectRcpt) reply('550 5.1.1 mailbox unavailable');
          else {
            current.to.push(line);
            reply('250 2.1.5 ok');
          }
        } else if (cmd === 'DATA') {
          inData = true;
          reply('354 end with <CRLF>.<CRLF>');
        } else if (cmd === 'RSET' || cmd === 'NOOP') reply('250 ok');
        else if (cmd === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else reply('502 not implemented');
      }
    });
  });
  return {
    inbox,
    async start(): Promise<number> {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      return (server.address() as { port: number }).port;
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function useSmtp(port: number) {
  process.env.MAIL_TRANSPORT = 'smtp';
  process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
  process.env.MAIL_FROM = 'Aurovane <no-reply@example.test>';
  resetEnvCache();
  setMailerForTests(null);
}

function restoreMail() {
  process.env.MAIL_TRANSPORT = 'disabled';
  delete process.env.SMTP_URL;
  delete process.env.MAIL_FROM;
  resetEnvCache();
  setMailerForTests(null);
}

/** Quoted-printable soft breaks may split the link; undo them before searching. */
function tokenFrom(message: Received): string {
  const body = message.data.replace(/=\r\n/g, '').replace(/=3D/g, '=');
  const m = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(body);
  if (!m) throw new Error('no reset link in message');
  return m[1]!;
}

describe('password recovery over SMTP', () => {
  const smtp = fakeSmtp();
  beforeAll(async () => useSmtp(await smtp.start()));
  afterAll(async () => {
    restoreMail();
    await smtp.stop();
  });
  beforeEach(() => {
    smtp.inbox.length = 0;
  });

  it('e-mails a single-use link to the account address; redeeming it revokes every session', async () => {
    const p = await newPlayer('rec');
    const res = await requestPasswordReset(p.email, meta);
    expect(res.recovery).toBe('email');
    await flushMail();
    expect(smtp.inbox).toHaveLength(1);
    expect(smtp.inbox[0]!.to.join()).toContain(p.email);
    const token = tokenFrom(smtp.inbox[0]!);
    // Stored hashed only.
    const [row] = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, sha256Hex(token)));
    expect(row?.userId).toBe(p.userId);

    await resetPassword(token, 'recovered passphrase 1', meta);
    expect(await resolveSession(p.token)).toBeNull();
    expect((await login(p.email, 'recovered passphrase 1', meta)).user.id).toBe(p.userId);
    await expect(resetPassword(token, 'recovered passphrase 2', meta)).rejects.toSatisfy((e) => e instanceof AppError && /invalid or has expired/.test(e.message));
  });

  it('answers identically for unknown addresses and sends nothing', async () => {
    const known = await newPlayer('enum');
    const a = await requestPasswordReset(known.email, meta);
    const b = await requestPasswordReset(`nobody-${Date.now()}@example.test`, meta);
    const c = await requestPasswordReset('not an address', meta);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    await flushMail();
    expect(smtp.inbox).toHaveLength(1);
  });

  it('only the newest link works; a successful reset voids all other links', async () => {
    const p = await newPlayer('newest');
    await requestPasswordReset(p.email, meta);
    await requestPasswordReset(p.email, meta);
    await flushMail();
    const [older, newer] = smtp.inbox.map(tokenFrom);
    await expect(resetPassword(older!, 'older link passphrase', meta)).rejects.toBeInstanceOf(AppError);
    await resetPassword(newer!, 'newer link passphrase', meta);
    const open = await getDb()
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, p.userId)));
    expect(open.every((t) => t.usedAt !== null)).toBe(true);
  });

  it('throttles reset e-mails per address silently (3 per hour)', async () => {
    const p = await newPlayer('throttle');
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await requestPasswordReset(p.email, meta));
    expect(new Set(results.map((r) => r.recovery))).toEqual(new Set(['email']));
    await flushMail();
    expect(smtp.inbox).toHaveLength(3);
  });
});

describe('password recovery: delivery failures and disabled transport', () => {
  it('a rejected delivery is logged without the link or address, and the answer is unchanged', async () => {
    const smtp = fakeSmtp({ rejectRcpt: true });
    useSmtp(await smtp.start());
    const writes: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    };
    const spies = [vi.spyOn(process.stdout, 'write').mockImplementation(capture), vi.spyOn(process.stderr, 'write').mockImplementation(capture)];
    try {
      const p = await newPlayer('fail');
      const res = await requestPasswordReset(p.email, meta);
      expect(res.recovery).toBe('email');
      await flushMail();
      const log = writes.join('');
      expect(log).toContain('mail delivery failed');
      expect(log).not.toContain('reset-password?token=');
      expect(log).not.toContain(p.email);
    } finally {
      for (const spy of spies) spy.mockRestore();
      restoreMail();
      await smtp.stop();
    }
  });

  it('with no provider configured, recovery is reported unavailable and no token is created', async () => {
    restoreMail();
    const p = await newPlayer('nomail');
    const res = await requestPasswordReset(p.email, meta);
    expect(res.recovery).toBe('unavailable');
    expect(await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, p.userId))).toHaveLength(0);
  });
});

describe('reset token redemption', () => {
  async function tokenFor(userId: string, expiresInMs: number) {
    const token = `test-token-${userId}-${randomUUID()}`;
    await getDb().insert(passwordResetTokens).values({ userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + expiresInMs) });
    return token;
  }

  it('rejects invalid and expired tokens', async () => {
    const p = await newPlayer('exp');
    await expect(resetPassword('no-such-token-0123456789abcdef', 'some new passphrase', meta)).rejects.toBeInstanceOf(AppError);
    const expired = await tokenFor(p.userId, -1_000);
    await expect(resetPassword(expired, 'some new passphrase', meta)).rejects.toSatisfy((e) => e instanceof AppError && /expired/.test(e.message));
  });

  it('concurrent redemptions of one token: exactly one succeeds', async () => {
    const p = await newPlayer('race');
    const token = await tokenFor(p.userId, 60_000);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => resetPassword(token, `concurrent passphrase ${i}`, meta)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect((await login(p.email, `concurrent passphrase ${winner}`, meta)).user.id).toBe(p.userId);
  });
});

describe('login lockout under parallel guessing', () => {
  it('no more than the lockout limit of passwords are checked, however many requests run at once', async () => {
    const p = await newPlayer('brute');
    const attempts = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => login(p.email, `wrong guess ${i}`, meta)));
    expect(attempts.every((a) => a.status === 'rejected')).toBe(true);
    const checked = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, p.userId)));
    const failures = checked.filter((r) => r.action === 'auth.login_failed' || r.action === 'auth.account_locked');
    expect(failures.length).toBeLessThanOrEqual(8);
    // Locked: even the right password is refused now.
    await expect(login(p.email, 'correct horse battery staple', meta)).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'ACCOUNT_LOCKED');
  });
});
