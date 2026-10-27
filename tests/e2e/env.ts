export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DATABASE_URL = process.env.DATABASE_URL_E2E ?? 'postgresql://casino:casino@localhost:5432/casino_e2e';
/** The server under test connects as the least-privilege runtime role (migration 0004), like production. */
function asRuntimeRole(url: string): string {
  const u = new URL(url);
  u.searchParams.set('options', '-c role=casino_app');
  return u.toString();
}
export const E2E_ENV = {
  DATABASE_URL: asRuntimeRole(E2E_DATABASE_URL),
  APP_URL: `http://127.0.0.1:${E2E_PORT}`,
  // Test-only key (32 bytes, base64). Never use outside the e2e database.
  SEED_ENCRYPTION_KEY: 'ZTJlLXRlc3Qtc2VlZC1lbmNyeXB0aW9uLWtleS0zMmI=',
  IP_HASH_SECRET: 'e2e-only-ip-hash-secret-not-for-production-use',
  // Production hashing cost: the e2e server runs the production build, which refuses less.
  SCRYPT_LOG_N: '17',
  BACKGROUND_JOBS: 'false',
  MAIL_TRANSPORT: 'disabled',
  LOG_LEVEL: 'warn',
  // Next.js sets X-Forwarded-For from the socket when absent; e2e has no proxy in front.
  TRUST_PROXY_HOPS: '1',
};
export const ADMIN = { email: 'e2e-admin@example.com', password: 'e2e admin passphrase' };
export const OWNER = { email: 'e2e-owner@example.com', password: 'e2e owner passphrase' };
export const MODERATOR = { email: 'e2e-moderator@example.com', password: 'e2e moderator passphrase' };
export const PASSWORD = 'e2e player passphrase';
