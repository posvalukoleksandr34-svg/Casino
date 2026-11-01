/**
 * Operator check of the e-mail configuration, without the web server:
 *
 *   npm run ops:mail-check                      # validate config, connect, authenticate
 *   npm run ops:mail-check -- --to you@domain   # … and send a test message there
 *
 * Exit codes: 0 OK, 1 configuration invalid or connection/authentication
 * failed, 2 the test message was refused. Prints operator-facing reasons only;
 * never the SMTP URL, credentials or message body.
 */
import './load-env';

async function main() {
  const toIndex = process.argv.indexOf('--to');
  const to = toIndex > 0 ? process.argv[toIndex + 1] : undefined;
  if (toIndex > 0 && (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))) {
    console.error('--to needs an e-mail address');
    process.exit(1);
  }
  const { env } = await import('../src/server/env');
  try {
    env();
  } catch (err) {
    console.error(`configuration refused: ${(err as Error).message}`);
    process.exit(1);
  }
  const { sendNow, verifyMailTransport } = await import('../src/server/mail/mailer');
  const { testEmail } = await import('../src/server/mail/templates');
  const verified = await verifyMailTransport();
  console.log(JSON.stringify({ transport: verified.transport, connection: verified.ok ? 'ok' : 'failed', reason: verified.reason }));
  if (!verified.ok) process.exit(1);
  if (!to) return;
  const res = await sendNow(testEmail(to), { purpose: 'operator_test' });
  console.log(JSON.stringify(res.ok ? { test: 'accepted by the mail server', attempts: res.attempts } : { test: 'failed', kind: res.failure.kind, reason: res.failure.reason, smtp: res.failure.responseCode ?? null }));
  if (!res.ok) process.exit(2);
  console.log('Now check the inbox (not spam) and the Authentication-Results header: spf=pass, dkim=pass, dmarc=pass.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
