import { expect, test } from '@playwright/test';
import { codeFromMail, completeProfile, PROFILE, startRegistration } from './helpers';
import { PASSWORD } from './env';

const chips = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(minor / 100);

test.describe('registration, e-mail verification and onboarding', () => {
  test('register → e-mailed code → verify → profile → lobby → play → balance and history', async ({ page, baseURL }) => {
    const { email, startedAt } = await startRegistration(page);

    // Before verification there is no session: protected pages and APIs refuse.
    expect((await page.request.get('/api/wallet')).status()).toBe(401);
    await page.goto('/wallet');
    await page.waitForURL('**/login?next=%2Fwallet');
    await page.goto('/verify-email');

    // A wrong code is refused with the attempts left; the code never appears in the page.
    const code = await codeFromMail(email, startedAt);
    const wrong = code === '000000' ? '111111' : '000000';
    await page.getByLabel('Verification code').fill(wrong);
    await expect(page.getByRole('alert').filter({ hasText: 'not correct' })).toContainText('4 attempts left');
    expect(await page.content()).not.toContain(code);

    await page.getByLabel('Verification code').fill(code);
    await page.waitForURL('**/onboarding');

    // Verified but profile incomplete: every other page and API is closed.
    for (const path of ['/lobby', '/games/dice', '/wallet', '/sports', '/settings']) {
      await page.goto(path);
      await page.waitForURL('**/onboarding');
    }
    const wallet = await page.request.get('/api/wallet');
    expect(wallet.status()).toBe(403);
    expect((await wallet.json()).error.code).toBe('ONBOARDING_REQUIRED');
    const bet = await page.request.post('/api/games/dice/rounds', {
      data: { bet: { amount: 100, target: 5000, direction: 'under' } },
      headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(bet.status()).toBe(403);

    await completeProfile(page);
    await expect(page.getByRole('status').filter({ hasText: 'Welcome to Aurovane' })).toBeVisible();
    await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');

    // Play one dice round; balance, transactions and history agree.
    await page.goto('/games/dice');
    const diceResponse = page.waitForResponse((r) => r.url().endsWith('/api/games/dice/rounds') && r.request().method() === 'POST');
    await page.getByTestId('dice-roll-button').click();
    const dice = await (await diceResponse).json();
    expect(dice.round.status).toBe('SETTLED');
    const after = 1_000_000 - dice.round.stake + dice.round.payout;
    await expect(page.getByTestId('header-balance')).toHaveText(chips(after));
    await page.goto('/wallet/transactions');
    await expect(page.getByTestId('transactions-table')).toContainText('Bonus');
    await page.goto('/history');
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(1);

    // The profile shows the details; the phone number is not presented as verified.
    await page.goto('/profile');
    await expect(page.getByTestId('profile-legal-name')).toHaveText(`${PROFILE.firstName} ${PROFILE.lastName}`);
    await expect(page.getByText('+44 20 7946 0018')).toBeVisible();
    await expect(page.getByText('Unverified', { exact: true })).toBeVisible();
  });

  test('signing in before verifying continues on the verification page, with resend cooldown', async ({ page, context }) => {
    const { email, startedAt } = await startRegistration(page);
    await context.clearCookies();
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/verify-email');
    await expect(page.getByTestId('verify-email-address')).toHaveText(email);
    await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
    // The registration code is still live, so sign-in did not send another.
    await page.getByLabel('Verification code').fill(await codeFromMail(email, startedAt));
    await page.waitForURL('**/onboarding');
  });

  test('a mistyped address can be corrected before verification', async ({ page }) => {
    test.setTimeout(150_000);
    const { email } = await startRegistration(page);
    const corrected = email.replace('@', '.fixed@');
    await page.getByRole('button', { name: 'Wrong address? Change it' }).click();
    const button = page.getByRole('button', { name: /Use this address|Available in/ });
    await page.getByLabel('New e-mail address').fill(corrected);
    // The server's 60-second cooldown applies; wait it out if needed.
    await expect(button).toHaveText('Use this address', { timeout: 70_000 });
    const changedAt = Date.now() - 1000;
    await button.click();
    await expect(page.getByTestId('verify-email-address')).toHaveText(corrected);
    await page.getByLabel('Verification code').fill(await codeFromMail(corrected, changedAt));
    await page.waitForURL('**/onboarding');
  });

  test('the server refuses an under-age date of birth', async ({ page, baseURL }) => {
    const { email, startedAt } = await startRegistration(page);
    await page.getByLabel('Verification code').fill(await codeFromMail(email, startedAt));
    await page.waitForURL('**/onboarding');
    const year = new Date().getUTCFullYear() - 17;
    const res = await page.request.post('/api/onboarding', {
      data: { firstName: 'Kim', lastName: 'Lee', dateOfBirth: `${year}-01-01`, countryCode: 'GB', phoneRegion: 'GB', phoneNumber: '020 7946 0018' },
      headers: { Origin: baseURL! },
    });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('at least 18');
    await page.goto('/lobby');
    await page.waitForURL('**/onboarding');
  });
});
