import { expect, test, type Page, type Request } from '@playwright/test';
import { pocketAtAngle } from '../../src/components/games/wheel-motion';
import { registerPlayer } from './helpers';

const ROUNDS = '/api/games/roulette/rounds';

/** Counts POSTs that would create a roulette round. */
function countWagers(page: Page) {
  const posts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === ROUNDS) posts.push(r);
  });
  return posts;
}

async function wheelRotation(page: Page): Promise<string | null> {
  return page.getByTestId('roulette-wheel').locator('g').first().getAttribute('transform');
}

async function pick(page: Page, chips: number) {
  await page.locator(`[data-chip="${chips * 100}"]`).click();
}

async function spinAndSettle(page: Page) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === ROUNDS && r.request().method() === 'POST' && r.status() === 201);
  await page.getByTestId('roulette-spin').click();
  const body = await (await response).json();
  await expect(page.getByTestId('roulette-wheel')).toHaveAttribute('data-state', 'landed', { timeout: 15_000 });
  return body as { round: { id: string; stake: number; payout: number; state: { result: number; bets: { type: string; amount: number }[] } }; balance: number };
}

test.describe('roulette table experience', () => {
  test('idle wheel, chips, one wager per spin, landing on the server result, auto-clear, Rebet, Undo, Clear, history', async ({ page }) => {
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');

    // Idle: the wheel turns on its own and nothing is sent.
    const wheel = page.getByTestId('roulette-wheel');
    await expect(wheel).toHaveAttribute('data-state', 'idle');
    const a = await wheelRotation(page);
    await page.waitForTimeout(800);
    const b = await wheelRotation(page);
    expect(a).not.toBe(b);
    await page.waitForTimeout(500);
    expect(wagers).toHaveLength(0);
    await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');

    // Chips of different denominations stack on one position; the total is their sum.
    await pick(page, 25);
    await expect(page.locator('[data-chip="2500"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-position="red"]').click();
    await page.locator('[data-position="red"]').click();
    await pick(page, 5);
    await page.locator('[data-position="red"]').click();
    await pick(page, 1);
    await page.locator('[data-position="straight:17"]').click();
    await expect(page.locator('[data-position="red"]')).toHaveAttribute('data-amount', '5500');
    await expect(page.locator('[data-position="red"] [data-chip-stack]')).toHaveAttribute('data-chip-stack', '2500,2500,500');
    await expect(page.getByTestId('roulette-total')).toHaveText('56.00 chips');

    // Undo takes back the last placement only.
    await page.getByTestId('roulette-undo').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('55.00 chips');
    await expect(page.locator('[data-position="straight:17"]')).toHaveAttribute('data-amount', '0');

    // Exactly one wager, with the aggregate amount computed from the chips.
    const spinBtn = page.getByTestId('roulette-spin');
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === ROUNDS && r.request().method() === 'POST');
    await spinBtn.dblclick();
    const first = await (await response).json();
    expect(JSON.parse(wagers[0]!.postData()!).bet.bets).toEqual([{ type: 'red', amount: 5500 }]);
    await expect(wheel).toHaveAttribute('data-state', 'spinning');
    // Board is locked while the wheel turns, and nothing is cleared yet.
    await expect(page.getByTestId('roulette-total')).toHaveText('55.00 chips');
    await expect(wheel).toHaveAttribute('data-state', 'landed', { timeout: 15_000 });
    expect(wagers).toHaveLength(1);

    // The wheel stopped on the server's number — by its own geometry.
    const n = first.round.state.result as number;
    await expect(wheel).toHaveAttribute('data-landed', String(n));
    expect(pocketAtAngle(Number(await wheel.getAttribute('data-rotation')))).toBe(n);
    await expect(page.getByTestId('roulette-result')).toContainText(String(n));

    // After settlement and the animation: bets cleared, balance applied, new bets allowed.
    await expect(page.getByTestId('roulette-total')).toHaveText('0.00 chips');
    await expect(page.locator('[data-chip-stack]')).toHaveCount(0);
    const balance = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(first.balance / 100);
    await expect(page.getByTestId('header-balance')).toHaveText(balance);
    await expect(page.getByTestId('roulette-undo')).toHaveAttribute('aria-disabled', 'true');

    // History strip: the newest entry is this round, from the server.
    const strip = page.getByTestId('roulette-history-strip');
    await expect(strip.locator('button').first()).toHaveAttribute('data-result', String(n));
    await expect(strip.locator('button')).toHaveCount(1);

    // Rebet restores the previous combination, chips and all.
    await page.getByTestId('roulette-rebet').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('55.00 chips');
    await expect(page.locator('[data-position="red"] [data-chip-stack]')).toHaveAttribute('data-chip-stack', '2500,2500,500');

    // 2× doubles; Clear removes everything; Undo brings it back.
    await page.getByTestId('roulette-double').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('110.00 chips');
    await page.getByTestId('roulette-clear').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('0.00 chips');
    await page.getByTestId('roulette-undo').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('110.00 chips');

    // Remove mode (touch-friendly) takes the top chip off a tapped position.
    await page.getByTestId('roulette-remove-mode').click();
    await expect(page.getByTestId('roulette-remove-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-position="red"]').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('105.00 chips');
    await page.getByTestId('roulette-remove-mode').click();
    // Keyboard: Delete on a focused position removes its top chip.
    await page.locator('[data-position="red"]').focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('roulette-total')).toHaveText('80.00 chips');

    // A second spin: history grows newest first, with real server results.
    const second = await spinAndSettle(page);
    expect(wagers).toHaveLength(2);
    expect(second.round.state.bets).toEqual([{ type: 'red', amount: 8000 }]);
    await expect(strip.locator('button')).toHaveCount(2);
    await expect(strip.locator('button').nth(0)).toHaveAttribute('data-result', String(second.round.state.result));
    await expect(strip.locator('button').nth(1)).toHaveAttribute('data-result', String(n));
    const api = await (await page.request.get('/api/rounds?game=roulette&limit=20')).json();
    expect(api.items.map((i: { summary: { result: number } }) => i.summary.result)).toEqual([second.round.state.result, n]);

    // Details: a strip entry opens the drawer at that round with a verification link.
    await strip.locator('button').nth(1).click();
    const drawer = page.getByTestId('roulette-history-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Verify this round →' })).toHaveAttribute('href', `/history/${first.round.id}`);
    await expect(drawer.getByTestId('roulette-stats')).toContainText('Historical only');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(wagers).toHaveLength(2);
  });

  test('a failed spin keeps every bet; the safe retry settles it once, then clears', async ({ page }) => {
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await pick(page, 100);
    await page.locator('[data-position="black"]').click();
    await pick(page, 5);
    await page.locator('[data-position="straight:0"]').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('105.00 chips');

    // Network failure on every attempt (the client retries internally).
    await page.route(`**${ROUNDS}`, (route) => route.abort('connectionreset'));
    await page.getByTestId('roulette-spin').click();
    await expect(page.getByText('A request may not have completed')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('roulette-total')).toHaveText('105.00 chips');
    await expect(page.locator('[data-position="black"]')).toHaveAttribute('data-amount', '10000');
    await expect(page.getByTestId('roulette-wheel')).toHaveAttribute('data-state', 'idle');
    // No new spin can be started while the first is unresolved.
    await expect(page.getByTestId('roulette-spin')).toBeDisabled();
    const keys = new Set(wagers.map((w) => w.headers()['idempotency-key']));
    expect(keys.size).toBe(1);

    await page.unroute(`**${ROUNDS}`);
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === ROUNDS && r.status() === 201);
    await page.getByRole('button', { name: 'Retry safely' }).click();
    const settled = await (await response).json();
    expect(settled.round.state.bets).toEqual([
      { type: 'black', amount: 10000 },
      { type: 'straight', number: 0, amount: 500 },
    ]);
    await expect(page.getByTestId('roulette-wheel')).toHaveAttribute('data-landed', String(settled.round.state.result), { timeout: 15_000 });
    await expect(page.getByTestId('roulette-total')).toHaveText('0.00 chips');
    // Same idempotency key throughout: one wager on the server.
    expect(new Set(wagers.map((w) => w.headers()['idempotency-key'])).size).toBe(1);
    const api = await (await page.request.get('/api/rounds?game=roulette')).json();
    expect(api.items).toHaveLength(1);
    await page.getByTestId('roulette-rebet').click();
    await expect(page.getByTestId('roulette-total')).toHaveText('105.00 chips');
  });

  test('reduced motion: no idle motion; the result is shown at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await registerPlayer(page);
    await page.goto('/games/roulette');
    const wheel = page.getByTestId('roulette-wheel');
    await expect(wheel).not.toHaveAttribute('data-state', 'idle');
    const a = await wheelRotation(page);
    await page.waitForTimeout(600);
    expect(await wheelRotation(page)).toBe(a);
    await page.locator('[data-position="odd"]').click();
    const { round } = await spinAndSettle(page);
    await expect(wheel).toHaveAttribute('data-landed', String(round.state.result));
    await expect(page.getByTestId('roulette-total')).toHaveText('0.00 chips');
  });
});

