export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DATABASE_URL = process.env.DATABASE_URL_E2E ?? 'postgresql://casino:casino@localhost:5432/casino_e2e';
export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  APP_URL: `http://127.0.0.1:${E2E_PORT}`,
  // Test-only key (32 bytes, base64). Never use outside the e2e database.
  SEED_ENCRYPTION_KEY: 'ZTJlLXRlc3Qtc2VlZC1lbmNyeXB0aW9uLWtleS0zMmI=',
  IP_HASH_SECRET: 'e2e-ip-hash-secret',
  SCRYPT_LOG_N: '12',
  BACKGROUND_JOBS: 'false',
  MAIL_TRANSPORT: 'disabled',
  LOG_LEVEL: 'warn',
  // Next.js sets X-Forwarded-For from the socket when absent; e2e has no proxy in front.
  TRUST_PROXY_HOPS: '1',
};
export const ADMIN = { email: 'e2e-admin@example.com', password: 'e2e admin passphrase' };
export const PASSWORD = 'e2e player passphrase';
