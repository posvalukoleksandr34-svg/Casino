import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { login, registerPlayer } from './helpers';
import { OWNER } from './env';

const chips = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(minor / 100);

async function post(page: Page, baseURL: string, path: string, data: unknown) {
  return page.request.post(path, { data, headers: { Origin: baseURL, 'Idempotency-Key': randomUUID() } });
}

test.describe('casino platform journeys', () => {
  test('register → claim the welcome bonus → play → wagering progress and locked credits in the cashier', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await registerPlayer(page);

    // The home page greets the player with their balance.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await expect(page.getByTestId('live-feed')).toBeVisible();

    // Claim the welcome offer: locked, not added to the spendable balance.
    await page.goto('/promotions');
    await page.getByTestId('claim-offer').click();
    const active = page.getByTestId('active-bonus');
    await expect(active).toBeVisible();
    await expect(page.getByTestId('wagering-progress')).toContainText(`0.00 of ${chips(1_000_000)} wagered`);
    await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');
    await expect(page.getByTestId('claim-offer')).toHaveCount(0);

    // Two dice rounds of 10 credits each, through the API the game screen uses.
    for (let i = 0; i < 2; i++) {
      const res = await post(page, baseURL!, '/api/games/dice/rounds', { bet: { amount: 1_000, target: 5000, direction: 'under' } });
      expect(res.status()).toBe(201);
    }
    await page.reload();
    await expect(page.getByTestId('wagering-progress')).toContainText(`${chips(2_000)} of ${chips(1_000_000)} wagered`);

    // The cashier: available = the server balance; the bonus shows as locked.
    const wallet = await (await page.request.get('/api/wallet/summary')).json();
    expect(wallet.lockedBonus).toBe(1_000_000);
    expect(wallet.totals.wagered).toBe(2_000);
    await page.goto('/wallet');
    await expect(page.getByRole('heading', { name: 'Cashier' })).toBeVisible();
    await expect(page.getByTestId('cashier-available')).toHaveText(chips(wallet.available));
    await expect(page.getByTestId('cashier-locked')).toHaveText(chips(1_000_000));
    await expect(page.getByTestId('cashier-bonus')).toBeVisible();

    // A second claim of the same offer is refused by the server.
    const again = await post(page, baseURL!, '/api/promotions/claim', { campaignId: (await (await page.request.get('/api/promotions')).json()).claims[0].id });
    expect(again.status()).toBeGreaterThanOrEqual(400);
  });

  test('free top-up: offered only below the threshold, three steps, no payment details, recorded in history', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await registerPlayer(page);
    await page.goto('/wallet');
    // 10,000 credits is above the 5,000 threshold: the package is not available.
    await expect(page.getByTestId('top-up-package')).toBeDisabled();
    await expect(page.getByTestId('top-up')).toContainText('below 5,000.00');

    // Lose most of the balance on 20% shots (server-decided; repeat until below the threshold).
    // 20% keeps the largest payout (≈4.95× of 10,000) under the dice per-round cap.
    for (let i = 0; i < 30; i++) {
      const { balance } = await (await page.request.get('/api/wallet')).json();
      if (balance < 500_000) break;
      const stake = Math.min(balance, 1_000_000);
      const res = await post(page, baseURL!, '/api/games/dice/rounds', { bet: { amount: stake, target: 2000, direction: 'under' } });
      expect(res.status()).toBe(201);
    }
    const before = (await (await page.request.get('/api/wallet')).json()).balance as number;
    test.skip(before >= 500_000, 'thirty 20% shots kept the balance above the threshold (vanishingly unlikely); nothing to top up');

    await page.reload();
    await page.getByTestId('top-up-package').click();
    await expect(page.getByText('Free — nothing to pay')).toBeVisible();
    await expect(page.getByText('None needed')).toBeVisible();
    // No financial fields exist anywhere in the flow.
    await expect(page.getByTestId('top-up').locator('input')).toHaveCount(0);
    await page.getByTestId('top-up-confirm').click();
    await expect(page.getByTestId('top-up-receipt')).toContainText('1,000.00 free credits added');
    await expect(page.getByTestId('header-balance')).toHaveText(chips(before + 100_000));
    await page.goto('/wallet/transactions');
    await expect(page.getByText('Free daily top-up').first()).toBeVisible();
  });

  test('the live feed streams public snapshots without any account data', async ({ page }) => {
    await page.goto('/');
    const once = await (await page.request.get('/api/live?once=1')).json();
    expect(typeof once.online).toBe('number');
    expect(Array.isArray(once.wins)).toBe(true);
    for (const w of once.wins) expect(Object.keys(w).sort()).toEqual(['at', 'game', 'gameId', 'multiplierE2', 'payout', 'player']);
    const event = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const es = new EventSource('/api/live');
          es.addEventListener('snapshot', (e) => {
            es.close();
            resolve((e as MessageEvent<string>).data);
          });
          setTimeout(() => resolve('timeout'), 10_000);
        }),
    );
    expect(JSON.parse(event)).toHaveProperty('online');
  });

  test('owner creates a promo code in the back office; a player redeems it; the leaderboard renders', async ({ browser }) => {
    test.setTimeout(120_000);
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    const owner = await (await browser.newContext()).newPage();
    await login(owner, OWNER.email, OWNER.password);
    await owner.goto('/admin/promotions');
    await expect(owner.getByRole('heading', { level: 1, name: 'Promotions' })).toBeVisible();
    const form = owner.getByTestId('create-campaign');
    await form.getByLabel('Slug').fill(code.toLowerCase());
    await form.getByLabel('Code').fill(code);
    await form.getByLabel('Name').fill('E2E promo');
    await form.getByLabel('Description').fill('Created by the end-to-end test');
    await form.getByLabel('Fixed amount (credits)').fill('500');
    await form.getByLabel('Maximum bonus (credits)').fill('500');
    await form.getByLabel('Wagering multiple').fill('0');
    await form.getByLabel(/Reason/).fill('E2E promo code check');
    const created = owner.waitForResponse((r) => r.url().endsWith('/api/admin/promotions') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Create campaign' }).click();
    expect((await created).status()).toBe(200);
    await expect(owner.getByText(code).first()).toBeVisible();

    const player = await (await browser.newContext()).newPage();
    await registerPlayer(player);
    await player.goto('/promotions');
    await player.getByRole('textbox', { name: 'Promo code' }).fill(code.toLowerCase());
    await player.getByTestId('redeem-code').click();
    // No wagering: released at once into the one wallet.
    await expect(player.getByTestId('header-balance')).toHaveText('10,500.00');
    await expect(player.getByTestId('bonus-history')).toContainText('E2E promo');

    await player.goto('/leaderboard');
    await expect(player.getByTestId('board-multipliers')).toBeVisible();
    await expect(player.getByTestId('board-levels')).toBeVisible();
  });
});
