import { expect, test, type Page, type Request } from '@playwright/test';
import { pocketAtAngle } from '../../src/components/games/wheel-motion';
import { registerPlayer, waitForFreshRouletteWindow } from './helpers';

/**
 * The automatic roulette table runs in real time against the production
 * build, on the server's shared schedule: a 15-second betting window, a spin
 * and a result, every 28 seconds, whether or not anyone bets.
 */
const ROUNDS = '/api/games/roulette/rounds';
const CYCLE_TIMEOUT = 45_000;

/** Counts POSTs that would create a roulette round. */
function countWagers(page: Page) {
  const posts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === ROUNDS) posts.push(r);
  });
  return posts;
}

const status = (page: Page) => page.getByTestId('roulette-status');
const wheelRotation = (page: Page) => page.getByTestId('roulette-wheel').locator('g').first().getAttribute('transform');
const pick = (page: Page, chips: number) => page.locator(`[data-chip="${chips * 100}"]`).click();
const total = (page: Page) => page.getByTestId('roulette-total');
const tableSpinResponse = (page: Page, slot?: number) =>
  page.waitForResponse((r) => /\/api\/roulette\/table\/spins\/\d+$/.test(new URL(r.url()).pathname) && r.status() === 200 && (slot === undefined || r.url().endsWith(`/${slot}`)), { timeout: CYCLE_TIMEOUT });

/** Waits for the automatic close to send the bets, then for the wheel to land. */
async function autoSpin(page: Page) {
  const response = await page.waitForResponse((r) => new URL(r.url()).pathname === ROUNDS && r.request().method() === 'POST' && r.status() === 201, { timeout: CYCLE_TIMEOUT });
  const body = await response.json();
  await expect(page.getByTestId('roulette-wheel')).toHaveAttribute('data-state', 'landed', { timeout: 15_000 });
  return body as { round: { id: string; stake: number; payout: number; state: { result: number; bets: { type: string; amount: number }[] } }; balance: number };
}

