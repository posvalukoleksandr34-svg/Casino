import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checksumMatches, migrationChecksum } from '@/server/db/migrator';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('migration checksums', () => {
  const dir = path.resolve(__dirname, '../../migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));

  it('are the same for a Windows (CRLF) and a Linux (LF) checkout of every migration', () => {
    for (const f of files) {
      const lf = readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      expect(migrationChecksum(crlf), f).toBe(migrationChecksum(lf));
    }
  });

  it('accept checksums recorded from either raw form (databases migrated before the fix)', () => {
    const lf = 'CREATE TABLE t (id int);\nSELECT 1;\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    for (const recorded of [sha(lf), sha(crlf), migrationChecksum(lf)]) {
      expect(checksumMatches(recorded, lf)).toBe(true);
      expect(checksumMatches(recorded, crlf)).toBe(true);
    }
  });

  it('still refuse a migration whose content was really edited', () => {
    const lf = 'CREATE TABLE t (id int);\n';
    expect(checksumMatches(sha(lf), 'CREATE TABLE t (id bigint);\n')).toBe(false);
    expect(checksumMatches(migrationChecksum(lf), 'CREATE TABLE t (id int);\nDROP TABLE t;\n')).toBe(false);
  });
});
