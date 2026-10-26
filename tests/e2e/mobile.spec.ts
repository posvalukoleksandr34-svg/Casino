import { expect, test } from '@playwright/test';
import { registerPlayer } from './helpers';

test('mobile layout: no horizontal page scroll and dice playable', async ({ page }) => {
  await registerPlayer(page);
  await page.goto('/games/dice');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/games/dice/rounds'));
  await page.getByTestId('dice-roll-button').click();
  expect((await response).status()).toBe(201);
});
