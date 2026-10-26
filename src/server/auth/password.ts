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
export function passwordProblems(password: string, context: { email?: string; username?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (password.length > 200) problems.push('Use at most 200 characters.');
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) problems.push('Avoid repeating a single character.');
  if (['password12', 'password123', '1234567890', 'qwertyuiop', 'letmein123'].includes(lower)) {
    problems.push('This password is too common.');
  }
  if (context.username && lower.includes(context.username.toLowerCase())) problems.push('Do not include your username.');
  if (context.email && lower.includes(context.email.split('@')[0]!.toLowerCase())) problems.push('Do not include your e-mail name.');
  return problems;
}
