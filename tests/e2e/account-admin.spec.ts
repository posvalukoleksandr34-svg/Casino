/**
 * Journeys not covered elsewhere:
 *   A/F. account management: sign in with the username and "remember me",
 *        change the password, see and sign out other devices, sign-in history,
 *        notification preferences;
 *   G.   finance, compliance and support roles each reach only their sections;
 *   tournaments: the owner creates one in the back office, a player joins,
 *        plays and appears in the standings.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, registerPlayer } from './helpers';
import { OWNER, PASSWORD } from './env';

async function ownerPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await login(page, OWNER.email, OWNER.password);
  return page;
}

async function signInForm(page: Page, identifier: string, password: string, remember = false) {
  await page.goto('/login');
  await page.getByLabel('E-mail or username').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (remember) await page.getByTestId('remember-me').check();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/lobby**');
}

test.describe('account management and staff roles', () => {
  test('A + F: username sign-in with "remember me", password change, devices, sign-in history, notification preferences', async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const { username } = await registerPlayer(page);
    await page.context().clearCookies();

    // Sign in with the username; "remember me" gives a long-lived cookie.
    await signInForm(page, username, PASSWORD, true);
    const cookie = (await page.context().cookies()).find((c) => c.name.includes('session'));
    expect(cookie).toBeTruthy();
    expect(cookie!.expires * 1000 - Date.now()).toBeGreaterThan(20 * 86_400_000);

    // A second device.
    const other = await (await browser.newContext()).newPage();
    await signInForm(other, username, PASSWORD);
    expect((await other.request.get('/api/wallet')).status()).toBe(200);

    // Security page: both devices listed; sign out the other one.
    await page.goto('/settings/security');
    await expect(page.getByTestId('devices')).toContainText('This device');
    await expect(page.getByTestId('devices')).toContainText('Remembered');
    await page.getByTestId('sign-out-others').click();
    await expect(page.getByTestId('sign-out-others')).toHaveCount(0);
    expect((await other.request.get('/api/wallet')).status()).toBe(401);
    await expect(page.getByTestId('sign-in-history')).toContainText('Signed in');

    // Change the password; the new one works, the old one does not.
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password').fill('a different e2e passphrase');
    const changed = page.waitForResponse((r) => r.url().endsWith('/api/account/password'));
    await page.getByRole('button', { name: 'Update password' }).click();
    expect((await changed).status()).toBe(200);
    const fresh = await (await browser.newContext()).newPage();
    const bad = await fresh.request.post('/api/auth/login', { data: { email: username, password: PASSWORD }, headers: { Origin: baseURL! } });
    expect(bad.status()).toBe(401);
    await signInForm(fresh, username, 'a different e2e passphrase');

    // Notification preferences: e-mail copies per kind; security stays on.
    await page.goto('/notifications');
    const prefs = page.getByTestId('notification-prefs');
    await expect(prefs.getByRole('checkbox').last()).toBeVisible();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/notifications/preferences') && r.request().method() === 'PUT');
    await prefs.getByRole('checkbox').first().click();
    await prefs.getByRole('button', { name: 'Save preferences' }).click();
    expect((await saved).status()).toBe(200);

    // The account tabs reach every account section.
    await page.goto('/profile');
    await expect(page.getByTestId('account-summary')).toContainText('Player ID');
    for (const tab of ['Wallet', 'Transactions', 'Rewards', 'VIP', 'Game history', 'Achievements', 'Security', 'Responsible gaming']) {
      await page.getByTestId('account-tabs').getByRole('link', { name: tab, exact: true }).click();
      await expect(page.getByTestId('account-tabs').getByRole('link', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('G: finance, compliance and support staff reach only their own sections', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const owner = await ownerPage(browser);
    const roles = ['FINANCE_MANAGER', 'COMPLIANCE_MANAGER', 'SUPPORT'] as const;
    const staff: Record<string, { page: Page; username: string }> = {};
    for (const role of roles) {
      const page = await (await browser.newContext()).newPage();
      const { username } = await registerPlayer(page);
      const me = (await (await page.request.get('/api/auth/me')).json()).user as { id: string };
      const res = await owner.request.post(`/api/admin/users/${me.id}/role`, { data: { role, reason: 'E2E role permission check' }, headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() } });
      expect(res.status()).toBe(200);
      await page.context().clearCookies();
      await signInForm(page, username, PASSWORD);
      staff[role] = { page, username };
    }
    const status = async (page: Page, path: string) => (await page.request.get(path)).status();

    const finance = staff.FINANCE_MANAGER!.page;
    expect(await status(finance, '/api/admin/payments')).toBe(200);
    expect(await status(finance, '/api/admin/payments/withdrawals')).toBe(200);
    expect(await status(finance, '/api/admin/kyc')).toBe(403);
    expect(await status(finance, '/api/admin/support')).toBe(403);
    const patch = await finance.request.patch('/api/admin/payments/settings', { data: { patch: { withdrawalCooldownMinutes: 0 }, reason: 'Permission probe' }, headers: { Origin: baseURL! } });
    expect(patch.status()).toBe(403);
    await finance.goto('/admin');
    const financeNav = finance.getByRole('navigation', { name: 'Back office' });
    await expect(financeNav.getByRole('link', { name: 'Payments' })).toBeVisible();
    await expect(financeNav.getByRole('link', { name: 'Verification' })).toHaveCount(0);
    await expect(financeNav.getByRole('link', { name: 'Support' })).toHaveCount(0);

    const compliance = staff.COMPLIANCE_MANAGER!.page;
    expect(await status(compliance, '/api/admin/kyc')).toBe(200);
    expect(await status(compliance, '/api/admin/payments')).toBe(200);
    const review = await compliance.request.post(`/api/admin/payments/withdrawals/${randomUUID()}/review`, { data: { decision: 'approve', note: 'Permission probe' }, headers: { Origin: baseURL! } });
    expect(review.status()).toBe(403);
    expect(await status(compliance, '/api/admin/support')).toBe(403);

    const support = staff.SUPPORT!.page;
    expect(await status(support, '/api/admin/support')).toBe(200);
    expect(await status(support, '/api/admin/payments')).toBe(403);
    expect(await status(support, '/api/admin/kyc')).toBe(403);
    await support.goto('/admin');
    const supportNav = support.getByRole('navigation', { name: 'Back office' });
    await expect(supportNav.getByRole('link', { name: 'Support' })).toBeVisible();
    await expect(supportNav.getByRole('link', { name: 'Payments' })).toHaveCount(0);
    await expect(supportNav.getByRole('link', { name: 'Verification' })).toHaveCount(0);
  });

  test('tournaments: the owner creates one, a player joins and plays, and appears in the standings', async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const owner = await ownerPage(browser);
    const slug = `e2e-${Date.now().toString(36)}`;
    await owner.goto('/admin/tournaments');
    const form = owner.getByTestId('create-tournament');
    await form.getByLabel('Slug').fill(slug);
    await form.getByLabel('Name').fill('E2E Dice Cup');
    await form.getByLabel('Description').fill('Created by the end-to-end test');
    await form.getByLabel('Dice', { exact: true }).check();
    await form.getByLabel('Prizes by place (credits, comma-separated)').fill('300, 100');
    await form.getByLabel(/Reason/).fill('E2E tournament check');
    const created = owner.waitForResponse((r) => r.url().endsWith('/api/admin/tournaments') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Create tournament' }).click();
    expect((await created).status()).toBe(200);

    await registerPlayer(page);
    await page.goto(`/tournaments/${slug}`);
    await expect(page.getByTestId('prizes')).toContainText('300.00');
    await page.getByTestId('join-tournament').click();
    await expect(page.getByText('You are in')).toBeVisible();
    // Rounds after joining count: 90% shots almost always pay a little over 1×.
    for (let i = 0; i < 4; i++) {
      const r = await page.request.post('/api/games/dice/rounds', { data: { bet: { amount: 1_000, target: 9_000, direction: 'under' } }, headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() } });
      expect(r.status()).toBe(201);
    }
    await page.reload();
    await expect(page.getByTestId('standings')).toContainText('You');
    await page.goto('/tournaments');
    await expect(page.getByTestId('my-tournaments')).toContainText('E2E Dice Cup');
  });
});
