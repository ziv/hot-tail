import { expect, test } from '@playwright/test';
import './hook';

/**
 * A5 smoke test: boot, play ~10 s of stage 1 with the scripted autopilot and
 * assert the game progressed with no console errors.
 */
test('boots and plays 10 seconds without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/?autotest&quality=low&hooks');
  await page.waitForFunction(() => window.__hotTail?.state === 'playing', null, { timeout: 30_000 });
  // CI runners render a few fps in software; let the sim keep up with real time.
  await page.evaluate(() => window.__hotTail!.debug!.turbo());
  await page.waitForFunction(() => (window.__hotTail?.simTime ?? 0) >= 10, null, { timeout: 60_000 });

  const result = await page.evaluate(() => ({
    state: window.__hotTail!.state,
    score: window.__hotTail!.score,
    errors: window.__hotTail!.errors,
  }));
  expect(result.state).toBe('playing');
  expect(result.score).toBeGreaterThan(0);
  expect(result.errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('title → jet select → flight via keyboard; leaderboard and settings open', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'ARCADE' })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // HOW TO PLAY
  await expect(page.getByText('Keyboard + mouse')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp'); // LEADERBOARD
  await page.keyboard.press('Enter');
  await expect(page.getByText(/LOCAL SCORES|ONLINE|OFFLINE/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // SETTINGS
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'ACCESSIBILITY' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp'); // ARCADE
  await page.keyboard.press('Enter');
  await expect(page.getByText('SELECT YOUR JET', { exact: false })).toBeVisible();
  await page.keyboard.press('ArrowRight'); // change jet
  await expect(page.getByText('DART', { exact: false })).toBeVisible();
  await page.keyboard.press('Enter'); // TAKE OFF → carrier take-off cutscene
  await page.waitForFunction(() => window.__hotTail?.state === 'cutscene');
  await page.keyboard.press('Enter'); // skip
  await page.waitForFunction(() => window.__hotTail?.state === 'playing');
});
