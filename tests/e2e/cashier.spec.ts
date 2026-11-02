/**
 * Cashier journeys against the sandbox provider (simulated; no real money):
 *   A. deposit → simulated checkout → balance changes only after the provider's confirmation
 *   B. declined checkout → nothing credited
 *   C. withdrawal blocked until identity verification → documents → compliance verifies → withdraw → payout settled
 *   D. withdrawal above the review threshold → finance rejects → full amount returned
 *   E. support ticket with attachment → staff reply → player notified
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, registerPlayer } from './helpers';
import { OWNER } from './env';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('e2e identity document image')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

async function deposit(page: Page, amount: string, outcome: 'pay' | 'decline') {
  await page.goto('/wallet#deposit');
  const flow = page.getByTestId('deposit-flow');
  await flow.getByText('Test card (sandbox)').click();
  await flow.getByTestId('deposit-next').click();
  await flow.getByTestId('deposit-amount').fill(amount);
  await flow.getByTestId('deposit-review').click();
  await expect(flow.getByTestId('deposit-summary')).toContainText('Added to your balance');
  await flow.getByTestId('deposit-confirm').click();
  await page.waitForURL('**/wallet/sandbox-checkout/**');
  await expect(page.getByTestId('sandbox-checkout')).toContainText('Test mode');
  // No payment details are ever asked for.
  await expect(page.getByTestId('sandbox-checkout').locator('input')).toHaveCount(0);
  await page.getByTestId(outcome === 'pay' ? 'sandbox-pay' : 'sandbox-decline').click();
  await page.waitForURL('**/wallet/deposits/**');
}

async function ownerPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await login(page, OWNER.email, OWNER.password);
  return page;
}

async function confirmReasoned(page: Page, button: string, reason: string, checkbox?: string) {
  await page.getByRole('button', { name: button, exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Reason/).fill(reason);
  if (checkbox) await dialog.getByLabel(checkbox).check();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('cashier journeys (sandbox provider)', () => {
  test('A + B: a deposit is credited only after the confirmation; a declined one never', async ({ page }) => {
    test.setTimeout(120_000);
    await registerPlayer(page);
    await deposit(page, '50', 'pay');
    await expect(page.getByTestId('deposit-status')).toHaveAttribute('data-status', 'COMPLETED');
    await expect(page.getByTestId('header-balance')).toHaveText('10,050.00');
    await page.goto('/wallet/transactions');
    await expect(page.getByText('Deposit (sandbox — no real money)').first()).toBeVisible();

    await deposit(page, '75', 'decline');
    await expect(page.getByTestId('deposit-status')).toHaveAttribute('data-status', 'FAILED');
    await expect(page.getByTestId('header-balance')).toHaveText('10,050.00');
    await page.goto('/wallet/deposits');
    await expect(page.getByTestId('deposits-table')).toContainText('Completed');
    await expect(page.getByTestId('deposits-table')).toContainText('Failed');
  });

  test('C + D: identity check, compliance decision, withdrawal paid; a reviewed one rejected and returned', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const player = await registerPlayer(page);
    await deposit(page, '20', 'pay');
    await expect(page.getByTestId('header-balance')).toHaveText('10,020.00');

    // Withdrawal is blocked, with the reason and where to fix it.
    await page.goto('/wallet#withdraw');
    await expect(page.getByTestId('withdraw-blockers')).toContainText('Verify your identity');
    await page.getByRole('link', { name: /Verify identity/ }).click();

    // Upload the two required documents; uploading verifies nothing.
    await page.waitForURL('**/account/verification');
    const upload = page.getByTestId('kyc-upload');
    await upload.getByLabel('Document type').selectOption('ID_FRONT');
    await upload.locator('input[type=file]').setInputFiles({ name: 'passport.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await upload.getByTestId('kyc-upload-submit').click();
    await expect(page.getByTestId('kyc-documents')).toContainText('passport.jpg');
    await upload.getByLabel('Document type').selectOption('PROOF_OF_ADDRESS');
    await upload.locator('input[type=file]').setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: PDF });
    await upload.getByTestId('kyc-upload-submit').click();
    await expect(page.getByTestId('kyc-documents')).toContainText('bill.pdf');
    await expect(page.getByTestId('kyc-status')).toHaveAttribute('data-status', 'NOT_STARTED');
    await page.getByTestId('kyc-submit').click();
    await expect(page.getByTestId('kyc-status')).toHaveAttribute('data-status', 'PENDING');

    // Compliance (here: the owner account) verifies.
    const owner = await ownerPage(browser);
    await owner.goto('/admin/kyc');
    await owner.getByTestId('kyc-queue').getByRole('row', { name: new RegExp(player.username) }).getByRole('link', { name: /Review/ }).click();
    await confirmReasoned(owner, 'Verify identity', 'Documents match the profile (e2e)', 'I have checked every document against the profile.');
    await page.reload();
    await expect(page.getByTestId('kyc-status')).toHaveAttribute('data-status', 'VERIFIED');

    // Withdraw 25 to the test card (minimum 20): below the review threshold, sent at once.
    await page.goto('/wallet#withdraw');
    const flow = page.getByTestId('withdraw-flow');
    await flow.getByTestId('withdraw-amount').fill('25');
    await expect(flow.getByTestId('withdraw-summary')).toContainText('Paid out without manual review');
    await flow.getByTestId('withdraw-continue').click();
    await flow.getByTestId('withdraw-confirm').click();
    await expect(page.getByTestId('withdraw-receipt')).toContainText('Being paid out');
    await expect(page.getByTestId('header-balance')).toHaveText('9,995.00');

    // Finance settles it through the simulated provider.
    await owner.goto('/admin/payments');
    const settled = owner.waitForResponse((r) => r.url().includes('/sandbox') && r.request().method() === 'POST');
    await owner.getByRole('row', { name: new RegExp(player.username) }).getByRole('button', { name: 'Simulate paid' }).first().click();
    expect((await settled).status()).toBe(200);
    await page.goto('/wallet/withdrawals');
    await expect(page.getByTestId('withdrawals-table')).toContainText('Paid');

    // A larger withdrawal waits for review; finance rejects it and the full amount returns.
    await page.goto('/wallet#withdraw');
    await flow.getByTestId('withdraw-amount').fill('1500');
    await expect(flow.getByTestId('withdraw-summary')).toContainText('Checked by our finance team');
    await flow.getByTestId('withdraw-continue').click();
    await flow.getByTestId('withdraw-confirm').click();
    await expect(page.getByTestId('withdraw-receipt')).toContainText('Under review');
    await expect(page.getByTestId('header-balance')).toHaveText('8,495.00');
    await owner.goto('/admin/payments');
    const row = owner.getByTestId('withdrawal-queue').getByRole('row', { name: new RegExp(player.username) });
    await row.getByRole('button', { name: 'Reject' }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByLabel(/Reason/).fill('Please contact support about this amount (e2e)');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toHaveCount(0);
    await page.goto('/wallet/withdrawals');
    await expect(page.getByTestId('withdrawals-table')).toContainText('Rejected — returned');
    await expect(page.getByTestId('header-balance')).toHaveText('9,995.00');
    // The player was told at each step.
    await page.goto('/notifications');
    await expect(page.getByTestId('notification-list')).toContainText('Identity verified');
    await expect(page.getByTestId('notification-list')).toContainText('Withdrawal rejected');
  });

  test('E: a support request with an attachment, a staff reply, and a notification', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const player = await registerPlayer(page);
    await page.goto('/support');
    const form = page.getByTestId('new-ticket');
    await form.getByLabel('Topic').selectOption('PAYMENTS');
    await form.getByLabel('Subject').fill('Question about deposits');
    await form.getByLabel('Message').fill('Which test methods support withdrawals?');
    await form.locator('input[type=file]').setInputFiles({ name: 'screen.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await form.getByTestId('ticket-submit').click();
    await page.waitForURL('**/support/**');
    await expect(page.getByTestId('ticket-thread')).toContainText('screen.jpg');

    const owner = await ownerPage(browser);
    await owner.goto('/admin/support');
    await owner.getByTestId('support-queue').getByRole('row', { name: new RegExp(player.username) }).getByRole('link').first().click();
    await owner.getByTestId('reply-form').getByLabel('Reply').fill('All three test methods support withdrawals once you have deposited with them.');
    await owner.getByTestId('reply-form').getByRole('button', { name: 'Send reply' }).click();
    await expect(owner.getByText('All three test methods support withdrawals').first()).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('ticket-thread')).toContainText('Aurovane support');
    await expect(page.getByTestId('notification-count')).toHaveText(/\d+/);
    await page.goto('/notifications');
    await expect(page.getByTestId('notification-list')).toContainText('Support replied');
  });
});
