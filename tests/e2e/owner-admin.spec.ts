import { expect, test } from '@playwright/test';
import { login, registerPlayer } from './helpers';
import { MODERATOR, OWNER } from './env';

test.describe('owner back office', () => {
  test('dashboard, user search, chip grant, suspension and the audit trail', async ({ browser }) => {
    const playerPage = await (await browser.newContext()).newPage();
    const { username } = await registerPlayer(playerPage);

    const ctx = await browser.newContext();
    const owner = await ctx.newPage();
    await login(owner, OWNER.email, OWNER.password);
    await owner.goto('/admin');
    await expect(owner.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    await expect(owner.getByText('House net (virtual)')).toBeVisible();
    await owner.getByRole('link', { name: '30 days' }).click();
    await expect(owner.getByText('Last 30 days', { exact: true }).first()).toBeVisible();

    // Find the player and grant virtual test chips.
    await owner.goto('/admin/users');
    await owner.getByLabel('Search').fill(username);
    await owner.getByRole('button', { name: 'Apply' }).click();
    await owner.getByRole('link', { name: username }).click();
    await expect(owner.getByRole('heading', { level: 1, name: username })).toBeVisible();
    await owner.getByRole('button', { name: 'Grant test chips' }).click();
    await owner.getByLabel('Amount (chips)').fill('250');
    await owner.getByLabel(/Reason/).fill('E2E test chips for QA');
    const granted = owner.waitForResponse((r) => r.url().includes('/grant') && r.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Confirm' }).click();
    const res = await granted;
    expect(res.status()).toBe(201);
    expect((await res.json()).balance).toBe(1_025_000);
    await expect(owner.getByText('10,250.00').first()).toBeVisible();

    // Suspend: the player's session ends immediately.
    await owner.getByRole('button', { name: 'Suspend' }).click();
    await owner.getByLabel(/Reason/).fill('E2E suspension check');
    const suspended = owner.waitForResponse((r) => r.url().endsWith('/status') && r.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Confirm' }).click();
    expect((await suspended).status()).toBe(200);
    await expect(owner.getByRole('button', { name: 'Reinstate' })).toBeVisible();
    const me = await playerPage.request.get('/api/wallet');
    expect(me.status()).toBe(401);

    await owner.getByRole('button', { name: 'Reinstate' }).click();
    await owner.getByLabel(/Reason/).fill('E2E review finished');
    const reinstated = owner.waitForResponse((r) => r.url().endsWith('/status') && r.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Confirm' }).click();
    expect((await reinstated).status()).toBe(200);
    await expect(owner.getByRole('button', { name: 'Suspend' })).toBeVisible();

    // The audit log records all three with the owner's role.
    await owner.goto(`/admin/audit?actor=e2e_owner`);
    for (const reason of ['E2E test chips for QA', 'E2E suspension check', 'E2E review finished']) {
      await expect(owner.getByRole('cell', { name: reason }).first()).toBeVisible();
    }
    await expect(owner.getByText('owner', { exact: true }).first()).toBeVisible();

    // The ledger shows the grant.
    await owner.goto('/admin/ledger?type=CHIP_GRANT');
    await expect(owner.getByText('Virtual test chips granted: E2E test chips for QA').first()).toBeVisible();
    await ctx.close();
  });

  test('a moderator sees only what the role allows; the server refuses the rest', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, MODERATOR.email, MODERATOR.password);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Back office' }).getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    const audit = await page.goto('/admin/audit');
    expect(audit?.status()).toBe(404);
    const owner = await page.request.get('/api/admin/security');
    expect(owner.status()).toBe(403);
    // Opening a player: suspension is offered, money and roles are not.
    await page.goto('/admin/users?role=PLAYER');
    await page.locator('tbody tr').first().getByRole('link').first().click();
    await expect(page.getByRole('button', { name: /Suspend|Reinstate/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grant test chips' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Balance correction' })).toHaveCount(0);
    await ctx.close();
  });

  test('admin pages have labelled controls and fit a phone screen', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const page = await ctx.newPage();
    await login(page, OWNER.email, OWNER.password);
    for (const path of ['/admin', '/admin/users', '/admin/ledger', '/admin/games', '/admin/games/dice', '/admin/sports', '/admin/audit', '/admin/security']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
      const unlabelled = await page.evaluate(() =>
        [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => (el as HTMLInputElement).type !== 'hidden' && (el as HTMLElement).offsetParent !== null)
          .filter((el) => !((el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('aria-label')))
          .map((el) => (el as HTMLInputElement).name || el.id),
      );
      expect(unlabelled, path).toEqual([]);
    }
    await page.getByRole('button', { name: 'Menu' }).first().click();
    await expect(page.locator('#admin-drawer')).toBeVisible();
    await ctx.close();
  });
});
