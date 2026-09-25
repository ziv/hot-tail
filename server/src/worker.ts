import { processPending } from '../../shared/leaderboard';
import { decodeRun } from '../../src/sim/replay';
import { validateRun } from '../../src/sim/validate';
import { handleRequest } from './handler';
import { D1EventSink, D1ScoreStore, type D1Database } from './d1';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  IP_SALT: string;
}

/** Re-simulates a submitted run with the exact game simulation (J4). */
export function validateReplay(replay: string, score: number) {
  return validateRun(decodeRun(replay), score).status;
}

/** Cloudflare Worker entry point: HTTP API + cron-driven replay validation. */
export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, {
      store: new D1ScoreStore(env.DB),
      events: new D1EventSink(env.DB),
      allowedOrigin: env.ALLOWED_ORIGIN,
      salt: env.IP_SALT,
      now: () => Date.now(),
    });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await processPending(new D1ScoreStore(env.DB), validateReplay, 5);
  },
};
