import { Sim } from './sim';
import { STAGES } from './stages';
import { DEFAULT_SIM_OPTIONS } from './sim';
import { ReplayPlayer, SIM_VERSION, type RunReplay } from './replay';
import { EMPTY_INPUT, type InputFrame } from './types';

export interface ValidationResult {
  status: 'verified' | 'rejected' | 'unverifiable';
  score: number;
  reason?: string;
}

/**
 * Score validation (J4): re-simulates a submitted run from its seed, options,
 * input log and flow marks, and checks the claimed score. Runs headless in the
 * API worker and in tests; relies on the sim being bit-deterministic.
 */
export function validateRun(
  replay: RunReplay,
  claimedScore: number,
  maxTicks = 60 * 60 * 40,
): ValidationResult {
  if (replay.simVersion !== SIM_VERSION) return { status: 'unverifiable', score: 0, reason: 'sim version' };
  if (replay.ticks > maxTicks) return { status: 'rejected', score: 0, reason: 'too long' };
  const start = STAGES[replay.startStage];
  if (!start) return { status: 'rejected', score: 0, reason: 'bad stage' };
  const options = { ...DEFAULT_SIM_OPTIONS, ...replay.options };
  const sim = new Sim(replay.seed, options);
  sim.loadStage(start);
  const player = new ReplayPlayer({
    seed: replay.seed,
    stage: replay.startStage,
    frames: replay.frames,
    ticks: replay.ticks,
  });
  const input: InputFrame = { ...EMPTY_INPUT };
  const marks = [...replay.marks].sort((a, b) => a.tick - b.tick);
  let m = 0;
  for (let t = 0; t < replay.ticks; t++) {
    while (m < marks.length && marks[m].tick <= t) {
      const mk = marks[m++];
      if (mk.kind === 'refuel') sim.startRefuel();
      else if (mk.kind === 'stage') {
        const def = STAGES[mk.stage ?? -1];
        if (!def) return { status: 'rejected', score: sim.score.score, reason: 'bad mark' };
        sim.loadStage(def);
      }
    }
    sim.step(player.next(input));
  }
  const score = sim.score.score;
  return score === claimedScore
    ? { status: 'verified', score }
    : { status: 'rejected', score, reason: `score mismatch (${score})` };
}
