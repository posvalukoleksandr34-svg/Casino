/**
 * E-mail delivery against real SMTP conversations (a local fake server):
 * connection checks, authentication failure, refused connections, timeouts,
 * temporary deferrals (retried with the same message) and permanent
 * rejections (not retried, recorded as REJECTED), recovery after an outage,
 * operator status, and what reaches the logs.
 */
import { createServer } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { emailVerificationChallenges } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { classifyMailError, mailStatus, resetMailStatusForTests, sendNow, setMailerForTests, setRetrySleepForTests, verifyMailTransport } from '@/server/mail/mailer';
import { escapeHtml, passwordResetEmail, verificationCodeEmail } from '@/server/mail/templates';
import { register } from '@/server/users/accounts';
import { resendSignupCode, signupStatus } from '@/server/users/verification';
import { PLAYER_PASSWORD } from './helpers';
import { fakeSmtp, plainBody, type FakeSmtpOptions } from '../support/fake-smtp';

const meta = { ipHash: null, userAgent: 'vitest' };
let n = 0;

function configureSmtp(port: number, extra: Record<string, string> = {}) {
  process.env.MAIL_TRANSPORT = 'smtp';
  process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
  process.env.MAIL_FROM = 'Aurovane <no-reply@example.test>';
  Object.assign(process.env, extra);
  resetEnvCache();
  setMailerForTests(null);
}

function restoreMail() {
  process.env.MAIL_TRANSPORT = 'disabled';
  for (const k of ['SMTP_URL', 'MAIL_FROM', 'SMTP_TIMEOUT_SECONDS', 'SMTP_URL']) delete process.env[k];
  resetEnvCache();
  setMailerForTests(null);
}

async function withServer<T>(opts: FakeSmtpOptions, fn: (smtp: ReturnType<typeof fakeSmtp>, port: number) => Promise<T>, extraEnv: Record<string, string> = {}): Promise<T> {
  const smtp = fakeSmtp(opts);
  const port = await smtp.start();
  configureSmtp(port, extraEnv);
  try {
    return await fn(smtp, port);
  } finally {
    await smtp.stop();
  }
}