const coveredPositions = (page: Page) => page.locator('[data-covered="true"]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.position!.split(':')[1])).sort((a, b) => a - b));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const fmt = (minor: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(minor / 100);

test.describe('automatic roulette table', () => {
  test('the wheel spins after every window: a table spin without bets (no wager, no balance change), a player round with bets, then Rebet and history', async ({ page }) => {
    test.setTimeout(300_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await expect(page.getByTestId('roulette-spin')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^spin$/i })).toHaveCount(0);

    // Idle wheel turns; nothing is sent.
    const wheel = page.getByTestId('roulette-wheel');
    const a = await wheelRotation(page);
    await page.waitForTimeout(700);
    expect(await wheelRotation(page)).not.toBe(a);

    // ── A window with NO bets still ends in a spin: the table's server-drawn spin.
    const slot = await waitForFreshRouletteWindow(page);
    const roundsBefore = (await (await page.request.get('/api/rounds?game=roulette')).json()).items.length;
    const spinRes = await tableSpinResponse(page, slot);
    const tableSpin = (await spinRes.json()).spin as { slot: number; result: number; color: string };
    expect(tableSpin.slot).toBe(slot);
    await expect(status(page)).toHaveAttribute('data-spin', 'table');
    await expect(wheel).toHaveAttribute('data-landed', String(tableSpin.result), { timeout: 15_000 });
    expect(pocketAtAngle(Number(await wheel.getAttribute('data-rotation')))).toBe(tableSpin.result);
    await expect(page.getByTestId('roulette-result')).toHaveAttribute('data-kind', 'table');
    await expect(page.getByTestId('roulette-result')).toHaveAttribute('data-result', String(tableSpin.result));
    await expect(page.getByTestId('roulette-table-strip').locator('li').first()).toHaveAttribute('data-result', String(tableSpin.result));
    // No wager, no player round, no balance change.
    expect(wagers).toHaveLength(0);
    await expect(page.getByTestId('header-balance')).toHaveText('10,000.00');
    expect((await (await page.request.get('/api/rounds?game=roulette')).json()).items).toHaveLength(roundsBefore);
    const wallet = await (await page.request.get('/api/wallet/transactions')).json().catch(() => null);
    if (wallet?.items) expect(wallet.items.filter((t: { type: string }) => /WAGER|PAYOUT/.test(t.type))).toHaveLength(0);

    // ── The next window opens by itself; this time with bets → exactly one player round.
    await waitForFreshRouletteWindow(page);
    await expect(page.getByTestId('roulette-balance')).toHaveText('10,000.00 chips');
    await pick(page, 25);
    await page.locator('[data-position="red"]').click();
    await page.locator('[data-position="red"]').click();
    await pick(page, 5);
    await page.locator('[data-position="red"]').click();
    await pick(page, 1);
    await page.locator('[data-position="straight:17"]').click();
    await expect(total(page)).toHaveText('56.00 chips');
    await page.getByTestId('roulette-undo').click();
    await expect(total(page)).toHaveText('55.00 chips');
    const first = await autoSpin(page);
    expect(wagers).toHaveLength(1);
    expect(JSON.parse(wagers[0]!.postData()!).bet.bets).toEqual([{ type: 'red', amount: 5500 }]);
    const n = first.round.state.result;
    await expect(wheel).toHaveAttribute('data-landed', String(n));
    expect(pocketAtAngle(Number(await wheel.getAttribute('data-rotation')))).toBe(n);
    // Locked while the result is shown (force: an aria-disabled position would otherwise be waited for).
    await expect(status(page)).toHaveAttribute('data-phase', 'RESULT_REVEAL');
    await page.locator('[data-position="black"]').click({ force: true });
    await expect(page.locator('[data-position="black"]')).toHaveAttribute('data-amount', '0');
    await expect(page.getByTestId('roulette-result')).toHaveAttribute('data-kind', 'wager');
    await expect(page.getByTestId('roulette-settlement')).toContainText(fmt(5500));
    await expect(total(page)).toHaveText('0.00 chips');
    await expect(page.locator('[data-chip-stack]')).toHaveCount(0);
    await expect(page.getByTestId('header-balance')).toHaveText(fmt(first.balance));
    await expect(page.getByTestId('roulette-history-strip').locator('button').first()).toHaveAttribute('data-result', String(n));

    // ── Rebet, 2×, Clear + Undo, remove tool and Delete; a second round is sent once.
    await waitForFreshRouletteWindow(page);
    await page.getByTestId('roulette-rebet').click();
    await expect(total(page)).toHaveText('55.00 chips');
    await expect(page.locator('[data-position="red"] [data-chip-stack]')).toHaveAttribute('data-chip-stack', '2500,2500,500');
    await page.getByTestId('roulette-double').click();
    await expect(total(page)).toHaveText('110.00 chips');
    await page.getByTestId('roulette-clear').click();
    await expect(total(page)).toHaveText('0.00 chips');
    await page.getByTestId('roulette-undo').click();
    await expect(total(page)).toHaveText('110.00 chips');
    await page.getByTestId('roulette-remove-mode').click();
    await page.locator('[data-position="red"]').click();
    await expect(total(page)).toHaveText('105.00 chips');
    await page.getByTestId('roulette-remove-mode').click();
    await page.locator('[data-position="red"]').focus();
    await page.keyboard.press('Delete');
    await expect(total(page)).toHaveText('80.00 chips');
    const second = await autoSpin(page);
    expect(wagers).toHaveLength(2);
    expect(second.round.state.bets).toEqual([{ type: 'red', amount: 8000 }]);

    // ── History survives a refresh; re-entering joins the table where it is.
    const strip = page.getByTestId('roulette-history-strip');
    await expect(strip.locator('button')).toHaveCount(2);
    await page.reload();
    await expect(strip.locator('button')).toHaveCount(2);
    await expect(strip.locator('button').nth(0)).toHaveAttribute('data-result', String(second.round.state.result));
    await expect(status(page)).toHaveAttribute('data-phase', /BETTING_OPEN|BETTING_CLOSED|SPINNING|RESULT_REVEAL/);
    const table = await (await page.request.get('/api/roulette/table')).json();
    expect(Math.abs(Number(await status(page).getAttribute('data-slot')) - table.current.slot)).toBeLessThanOrEqual(1);
    await strip.locator('button').nth(1).click();
    const drawer = page.getByTestId('roulette-history-drawer');
    await expect(drawer.getByRole('link', { name: 'Verify this round →' })).toHaveAttribute('href', `/history/${first.round.id}`);
    await page.keyboard.press('Escape');
    expect(wagers).toHaveLength(2);
  });

  test('a failed request keeps every bet in recovery; no new window opens until the safe retry settles it once', async ({ page }) => {
    test.setTimeout(180_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await waitForFreshRouletteWindow(page);
    await pick(page, 100);
    await page.locator('[data-position="black"]').click();
    await pick(page, 5);
    await page.locator('[data-position="straight:0"]').click();
    await expect(total(page)).toHaveText('105.00 chips');

    await page.route(`**${ROUNDS}`, (route) => route.abort('connectionreset'));
    await expect(status(page)).toHaveAttribute('data-phase', 'RECOVERY', { timeout: CYCLE_TIMEOUT + 15_000 });
    await expect(page.getByText('A request may not have completed')).toBeVisible();
    await expect(total(page)).toHaveText('105.00 chips');
    await expect(page.getByTestId('roulette-board')).toHaveAttribute('data-locked', 'true');
    const sent = wagers.length;
    await page.waitForTimeout(4000);
    await expect(status(page)).toHaveAttribute('data-phase', 'RECOVERY');
    expect(wagers).toHaveLength(sent);
    expect(new Set(wagers.map((w) => w.headers()['idempotency-key'])).size).toBe(1);

    await page.unroute(`**${ROUNDS}`);
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === ROUNDS && r.status() === 201);
    await page.getByRole('button', { name: 'Retry safely' }).click();
    const settled = await (await response).json();
    expect(settled.round.state.bets).toEqual([
      { type: 'black', amount: 10000 },
      { type: 'straight', number: 0, amount: 500 },
    ]);
    await expect(page.getByTestId('roulette-wheel')).toHaveAttribute('data-landed', String(settled.round.state.result), { timeout: 15_000 });
    await expect(total(page)).toHaveText('0.00 chips');
    expect(new Set(wagers.map((w) => w.headers()['idempotency-key'])).size).toBe(1);
    expect((await (await page.request.get('/api/rounds?game=roulette')).json()).items).toHaveLength(1);
    await waitForFreshRouletteWindow(page);
    await page.getByTestId('roulette-rebet').click();
    await expect(total(page)).toHaveText('105.00 chips');
  });

  test('a hidden tab never sends bets; leaving the page stops the table without sending anything', async ({ page }) => {
    test.setTimeout(180_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await waitForFreshRouletteWindow(page);
    await page.locator('[data-position="odd"]').click();
    await expect(total(page)).toHaveText('5.00 chips');

    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    // The window closes while hidden: the table moves on, but no wager is sent and the bets stay.
    await expect(status(page)).not.toHaveAttribute('data-phase', 'BETTING_OPEN', { timeout: CYCLE_TIMEOUT });
    await page.waitForTimeout(2000);
    expect(wagers).toHaveLength(0);
    await setHidden(false);
    await expect(total(page)).toHaveText('5.00 chips');

    // Leave before the next window closes: nothing is sent later.
    await waitForFreshRouletteWindow(page);
    await page.goto('/lobby');
    await page.waitForTimeout(20_000);
    expect(wagers).toHaveLength(0);
    expect((await (await page.request.get('/api/rounds?game=roulette')).json()).items).toHaveLength(0);
  });

  test('reduced motion: no idle motion; spins show their result at once', async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await registerPlayer(page);
    await page.goto('/games/roulette');
    const wheel = page.getByTestId('roulette-wheel');
    await expect(wheel).not.toHaveAttribute('data-state', 'idle');
    await waitForFreshRouletteWindow(page);
    const a = await wheelRotation(page);
    await page.waitForTimeout(600);
    expect(await wheelRotation(page)).toBe(a);
    await page.locator('[data-position="odd"]').click();
    const { round } = await autoSpin(page);
    await expect(wheel).toHaveAttribute('data-landed', String(round.state.result));
    await expect(total(page)).toHaveText('0.00 chips');
  });
});

