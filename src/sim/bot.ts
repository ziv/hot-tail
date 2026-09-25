import { Btn, type InputFrame } from './types';
import type { Sim } from './sim';

/**
 * Scripted "autopilot" used by headless tests, the Playwright smoke test and
 * the perf fly-through: weaves toward targets, fires, and pulses lock volleys.
 */
export function botInput(sim: Sim, out: InputFrame): InputFrame {
  const t = sim.tick / 60;
  const pe = sim.player.e.pos;
  let tx = Math.sin(t * 0.7) * 80;
  let ty = Math.sin(t * 0.45) * 30;
  // Steer toward the nearest enemy in front.
  let best = Infinity;
  for (const e of sim.targets.items) {
    if (!e.alive || !e.lockable || e.pos.z > -200) continue;
    const d = -e.pos.z + Math.abs(e.pos.x - pe.x) * 2;
    if (d < best) {
      best = d;
      tx = e.pos.x;
      ty = e.pos.y;
    }
  }
  out.x = Math.max(-1, Math.min(1, (tx - pe.x) / 60));
  out.y = Math.max(-1, Math.min(1, (ty - pe.y) / 40));
  let buttons = Btn.Fire;
  // Hold lock for ~1 s, then release to fire a volley.
  if (sim.tick % 120 < 60) buttons |= Btn.Lock;
  if (sim.threats > 0 && sim.tick % 90 === 0) buttons |= Btn.Roll;
  out.buttons = buttons;
  return out;
}
