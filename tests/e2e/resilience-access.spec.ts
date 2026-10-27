import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { linkFromMail, login, registerPlayer } from './helpers';

test.describe('interrupted requests, access control and honest states', () => {
  test('a wager whose response is lost is recovered safely and charged exactly once', async ({ page }) => {
    await registerPlayer(page);
    await page.goto('/games/dice');
    let reachedServer = 0;
    await page.route('**/api/games/dice/rounds', async (route) => {
      if (reachedServer === 0) {
        reachedServer += 1;
        await route.fetch(); // the server processes the wager…
      }
      await route.abort('connectionreset'); // …but the browser never sees a response (nor for its automatic retries)
    });
    await page.getByTestId('dice-roll-button').click();
    await expect(page.getByText('A request may not have completed')).toBeVisible({ timeout: 30_000 });

    await page.unroute('**/api/games/dice/rounds');
    await page.getByRole('button', { name: 'Retry safely' }).click();
    await expect(page.getByText('A request may not have completed')).toHaveCount(0);

    const history = await (await page.request.get('/api/rounds?game=dice')).json();
    expect(history.items).toHaveLength(1); // one round, not two
    const round = history.items[0];
    const wallet = await (await page.request.get('/api/wallet')).json();
    expect(wallet.balance).toBe(1_000_000 - round.stake + (round.payout ?? 0));
    await expect(page.getByTestId('header-balance')).toHaveText(
      (wallet.balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    );
  });

  test('every admin API refuses players and anonymous visitors', async ({ page, baseURL }) => {
    const endpoints: [string, string][] = [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/analytics'],
      ['GET', '/api/admin/reconciliation'],
      ['GET', '/api/admin/health'],
      ['POST', '/api/admin/reconciliation'],
      ['POST', `/api/admin/users/${randomUUID()}/adjust`],
      ['POST', `/api/admin/users/${randomUUID()}/role`],
      ['POST', '/api/admin/house/fund'],
      ['PATCH', '/api/admin/platform'],
      ['POST', `/api/admin/sports/events/${randomUUID()}`],
      ['POST', `/api/admin/users/${randomUUID()}/grant`],
      ['DELETE', `/api/admin/users/${randomUUID()}/sessions`],
      ['GET', '/api/admin/ledger'],
      ['GET', '/api/admin/security'],
      ['POST', '/api/admin/security'],
      ['POST', '/api/admin/sports/fixtures'],
      ['GET', `/api/admin/sports/events/${randomUUID()}/preview?void=1`],
    ];
    const call = (method: string, url: string) =>
      page.request.fetch(url, { method, data: method === 'GET' ? undefined : {}, headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() } });
    for (const [m, u] of endpoints) expect((await call(m, u)).status(), `${m} ${u} anonymous`).toBe(401);
    await registerPlayer(page);
    for (const [m, u] of endpoints) expect((await call(m, u)).status(), `${m} ${u} as player`).toBe(403);
  });

  test('public readiness reports pass/fail only, without internal details', async ({ page }) => {
    const res = await page.request.get('/api/health/ready');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    for (const c of body.checks) expect(Object.keys(c).sort()).toEqual(['ms', 'name', 'ok']);
  });

  test('password recovery delivers a single-use link through the configured e-mail transport', async ({ page, context }) => {
    const { email } = await registerPlayer(page);
    await context.clearCookies();
    const requestedAt = Date.now() - 1000;
    await page.goto('/forgot-password');
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('Request received')).toBeVisible();
    const link = await linkFromMail(email, requestedAt);
    await page.goto(link);
    await page.getByLabel('New password').fill('a brand new e2e passphrase');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await login(page, email, 'a brand new e2e passphrase');
  });

  test('signed-out visitors see a sign-in prompt, not a balance error', async ({ page }) => {
    for (const game of ['dice', 'blackjack', 'mines']) {
      await page.goto(`/games/${game}`);
      await expect(page.getByText('Sign in to play').first()).toBeVisible();
      await expect(page.getByText('Stake exceeds your balance')).toHaveCount(0);
    }
  });
});
