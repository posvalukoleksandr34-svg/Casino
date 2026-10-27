/**
 * Decides which local demo/staff accounts `npm run db:seed` creates and with
 * which passwords. Pure (no I/O) so the safety rules are unit-tested.
 *
 * Safety rules:
 *   * never with NODE_ENV=production;
 *   * only for a local APP_URL (localhost / loopback) and a local database host
 *     (or the Compose service "db"), unless SEED_ALLOW_NON_LOCAL_DATABASE=true
 *     is set for a disposable remote database;
 *   * no built-in passwords: each account takes its own SEED_<ROLE>_PASSWORD,
 *     otherwise a random password is generated and shown once on the console;
 *   * supplied passwords must differ from each other and from any password that
 *     was ever published in this repository.
 */
import { randomBytes } from 'node:crypto';

/** The environment variables the plan reads (process.env in the script). */
export type SeedEnv = Record<string, string | undefined>;

export type SeedRole = 'OWNER' | 'ADMIN' | 'RISK_MANAGER' | 'AUDITOR' | 'SUPPORT' | 'PLAYER';

export interface SeedAccount {
  email: string;
  username: string;
  role: SeedRole;
  password: string;
  /** True when the password was generated here (and must be shown to the operator once). */
  generated: boolean;
  passwordVariable: string;
}

/** Passwords that appeared in this repository's history; never accepted. */
export const PUBLISHED_PASSWORDS: readonly string[] = ['Velvet-Table-Seed-2026'];

const ACCOUNTS: { role: SeedRole; username: string; email: (env: SeedEnv) => string }[] = [
  { role: 'OWNER', username: 'owner', email: (env) => env.SEED_OWNER_EMAIL || 'owner@example.com' },
  { role: 'ADMIN', username: 'admin', email: (env) => env.SEED_ADMIN_EMAIL || 'admin@example.com' },
  { role: 'RISK_MANAGER', username: 'risk_manager', email: () => 'risk@example.com' },
  { role: 'AUDITOR', username: 'auditor', email: () => 'auditor@example.com' },
  { role: 'SUPPORT', username: 'support', email: () => 'support@example.com' },
  { role: 'PLAYER', username: 'demo_player', email: () => 'player@example.com' },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

export class UnsafeSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeSeedError';
  }
}

export function generatePassword(): string {
  return randomBytes(18).toString('base64url'); // 24 characters, 144 bits
}

export function planSeed(env: SeedEnv, generate: () => string = generatePassword): SeedAccount[] {
  if (env.NODE_ENV === 'production') {
    throw new UnsafeSeedError('Refusing to seed demo staff accounts with NODE_ENV=production.');
  }
  const appUrl = env.APP_URL || 'http://localhost:3000';
  let appHost: string;
  try {
    appHost = new URL(appUrl).hostname;
  } catch {
    throw new UnsafeSeedError(`APP_URL is not a valid URL: ${appUrl}`);
  }
  if (!isLocalHost(appHost)) {
    throw new UnsafeSeedError(`Refusing to seed demo staff accounts for a non-local APP_URL (${appHost}). Create staff accounts individually instead.`);
  }
  if (env.DATABASE_URL) {
    let dbHost: string;
    try {
      dbHost = new URL(env.DATABASE_URL).hostname;
    } catch {
      throw new UnsafeSeedError('DATABASE_URL is not a valid URL.');
    }
    if (!isLocalHost(dbHost) && dbHost !== 'db' && env.SEED_ALLOW_NON_LOCAL_DATABASE !== 'true') {
      throw new UnsafeSeedError(
        `Refusing to seed a non-local database (${dbHost}). Set SEED_ALLOW_NON_LOCAL_DATABASE=true only for a disposable database.`,
      );
    }
  }

  const accounts = ACCOUNTS.map(({ role, username, email }) => {
    const passwordVariable = `SEED_${role}_PASSWORD`;
    const supplied = env[passwordVariable];
    if (supplied) {
      if (PUBLISHED_PASSWORDS.includes(supplied)) {
        throw new UnsafeSeedError(`${passwordVariable} is a password that was published in this repository; choose another.`);
      }
      if (supplied.length < 12) throw new UnsafeSeedError(`${passwordVariable} must be at least 12 characters.`);
      return { email: email(env), username, role, password: supplied, generated: false, passwordVariable };
    }
    return { email: email(env), username, role, password: generate(), generated: true, passwordVariable };
  });

  const supplied = accounts.filter((a) => !a.generated).map((a) => a.password);
  if (new Set(supplied).size !== supplied.length) {
    throw new UnsafeSeedError('Each seeded account needs its own password: SEED_*_PASSWORD values must all differ.');
  }
  return accounts;
}
