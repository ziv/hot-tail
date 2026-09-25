import { expect, test } from '@playwright/test';

interface HotTailHook {
  state: string;
  simTime: number;
  score: number;
  errors: string[];
  app: { fps: number };
}

declare global {
  interface Window {
    __hotTail?: HotTailHook;
  }
}

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

  await page.goto('/?autotest&quality=low');
  await page.waitForFunction(() => window.__hotTail?.state === 'playing', null, { timeout: 30_000 });
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

test('title screen menu is navigable by keyboard', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'START' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // HOW TO PLAY
  await expect(page.getByText('Keyboard + mouse')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); // START
  await page.waitForFunction(() => window.__hotTail?.state === 'playing');
});
