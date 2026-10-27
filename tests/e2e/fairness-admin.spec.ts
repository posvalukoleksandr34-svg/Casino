import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN } from './env';
import { login, registerPlayer } from './helpers';

test('rotate seed, then verify a past round in the browser verifier', async ({ page, baseURL }) => {
  await registerPlayer(page);
  const res = await page.request.post('/api/games/dice/rounds', {
    data: { bet: { amount: 100, target: 5000, direction: 'under' } },
    headers: { 'Idempotency-Key': randomUUID(), Origin: baseURL! },
  });
  const { round } = await res.json();
  await page.goto('/fairness');
  await page.getByRole('button', { name: /Rotate & reveal/ }).click();
  await expect(page.getByText('✓ matches commitment')).toBeVisible();
  await page.goto(`/history/${round.id}`);
  await page.getByRole('link', { name: 'Verify this round' }).click();
  await expect(page.getByTestId('verify-outcome')).toHaveText(`Roll ${(round.state.roll / 100).toFixed(2)}`);
});

test('admin suspends a game with a reason; players see it paused; action is audited', async ({ browser }) => {
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  await admin.goto('/admin/games');
  await admin.getByRole('link', { name: 'Dice', exact: true }).click();
  await admin.waitForURL('**/admin/games/dice');
  await admin.getByRole('button', { name: 'Change status' }).click();
  await admin.getByLabel('New status').selectOption('SUSPENDED');
  await admin.getByLabel(/Reason/).fill('E2E incident drill');
  await admin.getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('E2E incident drill').first()).toBeVisible();

  const player = await (await browser.newContext()).newPage();
  await registerPlayer(player);
  await player.goto('/games/dice');
  await expect(player.getByText('This game is paused')).toBeVisible();
  await expect(player.getByTestId('dice-roll-button')).toBeDisabled();

  await admin.goto('/admin/audit?action=game.');
  await expect(admin.getByText('E2E incident drill').first()).toBeVisible();

  await admin.goto('/admin/games/dice');
  await admin.getByRole('button', { name: 'Change status' }).click();
  await admin.getByLabel('New status').selectOption('ACTIVE');
  await admin.getByLabel(/Reason/).fill('Drill complete');
  await admin.getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('Active', { exact: true }).first()).toBeVisible();
  await ctx.close();
});
