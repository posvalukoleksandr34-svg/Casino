/**
 * Outbound e-mail behind one small interface. Three transports:
 *   smtp      real delivery through SMTP_URL (TLS required for non-loopback
 *             servers: smtps:// or STARTTLS on smtp://)
 *   console   development only — prints the message to the server console;
 *             refused in production (src/server/env.ts)
 *   disabled  nothing is sent; callers must tell the user honestly
 *
 * Automated tests install an in-memory capture mailer with setMailerForTests
 * (kind "capture"); it cannot be selected through configuration.
 *
 * Messages are sent in the background so response times do not depend on
 * whether an account exists or how slow the provider is. Delivery failures are
 * logged without message bodies (which contain single-use links).
 */
import nodemailer from 'nodemailer';
import { env } from '../env';
import { logger } from '../observability/logger';
import { captureError } from '../observability/errors';
import { metrics } from '../observability/metrics';

export type MailTransportKind = 'smtp' | 'console' | 'disabled' | 'capture';

export interface MailMessage {
  /** A single, already validated address (never a free-text list). */
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: MailTransportKind;
  /** True only when messages actually leave this process for a recipient. */
  readonly deliversEmail: boolean;
  send(message: MailMessage): Promise<void>;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function smtpMailer(): Mailer {
  const { SMTP_URL, MAIL_FROM } = env();
  if (!SMTP_URL || !MAIL_FROM) throw new Error('MAIL_TRANSPORT=smtp requires SMTP_URL and MAIL_FROM');
  const url = new URL(SMTP_URL);
  const secure = url.protocol === 'smtps:';
  const transport = nodemailer.createTransport({
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    // Never send credentials or reset links in clear text to a remote server.
    requireTLS: !secure && !LOOPBACK.has(url.hostname),
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    kind: 'smtp',
    deliversEmail: true,
    async send(m) {
      // Structured recipient: no free-text address parsing of user data.
      await transport.sendMail({ from: MAIL_FROM, to: { name: '', address: m.to }, subject: m.subject, text: m.text });
    },
  };
}

const consoleMailer: Mailer = {
  kind: 'console',
  deliversEmail: false,
  async send(m) {
    process.stdout.write(`\n[dev mailer] To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n\n`);
  },
};

const disabledMailer: Mailer = {
  kind: 'disabled',
  deliversEmail: false,
  async send() {
    throw new Error('e-mail delivery is disabled');
  },
};

let cached: Mailer | undefined;
let override: Mailer | undefined;

export function getMailer(): Mailer {
  if (override) return override;
  if (cached) return cached;
  const kind = env().MAIL_TRANSPORT;
  if (kind === 'console' && env().NODE_ENV === 'production') {
    // env() already refuses this combination; never print links in production.
    cached = disabledMailer;
  } else {
    cached = kind === 'smtp' ? smtpMailer() : kind === 'console' ? consoleMailer : disabledMailer;
  }
  return cached;
}

/** Tests only: the transport installed by setMailerForTests, if any. */
export function mailerOverrideForTests(): Mailer | null {
  return override ?? null;
}

/** Tests only: replace the transport (null restores configuration). */
export function setMailerForTests(m: Mailer | null): void {
  override = m ?? undefined;
  cached = undefined;
}

const pending = new Set<Promise<void>>();

/** Sends without delaying the caller; failures are logged and counted, never thrown. */
export function sendInBackground(message: MailMessage, context: { purpose: string; userId?: string }): void {
  const mailer = getMailer();
  const p = mailer
    .send(message)
    .then(() => metrics.inc('casino_mail_sent_total', { purpose: context.purpose, transport: mailer.kind }))
    .catch((err: unknown) => {
      metrics.inc('casino_mail_failed_total', { purpose: context.purpose, transport: mailer.kind });
      const e = err as { code?: string; responseCode?: number; message?: string };
      // No message body, recipient or link in the log.
      logger.error('mail delivery failed', { purpose: context.purpose, userId: context.userId, code: e.code, responseCode: e.responseCode });
    })
    .finally(() => pending.delete(p));
  pending.add(p);
}

/**
 * Sends and waits for the outcome, for messages whose delivery the caller must
 * report (verification codes). Returns false on failure, which is logged and
 * counted without the body, recipient or code.
 */
export async function sendNow(message: MailMessage, context: { purpose: string; userId?: string }): Promise<boolean> {
  const mailer = getMailer();
  try {
    await mailer.send(message);
    metrics.inc('casino_mail_sent_total', { purpose: context.purpose, transport: mailer.kind });
    return true;
  } catch (err) {
    metrics.inc('casino_mail_failed_total', { purpose: context.purpose, transport: mailer.kind });
    const e = err as { code?: string; responseCode?: number };
    logger.error('mail delivery failed', { purpose: context.purpose, userId: context.userId, code: e.code, responseCode: e.responseCode });
    return false;
  }
}

/**
 * Runs work that ends in an e-mail (account lookups, token writes, then
 * sendInBackground) after the caller has returned, so a response's timing
 * cannot reveal whether an account exists. Failures are captured, never thrown.
 */
export function runInBackground(name: string, task: () => Promise<void>): void {
  const p: Promise<void> = Promise.resolve()
    .then(task)
    .catch((err: unknown) => captureError(err, { route: `background:${name}` }))
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Tests: wait for background work and deliveries to finish. */
export async function flushMail(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
