/**
 * Writes Aurovane's sound effects to public/audio/ from the recipes in
 * ./sounds.ts, plus a manifest with SHA-256 checksums.
 *
 *   npm run audio:generate          write the files
 *   npm run audio:generate -- --check   fail if the committed files differ
 *
 * The sounds are original works synthesised here; nothing is sampled from a
 * recording. See public/audio/LICENSE.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_RATE, wav } from './synth';
import { renderAll } from './sounds';

const root = path.resolve(__dirname, '../../public/audio');
const check = process.argv.includes('--check');

const manifest: Record<string, { bytes: number; seconds: number; sha256: string }> = {};
const mismatches: string[] = [];

for (const [file, samples] of renderAll()) {
  const bytes = wav(samples);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest[file] = { bytes: bytes.length, seconds: Math.round((samples.length / SAMPLE_RATE) * 1000) / 1000, sha256 };
  const target = path.join(root, file);
  if (check) {
    if (!existsSync(target) || createHash('sha256').update(readFileSync(target)).digest('hex') !== sha256) mismatches.push(file);
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

if (check) {
  if (mismatches.length) {
    console.error(`audio files differ from their recipes: ${mismatches.join(', ')} — run npm run audio:generate`);
    process.exit(1);
  }
  console.log(`audio check: ${Object.keys(manifest).length} files match their recipes`);
} else {
  writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify({ sampleRate: SAMPLE_RATE, format: 'WAV PCM 16-bit mono', files: manifest }, null, 2)}\n`);
  const total = Object.values(manifest).reduce((a, f) => a + f.bytes, 0);
  console.log(`wrote ${Object.keys(manifest).length} files (${(total / 1024).toFixed(0)} KiB) to public/audio`);
}
