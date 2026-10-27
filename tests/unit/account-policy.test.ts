import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  dateOfBirthProblem,
  maskAddress,
  nameProblem,
  normaliseCode,
  normaliseName,
  parseCalendarDate,
  passwordProblems,
  utcToday,
} from '@/lib/account-policy';

describe('names', () => {
  it('accepts legitimate names in any script, with common punctuation', () => {
    for (const n of ['Ana María', "O'Connor", 'D’Angelo', 'Jean-Luc', 'St. John', 'Nguyễn Thị Minh', '李', 'Zoë', 'Søren', 'Ólafur', 'Мария', 'محمد', 'X']) {
      expect(nameProblem(n, 'name'), n).toBeNull();
    }
  });

  it('refuses digits, symbols, control characters, empty and over-long values', () => {
    for (const n of ['', '   ', 'R2-D2', 'Bob!', '<script>', 'a\u0000b', "'leading", '-dash', 'x'.repeat(65)]) expect(nameProblem(n, 'name'), JSON.stringify(n)).not.toBeNull();
  });

  it('normalises whitespace and Unicode composition', () => {
    expect(normaliseName('  Mary   Ann  ')).toBe('Mary Ann');
    expect(normaliseName('Zoë')).toBe('Zoë');
  });
});

describe('dates of birth and the minimum age', () => {
  const today = { y: 2026, m: 10, d: 27 };

  it('accepts only real calendar dates in YYYY-MM-DD form', () => {
    expect(parseCalendarDate('2000-02-29')).toEqual({ y: 2000, m: 2, d: 29 });
    for (const bad of ['2001-02-29', '1900-02-29', '1990-13-01', '1990-04-31', '1990-4-1', '15/04/1990', '1990-04-15T00:00:00Z', '']) expect(parseCalendarDate(bad), bad).toBeNull();
  });

  it('counts completed years by calendar date, not milliseconds', () => {
    expect(ageOn({ y: 2008, m: 10, d: 27 }, today)).toBe(18);
    expect(ageOn({ y: 2008, m: 10, d: 28 }, today)).toBe(17);
    // A 29 February birthday is reached on 1 March in common years.
    expect(ageOn({ y: 2008, m: 2, d: 29 }, { y: 2026, m: 2, d: 28 })).toBe(17);
    expect(ageOn({ y: 2008, m: 2, d: 29 }, { y: 2026, m: 3, d: 1 })).toBe(18);
  });

  it('enforces 18+ and rejects future and implausible dates', () => {
    expect(dateOfBirthProblem('2008-10-27', today)).toBeNull();
    expect(dateOfBirthProblem('2008-10-28', today)).toMatch(/at least 18/);
    expect(dateOfBirthProblem('2026-10-28', today)).toMatch(/future/);
    expect(dateOfBirthProblem('1900-01-01', today)).toMatch(/year/);
    expect(dateOfBirthProblem('2001-02-29', today)).toMatch(/valid/);
  });

  it('uses the UTC calendar day', () => {
    expect(utcToday(new Date('2026-10-27T23:59:59-05:00'))).toEqual({ y: 2026, m: 10, d: 28 });
  });
});

describe('codes, addresses and passwords', () => {
  it('pastes codes with spaces or dashes', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode('12-34-56-78')).toBe('123456');
  });

  it('masks addresses for display', () => {
    expect(maskAddress('player@example.test')).toBe('pl••••@example.test');
    expect(maskAddress('a@example.test')).toBe('a•@example.test');
  });

  it('applies the same password policy in the browser and on the server', () => {
    expect(passwordProblems('short')).not.toHaveLength(0);
    expect(passwordProblems('correct horse battery staple')).toHaveLength(0);
    expect(passwordProblems('alice-is-my-password', { username: 'alice' })).toContain('Do not include your username.');
  });
});

function walk(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p, name) : e === name ? [p] : [];
  });
}

describe('the onboarding gate is declared on every entry point', () => {
  it('no page reads the raw session except those that must see a pending account', () => {
    // These redirect pending players themselves (to /onboarding) or are the onboarding page.
    const RAW_OK = new Set(['src/app/login/page.tsx', 'src/app/register/page.tsx', 'src/app/verify-email/page.tsx']);
    for (const p of walk('src/app', 'page.tsx')) {
      const src = readFileSync(p, 'utf8');
      if (RAW_OK.has(p.split(path.sep).join('/'))) continue;
      expect(src, p).not.toMatch(/currentSession\(\)/);
    }
  });

  it('only the expected API routes are open to players who have not finished onboarding', () => {
    const open = walk('src/app/api', 'route.ts')
      .filter((r) => readFileSync(r, 'utf8').includes("onboarding: 'allow'"))
      .map((r) => path.dirname(r).split(path.sep).join('/').replace('src/app/api/', ''))
      .sort();
    expect(open).toEqual(['account', 'account/email', 'account/email/confirm', 'account/export', 'account/password', 'account/profile', 'auth/logout', 'auth/me', 'onboarding']);
  });
});
