/**
 * Password hashing with scrypt (node:crypto, memory-hard; OWASP-recommended
 * parameters N=2^17, r=8, p=1 by default). Encoded as
 *   scrypt$<logN>$<r>$<p>$<salt base64>$<hash base64>
 * so parameters can be raised later and old hashes upgraded on login.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { env } from '../env';

const KEY_LEN = 32;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function options(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

export async function hashPassword(password: string): Promise<string> {
  const logN = env().SCRYPT_LOG_N;
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, options(logN, 8, 1));
  return ['scrypt', logN, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), options(Number(logN), Number(r), Number(p)));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(encoded: string): boolean {
  const logN = Number(encoded.split('$')[1]);
  return !Number.isFinite(logN) || logN < env().SCRYPT_LOG_N;
}

let dummy: Promise<string> | undefined;
/** Burns the same CPU/memory as a real verification so unknown e-mails are not distinguishable by timing. */
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummy);
}

/** Basic strength policy: length plus not trivially weak. */
/** The policy lives in src/lib/account-policy.ts so the registration form checks the same rules. */
export { passwordProblems } from '@/lib/account-policy';
