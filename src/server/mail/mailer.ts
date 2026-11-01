/**
 * Outbound e-mail behind one small interface. Three configurable transports:
 *   smtp      real delivery through SMTP_URL (TLS required for non-loopback
 *             servers: smtps:// or STARTTLS on smtp://)
 *   console   development only — prints the message to the server console;
 *             refused in production (src/server/env.ts)
 *   disabled  nothing is sent; callers must tell the user honestly
 *
 * Automated tests install an in-memory capture mailer with setMailerForTests
 * (kind "capture"); it cannot be selected through configuration.
 *
 * Failures are classified: "permanent" (the server rejected the message or the
 * configuration is wrong — retrying cannot help) or "temporary" (network,
 * timeout, 4xx). Temporary failures are retried a bounded number of times with
 * the *same* message, so a retry can at worst deliver an identical copy (same
 * code, same link) — never a second, conflicting code. Every outcome updates
 * an in-process status shown on /admin/health and counted in metrics. Logs
 * carry the purpose, the user id and error codes only: never the recipient,
 * subject, body, code, link or credentials.
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
  /** Optional HTML alternative (the text part is always sent). */
  html?: string;
}

export interface Mailer {
  readonly kind: MailTransportKind;
  /** True only when messages actually leave this process for a recipient. */
  readonly deliversEmail: boolean;
  send(message: MailMessage): Promise<void>;
  /** Connects and authenticates without sending (smtp only). */
  verify?(): Promise<void>;
}

export type FailureKind = 'temporary' | 'permanent';

export interface ClassifiedFailure {
  kind: FailureKind;
  code?: string;
  responseCode?: number;
  /** Operator-facing explanation; never contains addresses or credentials. */
  reason: string;
}

const NETWORK_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);

