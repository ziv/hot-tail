import { Sim } from './sim';
import { STAGES } from './stages';
import { botInput } from './bot';
import { quantizeInput } from './replay';
import type { InputFrame } from './types';

/**
 * Cross-engine determinism probe (J4): a fixed 25 s autopilot run on stage 4
 * (ground targets, flak, missiles). Every JS engine must return the same hash;
 * the Playwright suite checks Chromium, Firefox and WebKit against Node.
 */
export function determinismProbe(): string {
  const sim = new Sim(20260925, { jet: 'manta', difficulty: 'hard', aimAssist: true });
  sim.loadStage(STAGES[3]);
  const raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  const q: InputFrame = { x: 0, y: 0, buttons: 0 };
  for (let i = 0; i < 60 * 25; i++) sim.step(quantizeInput(botInput(sim, raw), q));
  let h = 2166136261;
  const s = sim.stateHash();
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return `${sim.score.score}:${h.toString(16)}`;
}
