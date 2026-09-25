import { handleRequest } from './handler';
import { D1EventSink, D1ScoreStore, type D1Database } from './d1';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  IP_SALT: string;
}

/** Cloudflare Worker entry point. */
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
};
