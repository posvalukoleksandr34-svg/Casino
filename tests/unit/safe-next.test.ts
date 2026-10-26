import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/safe-next';

const ORIGIN = 'https://casino.example.org';

describe('post-login redirect target', () => {
  it.each([
    ['/wallet', '/wallet'],
    ['/history?game=dice#top', '/history?game=dice#top'],
    ['/games/crash', '/games/crash'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'], // encoded slashes stay a path on this site
  ])('keeps the same-site path %s', (next, expected) => {
    expect(safeNextPath(next, ORIGIN)).toBe(expected);
  });

  it.each([
    ['//evil.example'],
    ['/\\evil.example'], // the old guard let this through: browsers read "\" as "/"
    ['/\t/evil.example'], // tabs and newlines are stripped by URL parsing
    ['/\n/evil.example'],
    ['\\\\evil.example'],
    ['https://evil.example/lobby'],
    ['http://casino.example.org/lobby'], // other scheme = other origin
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
  ])('rejects %j', (next) => {
    expect(safeNextPath(next, ORIGIN)).toBe('/lobby');
  });

  it('falls back when nothing is given', () => {
    expect(safeNextPath(null, ORIGIN)).toBe('/lobby');
    expect(safeNextPath('', ORIGIN)).toBe('/lobby');
  });
});
