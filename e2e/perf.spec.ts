import { test } from '@playwright/test';

/**
 * Q4 perf fly-through: runs the autopilot for 20 s and reports p95 frame time.
 * Fails only when PERF_BUDGET_MS is set (GPU-less CI runners are not
 * representative); run locally on target hardware to track budgets.
 */
test('perf fly-through reports p95 frame time', async ({ page }, info) => {
  await page.goto('/?autotest');
  await page.waitForFunction(
    () => (window as unknown as { __hotTail?: { state: string } }).__hotTail?.state === 'playing',
  );
  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const end = last + 20_000;
        const step = (now: number) => {
          out.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
  );
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)];
  const avg = frames.reduce((s, f) => s + f, 0) / frames.length;
  info.annotations.push({
    type: 'perf',
    description: `p95=${p95.toFixed(1)}ms avg=${avg.toFixed(1)}ms n=${frames.length}`,
  });
  console.log(`perf: p95=${p95.toFixed(1)}ms avg=${avg.toFixed(1)}ms frames=${frames.length}`);
  const budget = Number(process.env.PERF_BUDGET_MS ?? 0);
  if (budget > 0 && p95 > budget)
    throw new Error(`p95 frame time ${p95.toFixed(1)}ms exceeds budget ${budget}ms`);
});
