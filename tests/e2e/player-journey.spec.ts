import { expect, test } from '@playwright/test';
import { registerPlayer, toMinor } from './helpers';

test.describe('core player journey', () => {
  test('register → dice → roulette → balances, transactions and history agree', async ({ page }) => {
    await registerPlayer(page);

    // Dice: one roll at 49.50% for 10 chips.
    await page.goto('/games/dice');
    const diceResponse = page.waitForResponse((r) => r.url().endsWith('/api/games/dice/rounds') && r.request().method() === 'POST');
    await page.getByTestId('dice-roll-button').click();
    const dice = await (await diceResponse).json();
    expect(dice.round.status).toBe('SETTLED');
    expect(dice.round.stake).toBe(1000);
    const afterDice = 1_000_000 - 1000 + dice.round.payout;
    expect(dice.balance).toBe(afterDice);
    await expect(page.getByTestId('dice-roll')).toHaveText((dice.round.state.roll / 100).toFixed(2));
    await expect(page.getByTestId('header-balance')).toHaveText(new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(afterDice / 100));

    // Roulette: 5 chips on red and 5 chips on 17.
    await page.goto('/games/roulette');
    await page.locator('[data-position="red"]').click();
    await page.locator('[data-position="straight:17"]').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('10.00 chips');
    const rouletteResponse = page.waitForResponse((r) => r.url().endsWith('/api/games/roulette/rounds') && r.request().method() === 'POST');
    await page.getByTestId('roulette-spin').click();
    const roulette = await (await rouletteResponse).json();
    const n = roulette.round.state.result as number;
    const red = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const expectedPayout = (red.has(n) ? 1000 : 0) + (n === 17 ? 18_000 : 0);
    expect(roulette.round.payout).toBe(expectedPayout);
    const afterRoulette = afterDice - 1000 + expectedPayout;
    expect(roulette.balance).toBe(afterRoulette);
    await expect(page.getByTestId('roulette-result')).toContainText(String(n), { timeout: 15_000 });
    await expect(page.getByTestId('header-balance')).toHaveText(new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(afterRoulette / 100));

    // Transaction history shows the bonus and both wagers.
    await page.goto('/wallet/transactions');
    const table = page.getByTestId('transactions-table');
    await expect(table).toContainText('Bonus');
    await expect(table.getByRole('cell', { name: 'Wager', exact: true })).toHaveCount(2);
    const firstRowBalance = await table.locator('tbody tr').first().locator('td').nth(4).innerText();
    expect(toMinor(firstRowBalance)).toBe(afterRoulette);

    // Game history lists both rounds and links to verifiable details.
    await page.goto('/history');
    const history = page.getByTestId('history-table');
    await expect(history.locator('tbody tr')).toHaveCount(2);
    await history.locator('tbody tr').first().getByRole('link').first().click();
    await expect(page.getByText('Server seed commitment (SHA-256)')).toBeVisible();
    await expect(page.getByText(roulette.round.fairness.serverSeedHash)).toBeVisible();
  });

  test('statistics, profile and wallet pages render for a new player', async ({ page }) => {
    await registerPlayer(page);
    for (const [path, heading] of [
      ['/stats', 'Your results'],
      ['/wallet', 'Your chips'],
      ['/settings', 'Account settings'],
      ['/responsible-play', 'Stay in control'],
      ['/fairness', 'Provably fair'],
      ['/rules', 'Published mathematics'],
      ['/rules/roulette', 'European Roulette rules'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });
});
