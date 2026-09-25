import { expect, test, type Page } from '@playwright/test';

/**
 * Release-candidate regression pass (Q9): drives every major flow of the real
 * build — using the debug hooks only to fast-forward stage timelines.
 */
import './hook';

const waitState = (page: Page, s: string, timeout = 60_000) =>
  page.waitForFunction((x) => window.__hotTail?.state === x, s, { timeout });

async function boot(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on(
    'console',
    (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()),
  );
  await page.goto('/?quality=low&debug');
  await waitState(page, 'title');
  await page.evaluate(() => window.__hotTail!.debug!.turbo());
}

/** Fast-forwards the current stage to its clear (debug hook). */
async function clearStage(page: Page) {
  await page.evaluate(() => window.__hotTail!.debug!.clearStage());
  await waitState(page, 'results', 90_000);
}

test('arcade: take-off → stage clear → results → next stage; pause/resume', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.keyboard.press('Enter'); // ARCADE
  await page.keyboard.press('Enter'); // TAKE OFF
  await waitState(page, 'cutscene');
  await page.keyboard.press('Enter');
  await waitState(page, 'playing');
  await page.keyboard.press('Escape');
  await waitState(page, 'paused');
  await expect(page.getByRole('button', { name: 'RESUME' })).toBeVisible();
  await page.keyboard.press('Escape');
  await waitState(page, 'playing');
  await clearStage(page);
  await expect(page.getByText('STAGE CLEAR')).toBeVisible();
  await page.getByRole('button', { name: 'NEXT STAGE' }).click();
  await waitState(page, 'playing');
  expect(await page.evaluate(() => window.__hotTail!.app.stageIndex)).toBe(1);
  expect(errors).toEqual([]);
});

test('refuel after stage 5, then stage 6; ending → credits', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  // Start at stage 5 in arcade via the debug hook, then clear it.
  await page.evaluate(() => window.__hotTail!.debug!.startGame('arcade', 4));
  await waitState(page, 'playing');
  await clearStage(page);
  await page.getByRole('button', { name: 'RENDEZVOUS WITH TANKER' }).click();
  await waitState(page, 'refuel');
  await waitState(page, 'playing', 30_000);
  const after = await page.evaluate(() => ({
    i: window.__hotTail!.app.stageIndex,
    m: window.__hotTail!.app.sim.player.missiles,
  }));
  expect(after).toEqual({ i: 5, m: 100 });
  // Final stage → landing cutscene → mission complete → credits.
  await page.evaluate(() => window.__hotTail!.debug!.startGame('arcade', 17));
  await waitState(page, 'playing');
  await page.evaluate(() => window.__hotTail!.debug!.clearStage()); // jumps to the boss
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__hotTail!.debug!.destroyBoss());
  await waitState(page, 'results', 90_000);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  await waitState(page, 'cutscene');
  await page.keyboard.press('Enter');
  await expect(page.getByText('NEW HIGH SCORE')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'CONFIRM' }).click();
  await expect(page.getByText('MISSION COMPLETE')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'CREDITS' }).click();
  await expect(page.getByText('Programming, procedural art', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('game over → name entry → local leaderboard → continue resets score', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => window.__hotTail!.debug!.startGame('arcade', 1));
  await waitState(page, 'playing');
  await page.evaluate(() => {
    const a = window.__hotTail!.app;
    a.sim.score.score = 777000;
    a.sim.score.lives = 1;
    window.__hotTail!.debug!.damagePlayer(99);
  });
  await waitState(page, 'gameover', 30_000);
  await expect(page.getByText('NEW HIGH SCORE')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type('TESTER');
  await page.getByRole('button', { name: 'CONFIRM' }).click();
  await page.getByRole('button', { name: 'LEADERBOARD' }).click();
  await expect(page.getByText('TESTER')).toBeVisible();
  await expect(page.locator('.board').getByText('777,000')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'CONTINUE (SCORE RESETS)' }).click();
  await waitState(page, 'playing');
  expect(await page.evaluate(() => window.__hotTail!.app.sim.score.score)).toBe(0);
  expect(errors).toEqual([]);
});

test('settings persist across reloads; retro style and rebinding work', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.getByRole('button', { name: 'SETTINGS' }).click();
  await page.getByRole('button', { name: 'GAMEPLAY' }).click();
  await page.getByRole('button', { name: /DIFFICULTY/ }).click(); // normal → hard
  await expect(page.getByRole('button', { name: /DIFFICULTY.*HARD/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'GRAPHICS' }).click();
  await page.getByRole('button', { name: /STYLE/ }).click();
  await page.waitForFunction(() => window.__hotTail!.app.view.style === 'retro');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'CONTROLS' }).click();
  await page.getByRole('button', { name: 'REBIND KEYS' }).click();
  await page.getByRole('button', { name: /FLARES/ }).click();
  await page.keyboard.press('KeyG');
  await expect(page.getByRole('button', { name: /FLARES.*G/ })).toBeVisible();
  await page.reload();
  await waitState(page, 'title');
  const s = await page.evaluate(() => window.__hotTail!.app.save.settings);
  expect(s.difficulty).toBe('hard');
  expect(s.style).toBe('retro');
  expect((s.bindings as Record<string, string[]>).flare[0]).toBe('KeyG');
  expect(errors).toEqual([]);
});
