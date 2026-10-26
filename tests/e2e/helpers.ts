import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './env';

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

export async function registerPlayer(page: Page): Promise<{ email: string; username: string }> {
  n += 1;
  await asDistinctClient(page);
  const username = `e2e_${Date.now().toString(36)}${n}`;
  const email = `${username}@example.test`;
  await page.goto('/register');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I confirm I am at least 18 years old.').check();
  await page.getByLabel(/I understand chips are virtual/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/lobby**');
  await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');
  return { email, username };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
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
