import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD } from './env';
import { login, registerPlayer } from './helpers';

test.describe('invalid, duplicate and unauthorised requests', () => {
  test('duplicate submissions with the same Idempotency-Key charge once', async ({ page, baseURL }) => {
    await registerPlayer(page);
    const key = randomUUID();
    const body = { bet: { amount: 2500, target: 5000, direction: 'under' } };
    const headers = { 'Idempotency-Key': key, Origin: baseURL! };
    const [a, b] = await Promise.all([
      page.request.post('/api/games/dice/rounds', { data: body, headers }),
      page.request.post('/api/games/dice/rounds', { data: body, headers }),
    ]);
    const ra = await a.json();
    const rb = await b.json();
    expect([a.status(), b.status()].sort()).toEqual([201, 201]);
    expect(ra.round.id).toBe(rb.round.id);
    const wallet = await (await page.request.get('/api/wallet')).json();
    expect(wallet.balance).toBe(1_000_000 - 2500 + (ra.round.payout ?? 0));
    const history = await (await page.request.get('/api/rounds?game=dice')).json();
    expect(history.items).toHaveLength(1);

    const conflict = await page.request.post('/api/games/dice/rounds', { data: { bet: { ...body.bet, amount: 9999 } }, headers });
    expect(conflict.status()).toBe(409);
  });

  test('invalid wagers are rejected with clear errors and no balance change', async ({ page, baseURL }) => {
    await registerPlayer(page);
    const post = (bet: unknown) => page.request.post('/api/games/dice/rounds', { data: { bet }, headers: { 'Idempotency-Key': randomUUID(), Origin: baseURL! } });
    expect((await post({ amount: 0, target: 5000, direction: 'under' })).status()).toBe(400);
    expect((await post({ amount: 100, target: 50, direction: 'under' })).status()).toBe(422);
    expect((await post({ amount: 100_000_000, target: 5000, direction: 'under' })).status()).toBe(422);
    expect((await post({ amount: 100, target: 5000, direction: 'under', payout: 1e9 })).status()).toBe(400);
    const cross = await page.request.post('/api/games/dice/rounds', {
      data: { bet: { amount: 100, target: 5000, direction: 'under' } },
      headers: { 'Idempotency-Key': randomUUID(), Origin: 'https://attacker.example' },
    });
    expect(cross.status()).toBe(403);
    const wallet = await (await page.request.get('/api/wallet')).json();
    expect(wallet.balance).toBe(1_000_000);

    // The UI explains a responsible-gaming or rule rejection without moving funds.
    await page.goto('/games/dice');
    await page.getByRole('textbox', { name: 'Stake' }).fill('20000');
    await expect(page.getByTestId('dice-roll-button')).toBeDisabled();
  });

  test('players cannot access the admin area; admins can', async ({ page, browser }) => {
    await registerPlayer(page);
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
    expect((await page.request.get('/api/admin/overview')).status()).toBe(403);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await login(admin, ADMIN.email, ADMIN.password);
    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { name: 'Operations dashboard' })).toBeVisible();
    await admin.goto('/admin/analytics');
    await expect(admin.getByRole('heading', { name: 'Actual vs theoretical performance' })).toBeVisible();
    await adminContext.close();
  });

  test('the post-login redirect never leaves the site', async ({ page, baseURL }) => {
    const { email } = await registerPlayer(page);
    for (const [next, expectedPath] of [
      ['/\\evil.example/', '/lobby'], // browsers read "\" as "/": this used to leave the site
      ['/\t/evil.example/', '/lobby'],
      ['https://evil.example/', '/lobby'],
      ['/wallet', '/wallet'],
    ] as const) {
      await page.context().clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL((url) => url.pathname === expectedPath || url.origin !== new URL(baseURL!).origin);
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      expect(new URL(page.url()).pathname).toBe(expectedPath);
    }
  });

  test('signed-out visitors are redirected away from account pages', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login\?next=%2Fwallet/);
    expect((await page.request.get('/api/wallet')).status()).toBe(401);
  });
});
