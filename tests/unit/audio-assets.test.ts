/**
 * Every cue has a committed sound file, each file is a valid WAV, and each is
 * byte-identical to what its recipe in scripts/audio/ renders: the files are
 * provably the project's own synthesis (see public/audio/LICENSE.md).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_PROFILES } from '@/lib/audio/profiles';
import { renderAll } from '../../scripts/audio/sounds';
import { SAMPLE_RATE, wav } from '../../scripts/audio/synth';

const root = path.resolve(__dirname, '../../public/audio');
const files = Object.values(SOUND_PROFILES).flatMap((p) => Object.values(p).map((c) => c.file));

describe('audio assets', () => {
  it('exist for every cue and are small mono 16-bit WAVs', () => {
    let total = 0;
    for (const f of files) {
      const p = path.join(root, f);
      expect(existsSync(p), f).toBe(true);
      const b = readFileSync(p);
      expect(b.toString('ascii', 0, 4)).toBe('RIFF');
      expect(b.toString('ascii', 8, 12)).toBe('WAVE');
      expect(b.readUInt16LE(22)).toBe(1); // mono
      expect(b.readUInt32LE(24)).toBe(SAMPLE_RATE);
      expect(b.readUInt16LE(34)).toBe(16);
      const seconds = b.readUInt32LE(40) / 2 / SAMPLE_RATE;
      expect(seconds).toBeGreaterThan(0.01);
      expect(seconds).toBeLessThanOrEqual(3.5);
      total += statSync(p).size;
    }
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });

  it('match their recipes byte for byte, and the manifest records each checksum', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string }> };
    const rendered = renderAll();
    expect([...rendered.keys()].sort()).toEqual([...files].sort());
    for (const [file, samples] of rendered) {
      const expected = createHash('sha256').update(wav(samples)).digest('hex');
      expect(createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'), file).toBe(expected);
      expect(manifest.files[file]?.sha256, file).toBe(expected);
    }
  });

  it('ships a licence and origin statement', () => {
    const text = readFileSync(path.join(root, 'LICENSE.md'), 'utf8');
    expect(text).toMatch(/original work/i);
    expect(text).toMatch(/No recordings/);
  });
});