test.describe('betting table coverage preview', () => {
  test('hover and keyboard focus highlight exactly the numbers each bet covers; active bets stay visible', async ({ page }) => {
    await page.goto('/games/roulette');
    await waitForFreshRouletteWindow(page);
    const hover = async (key: string) => {
      await page.locator(`[data-position="${key}"]`).hover();
      return coveredPositions(page);
    };
    expect(await hover('column:3')).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
    // Numbers outside the preview are marked (and shaded) as not covered.
    await expect(page.locator('[data-covered="false"]')).toHaveCount(37 - 12);
    await expect(page.locator('[data-position="column:3"]')).toHaveAttribute('data-previewed', 'true');
    expect(await hover('column:2')).toEqual([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]);
    expect(await hover('column:1')).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
    expect(await hover('dozen:1')).toEqual(range(1, 12));
    expect(await hover('dozen:2')).toEqual(range(13, 24));
    expect(await hover('dozen:3')).toEqual(range(25, 36));
    expect(await hover('red')).toEqual(RED);
    expect(await hover('black')).toEqual(range(1, 36).filter((x) => !RED.includes(x)));
    expect(await hover('odd')).toEqual(range(1, 36).filter((x) => x % 2 === 1));
    expect(await hover('even')).toEqual(range(1, 36).filter((x) => x % 2 === 0));
    expect(await hover('low')).toEqual(range(1, 18));
    expect(await hover('high')).toEqual(range(19, 36));
    expect(await hover('straight:17')).toEqual([17]);
    expect(await hover('straight:0')).toEqual([0]);

    // Leaving the table removes the preview.
    await page.mouse.move(5, 5);
    await expect(page.locator('[data-covered]')).toHaveCount(0);

    // Keyboard focus gives the same preview.
    await page.locator('[data-position="dozen:2"]').focus();
    expect(await coveredPositions(page)).toEqual(range(13, 24));
    await page.locator('[data-chip="500"]').focus();
    await expect(page.locator('[data-covered]')).toHaveCount(0);

    // Active bets keep their chips and coverage marks while another position is previewed.
    await page.locator('[data-position="red"]').click();
    await page.locator('[data-position="dozen:1"]').click();
    await expect(page.locator('[data-position="straight:3"]')).toHaveAttribute('data-coverage', '2');
    await expect(page.locator('[data-position="straight:2"]')).toHaveAttribute('data-coverage', '1');
    await page.locator('[data-position="column:2"]').hover();
    await expect(page.locator('[data-position="red"] [data-chip-stack]')).toBeVisible();
    await expect(page.locator('[data-position="straight:3"]')).toHaveAttribute('data-coverage', '2');
    await expect(page.locator('[data-position="straight:3"]')).toHaveAttribute('data-covered', 'false');
    await expect(page.locator('[data-position="column:2"]')).toHaveAttribute('data-previewed', 'true');
    await expect(page.locator('[data-position="red"]')).not.toHaveAttribute('data-previewed', 'true');
  });

  test('2× respects the balance', async ({ page }) => {
    await registerPlayer(page);
    await page.goto('/games/roulette');
    await waitForFreshRouletteWindow(page);
    await pick(page, 1000);
    for (let i = 0; i < 5; i++) await page.locator('[data-position="high"]').click();
    await expect(total(page)).toHaveText('5,000.00 chips');
    await expect(page.getByTestId('roulette-double')).not.toHaveAttribute('aria-disabled', 'true'); // 10,000 = the whole balance
    await page.locator('[data-position="high"]').click();
    await expect(page.getByTestId('roulette-double')).toHaveAttribute('aria-disabled', 'true'); // 12,000 > balance
    await page.getByTestId('roulette-double').click({ force: true });
    await expect(total(page)).toHaveText('6,000.00 chips');
    await page.getByTestId('roulette-clear').click();
    await expect(total(page)).toHaveText('0.00 chips');
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });

  test('a first tap previews coverage without betting; a second tap places a chip; the remove tool takes it off', async ({ page }) => {
    await page.goto('/games/roulette');
    await waitForFreshRouletteWindow(page);
    const column = page.locator('[data-position="column:3"]');
    await column.tap();
    expect(await coveredPositions(page)).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
    await expect(total(page)).toHaveText('0.00 chips');
    await column.tap();
    await expect(total(page)).toHaveText('5.00 chips');
    await column.tap();
    await expect(total(page)).toHaveText('10.00 chips');
    await page.getByTestId('roulette-remove-mode').tap();
    await column.tap();
    await expect(total(page)).toHaveText('5.00 chips');
  });
});

