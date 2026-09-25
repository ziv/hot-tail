import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { quantizeInput } from '@/sim/replay';
import type { InputFrame } from '@/sim/types';

/** Headless simulation harness (A4): runs a stage with scripted input. */
export function runStage(
  stageIndex: number,
  seed: number,
  ticks: number,
  input: (sim: Sim, out: InputFrame) => InputFrame = botInput,
  setup?: (sim: Sim) => void,
): Sim {
  const sim = new Sim(seed);
  setup?.(sim);
  sim.loadStage(STAGES[stageIndex]);
  const raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  const q: InputFrame = { x: 0, y: 0, buttons: 0 };
  for (let i = 0; i < ticks; i++) {
    sim.step(quantizeInput(input(sim, raw), q));
    if (sim.state === 'gameover') break;
  }
  return sim;
}
