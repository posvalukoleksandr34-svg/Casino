/**
 * Account rules shared by the browser (inline validation) and the server
 * (authoritative validation). Pure functions only: no secrets, no I/O.
 */

/** Minimum age to hold an account (the long-standing 18+ policy). */
export const MINIMUM_AGE = 18;
/** Oldest plausible age; anything older is treated as a typing mistake. */
export const MAXIMUM_AGE = 120;

/** Versions of /terms and /privacy; bump when their substance changes. */
export const TERMS_VERSION = '2026-10-27';
export const PRIVACY_VERSION = '2026-10-27';

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_TTL_MINUTES = 10;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const CODES_PER_HOUR = 5;

export const NAME_MAX_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 10;

/** Password policy (server-authoritative; the registration form shows the same checks live). */
export function passwordProblems(password: string, context: { email?: string; username?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('Use at least 10 characters.');
  if (password.length > 200) problems.push('Use at most 200 characters.');
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) problems.push('Avoid repeating a single character.');
  if (['password12', 'password123', '1234567890', 'qwertyuiop', 'letmein123'].includes(lower)) {
    problems.push('This password is too common.');
  }
  if (context.username && lower.includes(context.username.toLowerCase())) problems.push('Do not include your username.');
  if (context.email && lower.includes(context.email.split('@')[0]!.toLowerCase())) problems.push('Do not include your e-mail name.');
  return problems;
}


/**
 * Legal names: any script's letters and combining marks, with spaces,
 * apostrophes (' ’ ʼ), hyphens and full stops between them ("Nguyễn Thị",
 * "O'Brien", "Jean-Luc", "St. John", "李"). Digits, symbols and control
 * characters are refused; there is no minimum beyond one letter.
 */
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}'’ʼ.\- ]*$/u;

/** Unicode-normalised (NFC), trimmed, inner whitespace collapsed to one space. */
export function normaliseName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function nameProblem(raw: string, label: string): string | null {
  const v = normaliseName(raw);
  if (!v) return `Enter your ${label}`;
  if ([...v].length > NAME_MAX_LENGTH) return `Your ${label} can be at most ${NAME_MAX_LENGTH} characters`;
  if (!NAME_PATTERN.test(v)) return `Use letters, spaces, apostrophes, hyphens or full stops in your ${label}`;
  return null;
}

export interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/** Strict YYYY-MM-DD that names a real calendar day (2001-02-29 is refused). */
export function parseCalendarDate(raw: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (date.m < 1 || date.m > 12 || date.d < 1) return null;
  if (date.d > daysInMonth(date.y, date.m)) return null;
  return date;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Today's calendar date in UTC (the server's reference day for age checks). */
export function utcToday(now = new Date()): CalendarDate {
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
}

/**
 * Completed years between two calendar dates, by comparing (month, day)
 * rather than counting milliseconds, so leap years and time zones cannot
 * shift the result. A 29 February birthday is reached on 1 March in common
 * years (the conservative reading).
 */
export function ageOn(birth: CalendarDate, today: CalendarDate): number {
  const beforeBirthday = today.m < birth.m || (today.m === birth.m && today.d < birth.d);
  return today.y - birth.y - (beforeBirthday ? 1 : 0);
}

export function dateOfBirthProblem(raw: string, today: CalendarDate): string | null {
  const birth = parseCalendarDate(raw);
  if (!birth) return 'Enter a valid date of birth';
  const age = ageOn(birth, today);
  if (age < 0) return 'Your date of birth cannot be in the future';
  if (age > MAXIMUM_AGE) return 'Check the year of your date of birth';
  if (age < MINIMUM_AGE) return `You must be at least ${MINIMUM_AGE} years old to use Aurovane`;
  return null;
}

/** Digits only, at most the code length (paste-friendly: "123 456", "123-456"). */
export function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}

/** "jo•••@example.com"-style display for places where the full address is not needed. */
export function maskAddress(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const shown = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${shown}${'•'.repeat(Math.max(1, Math.min(6, local.length - shown.length)))}@${domain}`;
}
