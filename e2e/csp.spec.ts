import { expect, test } from '@playwright/test';
import { SECURITY_HEADERS } from '../scripts/security-headers.mjs';
import './hook';

/**
 * The production Content-Security-Policy (served by Vercel) must not break the
 * game: serve the build with the exact headers and play through boot, a stage
 * start, the retro sprite chunk and the status page without violations.
 */
test('game runs under the production security headers', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.route('**/*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...SECURITY_HEADERS } });
  });
  await page.goto('/?quality=low&debug');
  await page.waitForFunction(() => window.__hotTail?.state === 'title', null, { timeout: 60_000 });
  await page.keyboard.press('Backquote'); // lil-gui debug panel (injects styles)
  await page.evaluate(() =>
    (window.__hotTail!.app as unknown as { view: { setStyle(s: string): Promise<void> } }).view.setStyle(
      'retro',
    ),
  );
  await page.evaluate(() => window.__hotTail!.debug!.startGame('practice', 9));
  await page.waitForFunction(() => window.__hotTail?.state === 'playing');
  await page.goto('/status.html');
  await expect(page.getByText('Updated', { exact: false })).toBeVisible();
  expect(violations).toEqual([]);
});
