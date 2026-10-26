import { describe, expect, it } from 'vitest';
import { clientIp } from '@/server/http/handler';

const req = (xff?: string) => ({ headers: new Headers(xff ? { 'x-forwarded-for': xff } : {}) });

describe('clientIp trust model', () => {
  it('ignores forwarded headers when no proxy is trusted (they are client-controlled)', () => {
    expect(clientIp(req('1.2.3.4'), 0)).toBeNull();
  });

  it('takes the entry appended by the trusted proxy, not a spoofed prefix', () => {
    expect(clientIp(req('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIp(req('6.6.6.6, 198.51.100.7, 10.0.0.2'), 2)).toBe('198.51.100.7');
  });

  it('rejects malformed values and missing headers', () => {
    expect(clientIp(req('<script>'), 1)).toBeNull();
    expect(clientIp(req(), 1)).toBeNull();
    expect(clientIp(req('1.1.1.1'), 3)).toBeNull();
  });
});
