import { expect, test } from '@playwright/test';
import { GOLDEN_PROBE } from './golden';

/**
 * J4 cross-engine determinism: the simulation run by the page must hash
 * identically to Node's. Run with `--project=firefox --project=webkit` too.
 */
test('sim is bit-identical to Node in this browser engine', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(
    () => typeof (window as unknown as { __hotTail?: { probe?: unknown } }).__hotTail?.probe === 'function',
  );
  const probe = await page.evaluate(() =>
    (window as unknown as { __hotTail: { probe: () => string } }).__hotTail.probe(),
  );
  expect(probe).toBe(GOLDEN_PROBE);
});
