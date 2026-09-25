import { expect, test } from '@playwright/test';
import './hook';

/**
 * Browser soak (Q10): plays for SOAK_MINUTES (default: skipped) cycling stages
 * with the autopilot, sampling JS heap (after forced GC), GPU resource counts
 * and music-scheduler drift. Run: SOAK_MINUTES=60 pnpm exec playwright test e2e/soak.spec.ts --project=soak
 */
const minutes = Number(process.env.SOAK_MINUTES ?? 0);

test.skip(!minutes, 'set SOAK_MINUTES to run the soak test');

test('long session stays flat on memory and audio timing', async ({ page }) => {
  test.setTimeout((minutes + 3) * 60_000);
  await page.goto('/?autotest&quality=low&debug');
  await page.waitForFunction(() => window.__hotTail?.state === 'playing', null, { timeout: 60_000 });
  await page.keyboard.press('Shift'); // unlock audio
  const sample = () =>
    page.evaluate(() => {
      (globalThis as unknown as { gc?: () => void }).gc?.();
      const h = window.__hotTail! as unknown as {
        app: {
          view: { stats(): { geometries: number; textures: number } };
          audio: { engine: { ctx: AudioContext | null }; music: { current: { nextTime: number } | null } };
          sim: { world: { entities: unknown[] }; state: string };
          stageIndex: number;
        };
        debug: { startGame(m: string, s: number): void; clearStage(): void };
      };
      const a = h.app;
      const mem =
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
      const ctx = a.audio.engine.ctx;
      const cur = (a.audio.music as unknown as { current: { nextTime: number } | null }).current;
      return {
        heapMB: mem / 1048576,
        ...a.view.stats(),
        entities: a.sim.world.entities.length,
        audioLead: ctx && cur ? cur.nextTime - ctx.currentTime : 0,
      };
    });
  const samples = [];
  const end = Date.now() + minutes * 60_000;
  let stage = 0;
  while (Date.now() < end) {
    await page.waitForTimeout(20_000);
    // Hop to the next stage periodically so every biome/kit gets built and torn down.
    stage = (stage + 1) % 18;
    await page.evaluate((s) => window.__hotTail!.debug!.startGame('practice', s), stage);
    samples.push(await sample());
  }
  console.table(samples);
  const first = samples[Math.min(2, samples.length - 1)];
  const last = samples[samples.length - 1];
  expect(last.heapMB - first.heapMB).toBeLessThan(40);
  expect(last.geometries - first.geometries).toBeLessThan(40);
  expect(last.textures - first.textures).toBeLessThan(8);
  for (const s of samples) expect(Math.abs(s.audioLead)).toBeLessThan(0.5);
});
