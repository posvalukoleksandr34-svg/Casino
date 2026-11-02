import { expect, test } from '@playwright/test';
import { codeFromMail, registerPlayer, startRegistration } from './helpers';

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
  for (const path of ['/', '/lobby', '/games/blackjack', '/games/mines', '/games/crash', '/games/roulette', '/games/limbo', '/games/keno', '/games/plinko', '/games/hilo', '/profile', '/sports', '/sports/tickets', '/wallet', '/history', '/responsible-play', '/fairness', '/rules/blackjack', '/settings', '/promotions', '/leaderboard']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

test('mobile layout: registration, verification and onboarding fit the screen', async ({ page }) => {
  await page.goto('/register');
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '/register').toBeLessThanOrEqual(1);
  const { email, startedAt } = await startRegistration(page);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '/verify-email').toBeLessThanOrEqual(1);
  await expect(page.getByLabel('Verification code')).toHaveAttribute('inputmode', 'numeric');
  await page.getByLabel('Verification code').fill(await codeFromMail(email, startedAt));
  await page.waitForURL('**/onboarding');
  const country = page.getByRole('combobox', { name: 'Country of residence' });
  await country.tap();
  await country.fill('Fra');
  await page.getByRole('option', { name: /^France/ }).tap();
  await expect(country).toHaveValue('France');
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '/onboarding').toBeLessThanOrEqual(1);
});

test('mobile layout: signed-out pages and header fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['/', '/login', '/register', '/forgot-password', '/rules', '/fairness']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  // The header's sign-in actions stay on one line.
  await page.goto('/login');
  const header = page.locator('header');
  const signIn = header.getByRole('link', { name: 'Sign in', exact: true });
  const box = await signIn.boundingBox();
  expect(box && box.height).toBeLessThan(44);
});