test.describe('game audio', () => {
  test('no audio before interaction; the sound switch persists; missing files never break a game', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { AudioContext: new () => unknown; __audioContexts: number };
      w.__audioContexts = 0;
      const Real = w.AudioContext;
      w.AudioContext = class extends (Real as unknown as { new (): object }) {
        constructor() {
          super();
          w.__audioContexts += 1;
        }
      } as never;
    });
    await registerPlayer(page);
    // Every sound file fails to load.
    await page.route('**/audio/**', (route) => route.abort());
    await page.goto('/games/roulette');
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(0);

    // The first interaction creates the context; the game works without any sound file.
    await page.locator('[data-position="red"]').click();
    expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);
    const { round } = await spinAndSettle(page);
    await expect(page.getByTestId('roulette-result')).toContainText(String(round.state.result));

    // Mute, adjust, reload: the choice is remembered in this browser.
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName('Turn sound on');
    await page.getByTestId('sound-settings').click();
    await expect(page.getByRole('group', { name: 'Sound settings' })).toBeVisible();
    await page.getByTestId('sound-ambience').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Sound settings' })).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('sound-settings').click();
    await expect(page.getByTestId('sound-ambience')).not.toBeChecked();
    await expect(page.getByTestId('sound-effects')).toBeChecked();
    const stored = await page.evaluate(() => localStorage.getItem('aurovane:audio:v1'));
    expect(JSON.parse(stored!)).toMatchObject({ enabled: false, ambience: false, effects: true });

    // The other games load with sound controls and stay playable without assets.
    await page.goto('/games/dice');
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    const dice = page.waitForResponse((r) => r.url().endsWith('/api/games/dice/rounds') && r.request().method() === 'POST');
    await page.getByTestId('dice-roll-button').click();
    const d = await (await dice).json();
    await expect(page.getByTestId('dice-roll')).toHaveText((d.round.state.roll / 100).toFixed(2));
  });

  test('sound files are served for each game', async ({ request }) => {
    for (const f of ['roulette/chip-place.wav', 'crash/rise.wav', 'hilo/cashout.wav', 'plinko/peg.wav']) {
      const r = await request.get(`/audio/${f}`);
      expect(r.status(), f).toBe(200);
      expect((await r.body()).subarray(0, 4).toString('ascii')).toBe('RIFF');
    }
  });
});
