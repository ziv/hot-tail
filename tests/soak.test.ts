import { expect, it } from 'vitest';
import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { quantizeInput } from '@/sim/replay';
import type { InputFrame } from '@/sim/types';

/**
 * Simulation soak (Q10): an hour of simulated play cycling all 18 stages on one
 * Sim (as a long session does). Entity counts, pools and event listeners must
 * stay bounded — any leak in spawning/recycling shows up as growth.
 */
it('one simulated hour stays bounded', () => {
  const sim = new Sim(606);
  sim.cheats.invincible = true;
  sim.cheats.infiniteMissiles = true;
  let stage = 0;
  sim.loadStage(STAGES[stage]);
  const raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  const q: InputFrame = { x: 0, y: 0, buttons: 0 };
  let peak = 0;
  let loads = 0;
  const pool = (sim as unknown as { pool: { free: Map<string, unknown[]> } }).pool;
  const handlers = () =>
    Object.values((sim.events as unknown as { handlers: Record<string, unknown[]> }).handlers).reduce(
      (n, l) => n + l.length,
      0,
    );
  const listeners0 = handlers();
  const HOUR = 60 * 60 * 60;
  let wait = 0;
  for (let t = 0; t < HOUR; t++) {
    if (sim.state === 'cleared' && ++wait > 90) {
      wait = 0;
      stage = (stage + 1) % STAGES.length;
      sim.loadStage(STAGES[stage]);
      loads++;
    }
    sim.step(quantizeInput(botInput(sim, raw), q));
    if (sim.world.entities.length > peak) peak = sim.world.entities.length;
  }
  const pooled = [...pool.free.values()].reduce((n, l) => n + l.length, 0);
  expect(loads).toBeGreaterThan(30); // cycled the campaign repeatedly
  expect(peak).toBeLessThan(900);
  expect(pooled).toBeLessThan(1500); // free lists are bounded by peak usage
  expect(handlers()).toBe(listeners0);
}, 120_000);
