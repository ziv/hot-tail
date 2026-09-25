import { expect, test } from '@playwright/test';
import './hook';

/**
 * Emulated device pass (Q5, pre-hardware): boots on phone viewports with touch,
 * starts a run by tapping, skips the take-off by tapping, and checks the touch
 * layout and HUD safe areas. Real-device passes still need physical phones.
 */
test('phone: tap through title → take-off → touch controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 45_000 });
  await page.getByRole('button', { name: 'ARCADE' }).tap();
  await page.getByRole('button', { name: 'TAKE OFF' }).tap();
  await page.waitForFunction(() => window.__hotTail?.state === 'cutscene');
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width / 2, vp.height / 3); // tap to skip the take-off
  await page.waitForFunction(() => window.__hotTail?.state === 'playing');
  await page.touchscreen.tap(60, vp.height * 0.6); // thumb on the stick zone
  await expect(page.locator('#touch')).toHaveClass(/visible/);
  // The overlay is aria-hidden (in-game controls), so query by class.
  for (const cls of [
    'touch-lock',
    'touch-roll',
    'touch-boost',
    'touch-brake',
    'touch-flare',
    'touch-fire',
    'touch-pause',
  ]) {
    const btn = page.locator(`.${cls}`);
    await expect(btn).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); // touch target size
  }
  // Taps are replayed as mouse events; they must not grab pointer lock (which
  // would route every touch to the canvas).
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  // Pause from the on-screen button.
  await page.locator('.touch-pause').tap();
  await page.waitForFunction(() => window.__hotTail?.state === 'paused');
  expect(errors).toEqual([]);
});
