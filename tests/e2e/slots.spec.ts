import { expect, test, type Page } from '@playwright/test';
import { registerPlayer } from './helpers';

const chips = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(minor / 100);

function roundResponse(page: Page, gameId: string) {
  return page.waitForResponse((r) => r.url().endsWith(`/api/games/${gameId}/rounds`) && r.request().method() === 'POST');
}

test.describe('video slots', () => {
  test('a spin on each machine settles on the server, animates, and updates the balance afterwards', async ({ page }) => {
    test.setTimeout(180_000);
    await registerPlayer(page);
    for (const id of ['lantern-hollow', 'ember-fruits', 'sands-of-aurum']) {
      await page.goto(`/games/${id}`);
      const stage = page.getByTestId('slot-stage');
      await expect(stage).toHaveAttribute('data-phase', 'idle');
      await expect(page.getByTestId('slot-reels')).toBeVisible();
      if (id === 'ember-fruits') {
        await page.getByTestId('slot-turbo').click();
        await expect(page.getByTestId('slot-turbo')).toHaveAttribute('aria-pressed', 'true');
      }
      const res = roundResponse(page, id);
      await page.getByTestId('slot-spin').click();
      const body = await (await res).json();
      expect(body.round.status).toBe('SETTLED');
      const state = body.round.state as { base: { stops: number[]; grid: string[][] }; freeSpins: unknown[]; totalE2: number };
      expect(state.base.stops).toHaveLength(5);
      expect(body.round.payout).toBe(Math.floor((body.round.stake * state.totalE2) / 100));
      // While the reels turn, the spin button is locked; the presentation ends in "done".
      await expect(page.getByTestId('slot-spin')).toBeDisabled();
      await expect(stage).toHaveAttribute('data-phase', 'done', { timeout: 120_000 });
      // The reels show the server's final grid (top-to-bottom per reel).
      const label = await page.getByTestId('slot-reels').getAttribute('aria-label');
      expect(label).toContain(state.base.grid[0]!.join(' '));
      await expect(page.getByTestId('header-balance')).toHaveText(chips(body.balance));
      await expect(page.getByTestId('slot-result')).toBeVisible();
    }
    // The spin appears in history.
    await page.goto('/history');
    await expect(page.getByText('Sands of Aurum').first()).toBeVisible();
  });

  test('a stake above the table limit cannot be sent', async ({ page }) => {
    await registerPlayer(page);
    await page.goto('/games/lantern-hollow');
    await page.getByLabel('Stake').fill('500');
    await expect(page.getByTestId('slot-spin')).toBeDisabled();
  });
});
