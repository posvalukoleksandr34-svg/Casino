import { expect, test, type Page, type Request } from '@playwright/test';
import { pocketAtAngle } from '../../src/components/games/wheel-motion';
import { registerPlayer } from './helpers';

/**
 * The automatic roulette table runs in real time against the production
 * build: each betting window really lasts 15 seconds.
 */
const ROUNDS = '/api/games/roulette/rounds';
const WINDOW = 15_000;
const CYCLE_TIMEOUT = WINDOW + 10_000;

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

async function waitForWindow(page: Page, n: number) {
  await expect(status(page)).toHaveAttribute('data-window', String(n), { timeout: CYCLE_TIMEOUT });
  await expect(status(page)).toHaveAttribute('data-phase', 'BETTING_OPEN');
}

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
  test('full cycle: countdown, automatic close, one wager, server result, auto-clear, next window, no-bet window, Rebet, history', async ({ page }) => {
    test.setTimeout(240_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');

    // Betting is open at once with the 15-second countdown; there is no Spin button.
    await waitForWindow(page, 1);
    expect(Number(await page.getByTestId('roulette-countdown').getAttribute('data-seconds'))).toBeGreaterThanOrEqual(13);
    await expect(page.getByTestId('roulette-spin')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^spin$/i })).toHaveCount(0);
    await expect(page.getByTestId('roulette-balance')).toHaveText('10,000.00 chips');

    // The idle wheel turns, and nothing is sent.
    const wheel = page.getByTestId('roulette-wheel');
    await expect(wheel).toHaveAttribute('data-state', 'idle');
    const a = await wheelRotation(page);
    await page.waitForTimeout(700);
    expect(await wheelRotation(page)).not.toBe(a);
    expect(wagers).toHaveLength(0);

    // Chips of several denominations stack; Undo takes back one placement only.
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
    await expect(page.locator('[data-position="red"] [data-chip-stack]')).toHaveAttribute('data-chip-stack', '2500,2500,500');

    // At zero the bets go in by themselves: exactly one request, amount = sum of chips.
    const first = await autoSpin(page);
    expect(wagers).toHaveLength(1);
    expect(JSON.parse(wagers[0]!.postData()!).bet.bets).toEqual([{ type: 'red', amount: 5500 }]);
    const n = first.round.state.result;
    await expect(wheel).toHaveAttribute('data-landed', String(n));
    // Betting stays locked while the result is shown (checked first: the result phase lasts 5 s).
    await expect(status(page)).toHaveAttribute('data-phase', 'RESULT_REVEAL');
    await expect(page.getByTestId('roulette-board')).toHaveAttribute('data-locked', 'true');
    // force: a plain click() would wait until the (aria-disabled) position becomes enabled again.
    await page.locator('[data-position="black"]').click({ force: true });
    await expect(page.locator('[data-position="black"]')).toHaveAttribute('data-amount', '0');
    expect(pocketAtAngle(Number(await wheel.getAttribute('data-rotation')))).toBe(n);
    await expect(status(page)).toHaveAttribute('data-phase', 'RESULT_REVEAL');
    await expect(page.getByTestId('roulette-result')).toHaveAttribute('data-result', String(n));
    const settlement = page.getByTestId('roulette-settlement');
    await expect(settlement).toContainText(fmt(5500));
    await expect(settlement).toContainText(fmt(first.round.payout));
    // Cleared after settlement and the animation; balance applied.
    await expect(total(page)).toHaveText('0.00 chips');
    await expect(page.locator('[data-chip-stack]')).toHaveCount(0);
    await expect(page.getByTestId('header-balance')).toHaveText(fmt(first.balance));
    await expect(page.getByTestId('roulette-balance')).toHaveText(`${fmt(first.balance)} chips`);
    await expect(page.getByTestId('roulette-history-strip').locator('button').first()).toHaveAttribute('data-result', String(n));

    // The next window opens on its own, empty.
    await waitForWindow(page, 2);
    // A window without bets closes with no request and no deduction, then the next opens.
    await expect(status(page)).toHaveAttribute('data-phase', 'BETTING_CLOSED', { timeout: CYCLE_TIMEOUT });
    await waitForWindow(page, 3);
    expect(wagers).toHaveLength(1);
    await expect(page.getByTestId('header-balance')).toHaveText(fmt(first.balance));

    // Rebet restores the previous combination; 2×, Clear + Undo, remove tool and Delete still work.
    await page.getByTestId('roulette-rebet').click();
    await expect(total(page)).toHaveText('55.00 chips');
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
    const strip = page.getByTestId('roulette-history-strip');
    await expect(strip.locator('button')).toHaveCount(2);
    await expect(strip.locator('button').nth(0)).toHaveAttribute('data-result', String(second.round.state.result));
    await expect(strip.locator('button').nth(1)).toHaveAttribute('data-result', String(n));
    const api = await (await page.request.get('/api/rounds?game=roulette&limit=20')).json();
    expect(api.items.map((i: { id: string }) => i.id)).toEqual([second.round.id, first.round.id]);

    // History survives a refresh, newest first, with real values and a verification link.
    await page.reload();
    await expect(strip.locator('button')).toHaveCount(2);
    await expect(strip.locator('button').nth(0)).toHaveAttribute('data-result', String(second.round.state.result));
    await strip.locator('button').nth(1).click();
    const drawer = page.getByTestId('roulette-history-drawer');
    await expect(drawer.getByRole('link', { name: 'Verify this round →' })).toHaveAttribute('href', `/history/${first.round.id}`);
    const details = drawer.getByTestId('roulette-history-details');
    await expect(details).toContainText(fmt(5500));
    await expect(details).toContainText(fmt(first.round.payout));
    await expect(details).toContainText((first.round.payout - 5500 >= 0 ? '+' : '') + fmt(first.round.payout - 5500));
    await expect(drawer.getByTestId('roulette-stats')).toContainText('Historical only');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(wagers).toHaveLength(2);
  });

  test('a failed request keeps every bet in recovery; no new window opens until the safe retry settles it once', async ({ page }) => {
    test.setTimeout(150_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await waitForWindow(page, 1);
    await pick(page, 100);
    await page.locator('[data-position="black"]').click();
    await pick(page, 5);
    await page.locator('[data-position="straight:0"]').click();
    await expect(total(page)).toHaveText('105.00 chips');

    await page.route(`**${ROUNDS}`, (route) => route.abort('connectionreset'));
    await expect(status(page)).toHaveAttribute('data-phase', 'RECOVERY', { timeout: CYCLE_TIMEOUT + 15_000 });
    await expect(page.getByText('A request may not have completed')).toBeVisible();
    await expect(total(page)).toHaveText('105.00 chips');
    await expect(page.locator('[data-position="black"]')).toHaveAttribute('data-amount', '10000');
    await expect(page.getByTestId('roulette-board')).toHaveAttribute('data-locked', 'true');
    // Recovery holds: time passing does not open another window or send anything new.
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
    const api = await (await page.request.get('/api/rounds?game=roulette')).json();
    expect(api.items).toHaveLength(1);
    await waitForWindow(page, 2);
    await page.getByTestId('roulette-rebet').click();
    await expect(total(page)).toHaveText('105.00 chips');
  });

  test('a hidden tab pauses the countdown; leaving the page stops the table without sending anything', async ({ page }) => {
    test.setTimeout(120_000);
    await registerPlayer(page);
    const wagers = countWagers(page);
    await page.goto('/games/roulette');
    await waitForWindow(page, 1);
    await page.locator('[data-position="odd"]').click();
    await expect(total(page)).toHaveText('5.00 chips');

    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    const countdown = page.getByTestId('roulette-countdown');
    const paused = await countdown.getAttribute('data-seconds');
    await expect(status(page)).toContainText('Paused while this tab is hidden');
    await page.waitForTimeout(WINDOW + 1500);
    await expect(countdown).toHaveAttribute('data-seconds', paused!);
    await expect(status(page)).toHaveAttribute('data-phase', 'BETTING_OPEN');
    expect(wagers).toHaveLength(0);
    await setHidden(false);
    expect(Number(await countdown.getAttribute('data-seconds'))).toBeGreaterThanOrEqual(5);

    // Leave before the window closes: the table's timers are gone, nothing is sent later.
    await page.goto('/lobby');
    await page.waitForTimeout(WINDOW + 3000);
    expect(wagers).toHaveLength(0);
    const api = await (await page.request.get('/api/rounds?game=roulette')).json();
    expect(api.items).toHaveLength(0);
  });

  test('reduced motion: no idle motion; the automatic round shows its result at once', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await registerPlayer(page);
    await page.goto('/games/roulette');
    const wheel = page.getByTestId('roulette-wheel');
    await expect(wheel).not.toHaveAttribute('data-state', 'idle');
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
    await waitForWindow(page, 1);
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
    await waitForWindow(page, 1);
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
    await waitForWindow(page, 1);
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
    await waitForWindow(page, 1);
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
