import { expect, test, type Page } from '@playwright/test';
import { registerPlayer } from './helpers';

const chips = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(minor / 100);

function roundResponse(page: Page, gameId: string) {
  return page.waitForResponse((r) => r.url().endsWith(`/api/games/${gameId}/rounds`) && r.request().method() === 'POST');
}

test.describe('lobby, new games, profile and sports', () => {
  test('lobby search and favourites', async ({ page }) => {
    await registerPlayer(page);
    const grid = page.getByTestId('lobby-grid');
    await page.getByLabel('Search games').fill('keno');
    await expect(grid.locator('article')).toHaveCount(1);
    await expect(grid.locator('article[data-game="keno"]')).toBeVisible();

    await page.getByLabel('Search games').fill('no such game');
    await expect(page.getByText('No games match “no such game”')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(grid.locator('article')).toHaveCount(9);

    await page.getByRole('button', { name: 'Add Plinko to favourites' }).click();
    await expect(page.getByRole('button', { name: 'Remove Plinko from favourites' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await page.getByRole('radio', { name: /Favourites/ }).click();
    await expect(grid.locator('article')).toHaveCount(1);
    await expect(grid.locator('article[data-game="plinko"]')).toBeVisible();
  });

  test('one round of each new game settles and updates the balance', async ({ page }) => {
    await registerPlayer(page);

    await page.goto('/games/limbo');
    let res = roundResponse(page, 'limbo');
    await page.getByTestId('limbo-play').click();
    let body = await (await res).json();
    expect(body.round.status).toBe('SETTLED');
    await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));

    await page.goto('/games/keno');
    await page.getByRole('button', { name: 'Random pick' }).click();
    res = roundResponse(page, 'keno');
    await page.getByTestId('keno-play').click();
    body = await (await res).json();
    expect(body.round.status).toBe('SETTLED');
    expect(body.round.state.drawn).toHaveLength(10);
    await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));

    await page.goto('/games/plinko');
    res = roundResponse(page, 'plinko');
    await page.getByTestId('plinko-drop').click();
    body = await (await res).json();
    expect(body.round.status).toBe('SETTLED');
    await expect(page.getByTestId('plinko-outcome')).toContainText('Landed in slot', { timeout: 15_000 });
    await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));

    // Hi-Lo: start, make one guess, cash out if it was right.
    await page.goto('/games/hilo');
    res = roundResponse(page, 'hilo');
    await page.getByTestId('hilo-start').click();
    body = await (await res).json();
    expect(body.round.status).toBe('OPEN');
    expect(JSON.stringify(body.round.state)).not.toContain('sequence');
    const higher = page.getByTestId('hilo-higher');
    const direction = (await higher.isEnabled()) ? 'higher' : 'lower';
    const action = page.waitForResponse((r) => /\/api\/rounds\/[^/]+\/actions$/.test(r.url()) && r.request().method() === 'POST');
    await page.getByTestId(`hilo-${direction}`).click();
    body = await (await action).json();
    if (body.round.status === 'OPEN') {
      const cashout = page.waitForResponse((r) => /\/api\/rounds\/[^/]+\/actions$/.test(r.url()) && r.request().method() === 'POST');
      await page.getByTestId('hilo-cashout').click();
      body = await (await cashout).json();
    }
    expect(body.round.status).toBe('SETTLED');
    await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));

    await page.goto('/history');
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(4);
  });

  test('profile: display name and avatar are saved', async ({ page }) => {
    await registerPlayer(page);
    await page.goto('/profile');
    await page.getByLabel('Display name').fill('E2E Tester');
    const avatars = page.getByRole('radiogroup', { name: 'Avatar' }).getByRole('radio');
    await avatars.nth(1).click();
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('E2E Tester');
    await expect(avatars.nth(1)).toHaveAttribute('aria-checked', 'true');
  });

  test('sports: a demo prediction is placed and listed', async ({ page }) => {
    await registerPlayer(page);
    await page.goto('/sports');
    await expect(page.getByText(/Demo/).first()).toBeVisible();
    // The latest fixture on the board is hours away, so its market is open for the whole test.
    const price = page.locator('[data-selection]:not([disabled])').last();
    await price.click();
    await expect(page.getByTestId('slip-item')).toHaveCount(1);
    const placed = page.waitForResponse((r) => r.url().endsWith('/api/sports/tickets') && r.request().method() === 'POST');
    await page.getByTestId('slip-place').click();
    const response = await placed;
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0].status).toBe('ACCEPTED');
    expect(body.tickets[0].stake).toBe(1000);
    expect(body.balance).toBe(1_000_000 - 1000);
    await expect(page.getByTestId('slip-results')).toContainText('Accepted');
    await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));

    await page.goto('/sports/tickets');
    await expect(page.getByText(chips(body.tickets[0].potentialReturn)).first()).toBeVisible();
  });
});