/** A port nobody listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const message = (to = 'player@example.test') => verificationCodeEmail(to, '123456', 'SIGNUP');

beforeEach(() => {
  resetMailStatusForTests();
  setRetrySleepForTests(async () => undefined);
});

afterEach(() => {
  restoreMail();
  setRetrySleepForTests(null);
  vi.restoreAllMocks();
});

describe('classification', () => {
  it('separates permanent from temporary failures with operator-facing reasons', () => {
    expect(classifyMailError({ code: 'EAUTH', responseCode: 535 }).kind).toBe('permanent');
    expect(classifyMailError({ code: 'EAUTH', responseCode: 535 }).reason).toMatch(/authentication failed/);
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 550 }).kind).toBe('permanent');
    expect(classifyMailError({ responseCode: 554 }).kind).toBe('permanent');
    expect(classifyMailError({ responseCode: 451 }).kind).toBe('temporary');
    // Regression: nodemailer reports a 451 recipient deferral as EENVELOPE; it must stay temporary.
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 451 }).kind).toBe('temporary');
    expect(classifyMailError({ code: 'ECONNREFUSED' }).kind).toBe('temporary');
    expect(classifyMailError({ code: 'ETIMEDOUT' }).kind).toBe('temporary');
    expect(classifyMailError({ code: 'ETLS' }).kind).toBe('permanent');
    expect(classifyMailError({ code: 'EDISABLED' }).kind).toBe('permanent');
    expect(classifyMailError(new Error('weird')).kind).toBe('temporary');
  });
});

describe('connection checks', () => {
  it('verifies a working server without sending anything', async () => {
    await withServer({}, async (smtp) => {
      const r = await verifyMailTransport();
      expect(r).toMatchObject({ ok: true, transport: 'smtp' });
      expect(smtp.inbox).toHaveLength(0);
      expect(mailStatus().lastVerify?.ok).toBe(true);
    });
  });

  it('reports a refused connection and a failed authentication clearly', async () => {
    configureSmtp(await closedPort());
    const refused = await verifyMailTransport();
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/could not be reached/);
    await withServer({ rejectAuth: true }, async (_smtp, port) => {
      process.env.SMTP_URL = `smtp://user:wrong-password@127.0.0.1:${port}`;
      resetEnvCache();
      setMailerForTests(null);
      const auth = await verifyMailTransport();
      expect(auth.ok).toBe(false);
      expect(auth.reason).toMatch(/authentication failed/);
      expect(JSON.stringify(mailStatus())).not.toContain('wrong-password');
    });
  });

  it('times out against a server that never answers', async () => {
    await withServer(
      { silent: true },
      async () => {
        const started = Date.now();
        const r = await verifyMailTransport();
        expect(r.ok).toBe(false);
        expect(Date.now() - started).toBeLessThan(5000);
      },
      { SMTP_TIMEOUT_SECONDS: '1' },
    );
  });

  it('reports a disabled transport honestly', async () => {
    const r = await verifyMailTransport();
    expect(r).toMatchObject({ ok: false, transport: 'disabled' });
    expect(r.reason).toMatch(/registration is closed/);
  });
});

describe('sending', () => {
  it('delivers a multipart message with the code in both parts and nothing loaded remotely', async () => {
    await withServer({}, async (smtp) => {
      const res = await sendNow(message(), { purpose: 'email_verification' });
      expect(res).toEqual({ ok: true, attempts: 1 });
      const body = plainBody(smtp.inbox[0]!);
      expect(body).toContain('multipart/alternative');
      expect(body).toMatch(/\n {4}123456\r?\n/);
      expect(body).toContain('text/html');
      expect(body).not.toMatch(/<img|src=["']https?:/i);
      expect(mailStatus().sent).toBe(1);
    });
  });

  it('retries a temporary deferral with the identical message and then succeeds', async () => {
    await withServer({ deferRcpt: 2 }, async (smtp) => {
      const res = await sendNow(message(), { purpose: 'email_verification' });
      expect(res).toEqual({ ok: true, attempts: 3 });
      expect(smtp.inbox).toHaveLength(1);
    });
  });

  it('gives up after bounded retries on persistent temporary failure', async () => {
    configureSmtp(await closedPort());
    const res = await sendNow(message(), { purpose: 'email_verification' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.attempts).toBe(3);
      expect(res.failure.kind).toBe('temporary');
    }
    expect(mailStatus().lastFailure?.kind).toBe('temporary');
  });

  it('does not retry a permanent rejection', async () => {
    await withServer({ rejectRcpt: true }, async () => {
      const res = await sendNow(message(), { purpose: 'email_verification' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.attempts).toBe(1);
        expect(res.failure.kind).toBe('permanent');
        expect(res.failure.responseCode).toBe(550);
      }
    });
  });

  it('logs failures without recipient, subject, body or code', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => (lines.push(String(c)), true)) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => (lines.push(String(c)), true)) as typeof process.stderr.write);
    configureSmtp(await closedPort());
    await sendNow(message('secret.person@example.test'), { purpose: 'email_verification', userId: 'u-1' });
    vi.restoreAllMocks();
    const out = lines.join('\n');
    expect(out).toContain('mail delivery failed');
    expect(out).not.toContain('secret.person');
    expect(out).not.toContain('123456');
    expect(out).not.toContain('verification code');
  });
});

describe('registration over SMTP', () => {
  const input = () => {
    n += 1;
    const tag = `ml${Date.now().toString(36)}${n}`;
    return { email: `${tag}@example.test`, username: tag, password: PLAYER_PASSWORD, confirmPassword: PLAYER_PASSWORD, ageConfirmed: true as const, chipsAcknowledged: true as const, termsAccepted: true as const };
  };

  it('a permanently rejected address is recorded as REJECTED and shown as such', async () => {
    await withServer({ rejectRcpt: true }, async () => {
      const res = await register(input(), meta);
      expect(res.sent).toBe(false);
      const [c] = await getDb().select().from(emailVerificationChallenges).where(eq(emailVerificationChallenges.userId, res.user.id));
      expect(c!.delivery).toBe('REJECTED');
      expect((await signupStatus(res.user.id))!.rejected).toBe(true);
    });
  });

  it('recovers after an outage: the pending account gets a working code once the server is back', async () => {
    configureSmtp(await closedPort());
    const raw = input();
    const res = await register(raw, meta);
    expect(res.sent).toBe(false);
    expect((await signupStatus(res.user.id))!.sent).toBe(false);
    await withServer({}, async (smtp) => {
      const again = await resendSignupCode(res.user.id, meta); // allowed at once: the first code never left
      expect(again.sent).toBe(true);
      expect(smtp.inbox).toHaveLength(1);
      expect(smtp.inbox[0]!.to.join()).toContain(raw.email);
    });
  });
});

describe('templates', () => {
  it('escape every interpolated value', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const m = passwordResetEmail('a@example.test', 'https://aurovane.example/reset-password?token=abc"><script>');
    expect(m.html).not.toContain('<script>');
    expect(m.text).toContain('https://aurovane.example/reset-password?token=abc');
  });
});
