import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1]!;
};
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
function* tsx(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* tsx(p);
    else if (p.endsWith('.tsx')) yield p;
  }
}

describe('text contrast (WCAG 2.1 AA, 4.5:1 for normal text)', () => {
  const surfaces = ['ink-950', 'ink-900', 'ink-850', 'ink-800', 'ink-750'];
  it.each(['ink-400', 'ink-300', 'ink-200', 'ink-100', 'gold-400', 'gold-300', 'gold-200'])('%s on every surface', (fg) => {
    for (const bg of surfaces) expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('dimmer ink tokens are not used for readable text', () => {
    const offenders: string[] = [];
    for (const file of tsx('src')) {
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (/text-ink-(500|600|700|800)\b/.test(line) && !/aria-hidden="true"/.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
