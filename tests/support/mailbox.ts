/**
 * In-memory capture mailer for integration tests: messages are recorded
 * instead of sent, and helpers read verification codes back out of them.
 * It is installed only for the duration of `withMailbox` (reference-counted,
 * so concurrent helpers in one worker share it) and restores whatever
 * transport the test had configured.
 */
import { mailerOverrideForTests, setMailerForTests, type MailMessage, type Mailer } from '@/server/mail/mailer';

export const sentMail: MailMessage[] = [];

let failNext = 0;

export const captureMailer: Mailer = {
  kind: 'capture',
  deliversEmail: true,
  async send(m) {
    if (failNext > 0) {
      failNext -= 1;
      throw Object.assign(new Error('simulated delivery failure'), { code: 'ECONNREFUSED' });
    }
    sentMail.push({ ...m });
  },
};

/** The next `n` sends through the capture mailer fail (temporary provider outage). */
export function failNextDeliveries(n: number): void {
  failNext = n;
}

let depth = 0;
let previous: Mailer | null = null;

export async function withMailbox<T>(fn: () => Promise<T>): Promise<T> {
  if (depth === 0) {
    previous = mailerOverrideForTests();
    setMailerForTests(captureMailer);
  }
  depth += 1;
  try {
    return await fn();
  } finally {
    depth -= 1;
    if (depth === 0) setMailerForTests(previous);
  }
}

/** Installs the capture mailer until `uninstallMailbox` (for whole describe blocks). */
export function installMailbox(): void {
  setMailerForTests(captureMailer);
}

export function uninstallMailbox(): void {
  setMailerForTests(null);
}

export function messagesTo(email: string): MailMessage[] {
  return sentMail.filter((m) => m.to === email.toLowerCase());
}

/** The six-digit code from the latest message sent to `email`. */
export function latestCode(email: string): string {
  const list = messagesTo(email);
  const last = list[list.length - 1];
  const m = last ? /^\s{4}(\d{6})$/m.exec(last.text) : null;
  if (!m) throw new Error(`no verification code was sent to ${email}`);
  return m[1]!;
}
