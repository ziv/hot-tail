import { expect, test } from '@playwright/test';
import './hook';

/**
 * K3 PWA: after a visit, the game boots offline — even if the last page the
 * player opened was the landing page (it must not replace the cached game shell).
 */
test('boots offline after visiting other pages', async ({ page, context }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
  // Second load goes through the worker, which caches the hashed assets.
  await page.reload();
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 30_000 });
  await page.goto('/about.html');
  await page.goto('/privacy.html');

  await context.setOffline(true);
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 30_000 });
  await page.goto('/about.html');
  await expect(page.locator('h1').first()).toBeVisible();
});
