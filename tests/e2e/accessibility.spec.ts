import { expect, test, type Page } from '@playwright/test';
import { registerPlayer } from './helpers';

/** Interactive elements without an accessible name, and form controls without a label. */
async function unnamed(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const name = (el: Element) =>
      (el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ||
        (el as HTMLElement).innerText ||
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : '') ||
        el.getAttribute('title') ||
        '').trim();
    const problems: string[] = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="gridcell"]')) {
      if (visible(el) && !name(el)) problems.push(`${el.tagName.toLowerCase()} ${(el as HTMLElement).outerHTML.slice(0, 80)}`);
    }
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const input = el as HTMLInputElement;
      if (!visible(el) || input.type === 'hidden') continue;
      const labelled = (input.id && document.querySelector(`label[for="${input.id}"]`)) || input.closest('label') || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      if (!labelled) problems.push(`unlabelled ${el.tagName.toLowerCase()} ${input.name || input.id}`);
    }
    return problems;
  });
}

test('interactive elements have accessible names and form controls have labels', async ({ page }) => {
  for (const path of ['/', '/login', '/register', '/forgot-password', '/rules', '/sports', '/sports/how-it-works']) {
    await page.goto(path);
    expect(await unnamed(page), path).toEqual([]);
  }
  await registerPlayer(page);
  for (const path of ['/lobby', '/games/dice', '/games/roulette', '/games/mines', '/games/crash', '/games/blackjack', '/games/limbo', '/games/keno', '/games/plinko', '/games/hilo', '/wallet', '/responsible-play', '/settings', '/fairness', '/profile', '/sports', '/sports/tickets']) {
    await page.goto(path);
    expect(await unnamed(page), path).toEqual([]);
  }
});

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, style: s.outlineStyle };
  });
  expect(outline).not.toBeNull();
  expect(outline!.style).not.toBe('none');
  expect(parseFloat(outline!.width)).toBeGreaterThanOrEqual(2);
});

test('reduced-motion preference shortens animations', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/lobby');
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('*')].map((e) => parseFloat(getComputedStyle(e).animationDuration) || 0).filter((d) => d > 0.01),
  );
  expect(durations).toEqual([]);
  await ctx.close();
});