test.describe('game audio', () => {
  test('no audio before interaction; sound settings persist; missing files never break the table', async ({ page }) => {
    test.setTimeout(120_000);
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
    await waitForFreshRouletteWindow(page);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(0);

    // The first interaction creates the context; the automatic round works without any sound file.
    await page.locator('[data-position="red"]').click();
    expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);
    const { round } = await autoSpin(page);
    await expect(page.getByTestId('roulette-result')).toHaveAttribute('data-result', String(round.state.result));

    // Mute, set the channel levels, reload: remembered in this browser.
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName('Turn sound on');
    await page.getByTestId('sound-settings').click();
    await expect(page.getByRole('group', { name: 'Sound settings' })).toBeVisible();
    await page.getByTestId('sound-effects-volume').fill('40');
    await page.getByTestId('sound-ambience').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Sound settings' })).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('sound-settings').click();
    await expect(page.getByTestId('sound-ambience')).not.toBeChecked();
    await expect(page.getByTestId('sound-effects')).toBeChecked();
    await expect(page.getByTestId('sound-effects-volume')).toHaveValue('40');
    const stored = await page.evaluate(() => localStorage.getItem('aurovane:audio:v1'));
    expect(JSON.parse(stored!)).toMatchObject({ enabled: false, ambience: false, effects: true, effectsVolume: 0.4 });

    // Another game loads with the same settings and stays playable without assets.
    await page.goto('/games/dice');
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    const dice = page.waitForResponse((r) => r.url().endsWith('/api/games/dice/rounds') && r.request().method() === 'POST');
    await page.getByTestId('dice-roll-button').click();
    const d = await (await dice).json();
    await expect(page.getByTestId('dice-roll')).toHaveText((d.round.state.roll / 100).toFixed(2));
  });

  test('sound files are served for each game', async ({ request }) => {
    for (const f of ['roulette/chip-place.wav', 'roulette/countdown.wav', 'crash/rise.wav', 'hilo/cashout.wav', 'plinko/peg.wav']) {
      const r = await request.get(`/audio/${f}`);
      expect(r.status(), f).toBe(200);
      expect((await r.body()).subarray(0, 4).toString('ascii')).toBe('RIFF');
    }
  });
});
