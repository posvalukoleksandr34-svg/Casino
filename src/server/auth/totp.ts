/**
 * TOTP (RFC 6238) with HMAC-SHA1, 30-second steps and 6 digits — the
 * parameters every common authenticator app uses by default. Pure functions;
 * storage, replay protection and rate limiting live in mfa.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32-encoded (RFC 4226 recommends ≥ 128 bits). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(at: Date | number = Date.now()): number {
  return Math.floor((typeof at === 'number' ? at : at.getTime()) / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP value for one counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * The time step whose code matches, checking the current step and one step
 * either side (clock drift), or null. Steps at or below `notAfterStep`
 * (already used) never match, so a code cannot be replayed.
 */
export function matchTotp(secretB32: string, code: string, opts: { at?: Date | number; notAfterStep?: number; window?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = timeStep(opts.at ?? Date.now());
  const window = opts.window ?? 1;
  const given = Buffer.from(code);
  for (let step = now - window; step <= now + window; step++) {
    if (opts.notAfterStep !== undefined && step <= opts.notAfterStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return step;
  }
  return null;
}

/** otpauth:// URI for authenticator apps (manual entry or a QR code generated on the device). */
export function otpauthUri(secretB32: string, account: string, issuer = 'Aurovane'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Ten single-use recovery codes, 10 characters each (≈50 bits), grouped for reading. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z2-7]/g, '');
}
