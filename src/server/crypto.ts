/**
 * Server-side cryptographic helpers. Uses node:crypto (OpenSSL CSPRNG).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministic, keyed hash of an IP address so logs can correlate without storing raw IPs. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const secret = env().IP_HASH_SECRET ?? 'development-ip-hash-secret';
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

// --- Seed encryption at rest (AES-256-GCM) ------------------------------------
//
// Ciphertexts carry the id of the key that produced them, so keys can be
// rotated: set the new key in SEED_ENCRYPTION_KEY and move the old one to
// SEED_ENCRYPTION_KEYS_PREVIOUS (comma-separated). New seeds use the current
// key; existing seeds stay readable until they are revealed or re-encrypted.

const DEV_SEED_KEY = createHash('sha256').update('aurovane-development-seed-key').digest();

function decodeKey(raw: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('seed encryption keys must decode to exactly 32 bytes');
  return key;
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

interface KeyRing {
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

let ring: KeyRing | undefined;

function keyRing(): KeyRing {
  if (ring) return ring;
  const raw = env().SEED_ENCRYPTION_KEY;
  if (!raw && env().NODE_ENV === 'production') throw new Error('SEED_ENCRYPTION_KEY is not configured');
  const current = raw ? decodeKey(raw) : DEV_SEED_KEY;
  const previous = (process.env.SEED_ENCRYPTION_KEYS_PREVIOUS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(decodeKey);
  const byId = new Map<string, Buffer>();
  for (const k of [current, ...previous, ...(env().NODE_ENV === 'production' ? [] : [DEV_SEED_KEY])]) byId.set(keyId(k), k);
  ring = { current: { id: keyId(current), key: current }, byId };
  return ring;
}

/** Encrypts a secret; output format `v1:<key id>:<iv b64>:<tag b64>:<ciphertext b64>`. */
export function encryptSecret(plaintext: string): string {
  const { current } = keyRing();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', current.id, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(encoded: string): string {
  const [version, kid, ivB64, tagB64, ctB64] = encoded.split(':');
  if (version !== 'v1' || !kid || !ivB64 || !tagB64 || !ctB64) throw new Error('unsupported secret encoding');
  const key = keyRing().byId.get(kid);
  if (!key) throw new Error(`seed encryption key ${kid} is not configured (see SEED_ENCRYPTION_KEYS_PREVIOUS)`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function resetKeyRing(): void {
  ring = undefined;
}

/** Stable JSON (sorted keys) for request fingerprints. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
