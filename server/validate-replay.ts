import { decodeRun } from '../src/sim/replay';
import { validateRun } from '../src/sim/validate';
import type { ScoreStatus } from '../shared/leaderboard';

/** Re-simulates a submitted run with the exact game simulation (J4). */
export function validateReplay(replay: string, score: number): ScoreStatus {
  return validateRun(decodeRun(replay), score).status;
}
