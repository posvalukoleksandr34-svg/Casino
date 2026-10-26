import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerPlayer, toMinor } from './helpers';

test('blackjack: deal, play to the end, balances and history agree, round verifiable', async ({ page, baseURL }) => {
  await registerPlayer(page);
  await page.goto('/games/blackjack');
  await page.getByTestId('bj-deal').click();

  // Play by keyboard where possible: decline insurance, otherwise stand (S).
  // Each step waits until the server's answer is rendered: an action or the outcome.
  const stand = page.getByTestId('bj-stand');
  const noInsurance = page.getByTestId('bj-no-insurance');
  const outcome = page.getByTestId('bj-outcome');
  for (let i = 0; i < 12; i += 1) {
    await expect(stand.or(noInsurance).or(outcome).first()).toBeVisible();
    if (await outcome.isVisible()) break;
    const answered = page.waitForResponse((r) => r.url().includes('/actions') && r.request().method() === 'POST');
    if (await noInsurance.isVisible()) {
      await noInsurance.click();
    } else {
      await expect(stand).toBeEnabled();
      await page.keyboard.press('s');
    }
    expect((await answered).ok()).toBe(true);
  }
  await expect(page.getByTestId('bj-deal')).toBeVisible();
  await expect(page.getByTestId('bj-outcome')).toBeVisible();

  const history = await (await page.request.get('/api/rounds?game=blackjack')).json();
  expect(history.items).toHaveLength(1);
  const round = history.items[0];
  expect(round.status).toBe('SETTLED');
  const wallet = await (await page.request.get('/api/wallet')).json();
  expect(wallet.balance).toBe(1_000_000 - round.stake + round.payout);
  expect(toMinor(await page.getByTestId('header-balance').innerText())).toBe(wallet.balance);

  // Reveal the seed and verify the shoe in the browser verifier.
  const rotate = await page.request.post('/api/fairness/rotate', { data: {}, headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() } });
  expect(rotate.ok()).toBe(true);
  await page.goto(`/history/${round.id}`);
  await page.getByRole('link', { name: /verify/i }).first().click();
  await expect(page.getByTestId('verify-outcome')).toContainText('Shoe begins');
  const dealt = await (await page.request.get(`/api/rounds/${round.id}`)).json();
  const firstPlayerCard = dealt.round.state.hands[0].cards[0];
  expect(typeof firstPlayerCard).toBe('number');
});
