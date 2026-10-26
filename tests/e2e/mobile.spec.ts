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

test('mobile layout: key pages fit the screen without horizontal scrolling', async ({ page }) => {
  await registerPlayer(page);
  for (const path of ['/', '/lobby', '/games/blackjack', '/games/mines', '/games/crash', '/games/roulette', '/wallet', '/history', '/responsible-play', '/fairness', '/rules/blackjack', '/settings']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
