/**
 * Promotes an existing, active account to OWNER. Run by an operator with
 * database access, never from the web:
 *
 *   npm run admin:provision-owner -- --email owner@example.com --reason "Initial owner"
 *   docker compose run --rm migrate npm run admin:provision-owner -- --email … --reason …
 *
 * The account must have been registered through the site first (this script
 * never sets passwords). Refuses when an active owner exists unless
 * --break-glass is given (recovery when every owner lost access). Each run is
 * written to the audit log. Prints no secrets.
 */
import './load-env';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, reason: { type: 'string' }, 'break-glass': { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values.email || !values.reason) {
    console.error('usage: npm run admin:provision-owner -- --email <registered e-mail> --reason "<why>" [--break-glass]');
    process.exit(64);
  }
  const { provisionOwner } = await import('../src/server/admin/provision');
  const { closeDb } = await import('../src/server/db/client');
  try {
    const res = await provisionOwner({ email: values.email, reason: values.reason, allowAdditional: values['break-glass'] });
    console.log(JSON.stringify({ msg: 'owner provisioned', userId: res.userId, previousRole: res.previousRole, breakGlass: res.breakGlass }));
    console.log('The account was signed out everywhere; sign in again to use the owner role.');
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
