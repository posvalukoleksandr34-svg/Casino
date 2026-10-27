import { expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { E2E_MAIL_DIR, PASSWORD } from './env';

let n = 0;

/**
 * Each test context presents its own client address. The e2e server trusts one
 * proxy hop (TRUST_PROXY_HOPS=1), exactly as production does behind the proxy,
 * so per-IP limits (e.g. 10 registrations per hour) apply per simulated client
 * instead of throttling the whole suite, which all runs from 127.0.0.1.
 */
async function asDistinctClient(page: Page) {
  const ip = `10.${(process.pid % 250) + 1}.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`;
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
}

/** The six-digit code from the newest message the SMTP sink received for `email`. */
export async function codeFromMail(email: string, after = 0): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const files = readdirSync(E2E_MAIL_DIR).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.reverse()) {
      if (Number(f.split('-')[0]) < after) break;
      const m = JSON.parse(readFileSync(path.join(E2E_MAIL_DIR, f), 'utf8')) as { to: string[]; body: string };
      if (!m.to.includes(email.toLowerCase())) continue;
      const code = /\n {4}(\d{6})\r?\n/.exec(m.body)?.[1];
      if (code) return code;
    }
    if (Date.now() > deadline) throw new Error(`no verification e-mail for ${email}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The reset link (path and query) from the newest password e-mail the sink received for `email`. */
export async function linkFromMail(email: string, after = 0): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    for (const f of readdirSync(E2E_MAIL_DIR).filter((f) => f.endsWith('.json')).sort().reverse()) {
      if (Number(f.split('-')[0]) < after) break;
      const m = JSON.parse(readFileSync(path.join(E2E_MAIL_DIR, f), 'utf8')) as { to: string[]; body: string };
      const link = m.to.includes(email.toLowerCase()) ? /https?:\/\/[^/\s]+(\/reset-password\?token=[A-Za-z0-9_-]+)/.exec(m.body)?.[1] : undefined;
      if (link) return link;
    }
    if (Date.now() > deadline) throw new Error(`no reset e-mail for ${email}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export const PROFILE = { firstName: 'Zoë', lastName: "D'Arcy-Smith", day: '15', month: 'April', year: '1990', country: 'United Kingdom', phone: '020 7946 0018' };

/** Step 1 only: fills and submits the registration form; ends on the verification page. */
export async function startRegistration(page: Page): Promise<{ email: string; username: string; startedAt: number }> {
  n += 1;
  await asDistinctClient(page);
  const username = `e2e_${Date.now().toString(36)}${n}`;
  const email = `${username}@example.test`;
  const startedAt = Date.now() - 1000;
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByLabel(/I confirm I am at least 18 years old/).check();
  await page.getByLabel(/I understand chips are free and virtual/).check();
  await page.getByLabel(/I accept the Terms of Service/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/verify-email');
  await expect(page.getByTestId('verify-email-address')).toHaveText(email);
  return { email, username, startedAt };
}

/** Step 3: fills the profile form with the test persona and enters the lobby. */
export async function completeProfile(page: Page) {
  await page.waitForURL('**/onboarding');
  await page.getByLabel('First name').fill(PROFILE.firstName);
  await page.getByLabel('Last name').fill(PROFILE.lastName);
  await page.getByLabel('Day').fill(PROFILE.day);
  await page.getByLabel('Month').selectOption({ label: PROFILE.month });
  await page.getByLabel('Year').fill(PROFILE.year);
  const country = page.getByRole('combobox', { name: 'Country of residence' });
  await country.fill('United King');
  await page.getByRole('option', { name: /United Kingdom/ }).click();
  await expect(page.getByRole('combobox', { name: 'Country code' })).toHaveValue('United Kingdom (+44)');
  await page.getByLabel('Phone number').fill(PROFILE.phone);
  await page.getByRole('button', { name: 'Save and enter the lobby' }).click();
  await page.waitForURL('**/lobby?welcome=1');
}

/**
 * The complete journey: register → code from the SMTP sink → verify →
 * complete the profile → lobby with the welcome chips.
 */
export async function registerPlayer(page: Page): Promise<{ email: string; username: string }> {
  const { email, username, startedAt } = await startRegistration(page);
  await page.getByLabel('Verification code').fill(await codeFromMail(email, startedAt));
  await completeProfile(page);
  await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');
  return { email, username };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby**');
}

/** Parses "1,234.56" into minor units. */
export function toMinor(text: string): number {
  const clean = text.replace(/[^0-9.\-+]/g, '');
  const [whole, frac = ''] = clean.replace(/^[+]/, '').split('.');
  const sign = clean.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, '0').slice(0, 2)));
}
