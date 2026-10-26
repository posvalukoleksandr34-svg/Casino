import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, decryptSecret, encryptSecret, resetKeyRing } from '@/server/crypto';
import { resetEnvCache } from '@/server/env';

const ORIGINAL = { ...process.env };

function setKeys(current?: string, previous?: string) {
  process.env.DATABASE_URL ??= 'postgresql://unused';
  if (current) process.env.SEED_ENCRYPTION_KEY = current;
  else delete process.env.SEED_ENCRYPTION_KEY;
  if (previous) process.env.SEED_ENCRYPTION_KEYS_PREVIOUS = previous;
  else delete process.env.SEED_ENCRYPTION_KEYS_PREVIOUS;
  resetEnvCache();
  resetKeyRing();
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
  resetKeyRing();
});

describe('seed encryption at rest', () => {
  it('round-trips and uses a fresh IV each time', () => {
    setKeys(randomBytes(32).toString('base64'));
    const a = encryptSecret('secret-seed');
    const b = encryptSecret('secret-seed');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('secret-seed');
    expect(a).not.toContain('secret-seed');
  });

  it('detects tampering (GCM authentication)', () => {
    setKeys(randomBytes(32).toString('base64'));
    const parts = encryptSecret('secret-seed').split(':');
    const ct = Buffer.from(parts[4]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('supports key rotation through SEED_ENCRYPTION_KEYS_PREVIOUS', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('hex');
    setKeys(oldKey);
    const sealed = encryptSecret('legacy-seed');
    setKeys(newKey);
    expect(() => decryptSecret(sealed)).toThrow(/not configured/);
    setKeys(newKey, oldKey);
    expect(decryptSecret(sealed)).toBe('legacy-seed');
    expect(decryptSecret(encryptSecret('new-seed'))).toBe('new-seed');
  });

  it('rejects keys of the wrong length', () => {
    setKeys(randomBytes(16).toString('base64'));
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });
});

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});