/** Maps a nodemailer / SMTP error to temporary or permanent, with an operator-facing reason. */
export function classifyMailError(err: unknown): ClassifiedFailure {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : undefined;
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined;
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    return { kind: 'permanent', code, responseCode, reason: 'SMTP authentication failed: check the user name and password in SMTP_URL (or the provider API key).' };
  }
  if (code === 'ETLS' || (typeof e.message === 'string' && /STARTTLS|TLS|certificate/i.test(e.message) && !responseCode)) {
    return { kind: 'permanent', code, responseCode, reason: 'TLS could not be established with the SMTP server: use smtps:// (port 465) or a server that offers STARTTLS, with a valid certificate.' };
  }
  if (code === 'EDISABLED') return { kind: 'permanent', code, reason: 'E-mail delivery is disabled (MAIL_TRANSPORT=disabled).' };
  // The SMTP reply code decides when there is one: nodemailer reports both a
  // 451 deferral and a 550 rejection of a recipient as EENVELOPE.
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
    return { kind: 'temporary', code, responseCode, reason: 'The mail server deferred the message (temporary 4xx response); it may succeed later.' };
  }
  if (code === 'EENVELOPE' || (responseCode !== undefined && responseCode >= 500)) {
    return { kind: 'permanent', code, responseCode, reason: 'The mail server permanently rejected the message (for example an unknown mailbox, a sender the provider does not allow, or a policy rejection).' };
  }
  if (code && NETWORK_CODES.has(code)) {
    return { kind: 'temporary', code, responseCode, reason: 'The SMTP server could not be reached or timed out: check the host, port, firewall and the provider status.' };
  }
  return { kind: 'temporary', code, responseCode, reason: 'Unexpected delivery error.' };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function smtpMailer(): Mailer {
  const { SMTP_URL, MAIL_FROM, MAIL_REPLY_TO, SMTP_TIMEOUT_SECONDS } = env();
  if (!SMTP_URL || !MAIL_FROM) throw new Error('MAIL_TRANSPORT=smtp requires SMTP_URL and MAIL_FROM');
  const url = new URL(SMTP_URL);
  const secure = url.protocol === 'smtps:';
  const timeoutMs = SMTP_TIMEOUT_SECONDS * 1000;
  const transport = nodemailer.createTransport({
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    // Never send credentials, codes or reset links in clear text to a remote server.
    requireTLS: !secure && !LOOPBACK.has(url.hostname),
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: Math.min(10_000, timeoutMs),
    greetingTimeout: Math.min(10_000, timeoutMs),
    socketTimeout: timeoutMs,
  });
  return {
    kind: 'smtp',
    deliversEmail: true,
    async send(m) {
      // Structured recipient: no free-text address parsing of user data.
      await transport.sendMail({
        from: MAIL_FROM,
        to: { name: '', address: m.to },
        replyTo: MAIL_REPLY_TO || undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
      });
    },
    async verify() {
      await transport.verify();
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
    throw Object.assign(new Error('e-mail delivery is disabled'), { code: 'EDISABLED' });
  },
};

let cached: Mailer | undefined;
let override: Mailer | undefined;

export function getMailer(): Mailer {
  if (override) return override;
  if (cached) return cached;
  const kind = env().MAIL_TRANSPORT;
  if (kind === 'console' && env().NODE_ENV === 'production') {
    // env() already refuses this combination; never print codes or links in production.
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

// ---------------------------------------------------------------------------
// Status (per process) for /admin/health
// ---------------------------------------------------------------------------

export interface MailStatus {
  transport: MailTransportKind;
  deliversEmail: boolean;
  lastSuccessAt: string | null;
  lastFailure: { at: string; kind: FailureKind; code?: string; responseCode?: number; reason: string; purpose: string } | null;
  lastVerify: { at: string; ok: boolean; reason?: string } | null;
  sent: number;
  failed: number;
}

const status: Omit<MailStatus, 'transport' | 'deliversEmail'> = { lastSuccessAt: null, lastFailure: null, lastVerify: null, sent: 0, failed: 0 };

export function mailStatus(): MailStatus {
  const mailer = getMailer();
  return { transport: mailer.kind, deliversEmail: mailer.deliversEmail, ...structuredClone(status) };
}

/** Tests only. */
export function resetMailStatusForTests(): void {
  Object.assign(status, { lastSuccessAt: null, lastFailure: null, lastVerify: null, sent: 0, failed: 0 });
}

/**
 * Checks that the configured transport can deliver: for SMTP it connects,
 * negotiates TLS and authenticates without sending anything.
 */
export async function verifyMailTransport(): Promise<{ ok: boolean; transport: MailTransportKind; reason?: string }> {
  const mailer = getMailer();
  const at = new Date().toISOString();
  if (mailer.kind === 'disabled') {
    status.lastVerify = { at, ok: false, reason: 'MAIL_TRANSPORT=disabled: no e-mail can be sent, so registration is closed.' };
    return { ok: false, transport: mailer.kind, reason: status.lastVerify.reason };
  }
  if (!mailer.verify) {
    status.lastVerify = { at, ok: true, reason: mailer.kind === 'console' ? 'Development console transport (prints messages; delivers nothing).' : undefined };
    return { ok: true, transport: mailer.kind, reason: status.lastVerify.reason };
  }
  try {
    await mailer.verify();
    status.lastVerify = { at, ok: true };
    metrics.inc('casino_mail_verify_total', { outcome: 'ok' });
    return { ok: true, transport: mailer.kind };
  } catch (err) {
    const f = classifyMailError(err);
    status.lastVerify = { at, ok: false, reason: f.reason };
    metrics.inc('casino_mail_verify_total', { outcome: 'failed' });
    logger.error('mail transport verification failed', { code: f.code, responseCode: f.responseCode });
    return { ok: false, transport: mailer.kind, reason: f.reason };
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendResult = { ok: true; attempts: number } | { ok: false; attempts: number; failure: ClassifiedFailure };

/** Delays before the 2nd and 3rd attempt of a temporary failure. */
export const RETRY_DELAYS_MS = [500, 2000];
/** No new attempt starts once this much time has passed (the caller is waiting). */
const SEND_BUDGET_MS = 20_000;

let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tests only: skip the retry delays. */
export function setRetrySleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  sleep = fn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
}

/**
 * Sends and waits for the outcome, for messages whose delivery the caller must
 * report (verification codes). Temporary failures are retried with the same
 * message; permanent ones are not. Never throws.
 */
export async function sendNow(message: MailMessage, context: { purpose: string; userId?: string }): Promise<SendResult> {
  const mailer = getMailer();
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await mailer.send(message);
      metrics.inc('casino_mail_sent_total', { purpose: context.purpose, transport: mailer.kind });
      status.lastSuccessAt = new Date().toISOString();
      status.sent += 1;
      if (attempts > 1) logger.info('mail delivered after retry', { purpose: context.purpose, userId: context.userId, attempts });
      return { ok: true, attempts };
    } catch (err) {
      const failure = classifyMailError(err);
      const delay = RETRY_DELAYS_MS[attempts - 1];
      if (failure.kind === 'temporary' && delay !== undefined && Date.now() - started + delay < SEND_BUDGET_MS) {
        metrics.inc('casino_mail_retries_total', { purpose: context.purpose, transport: mailer.kind });
        await sleep(delay);
        continue;
      }
      metrics.inc('casino_mail_failed_total', { purpose: context.purpose, transport: mailer.kind, kind: failure.kind });
      status.failed += 1;
      status.lastFailure = { at: new Date().toISOString(), kind: failure.kind, code: failure.code, responseCode: failure.responseCode, reason: failure.reason, purpose: context.purpose };
      // No message body, recipient, code or link in the log.
      logger.error('mail delivery failed', { purpose: context.purpose, userId: context.userId, kind: failure.kind, code: failure.code, responseCode: failure.responseCode, attempts });
      return { ok: false, attempts, failure };
    }
  }
}

const pending = new Set<Promise<unknown>>();

/** Sends without delaying the caller (with the same retries as sendNow); failures are logged and counted, never thrown. */
export function sendInBackground(message: MailMessage, context: { purpose: string; userId?: string }): void {
  const p = sendNow(message, context).finally(() => pending.delete(p));
  pending.add(p);
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
