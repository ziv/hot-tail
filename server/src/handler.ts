import {
  aroundMe,
  LB_MODES,
  periodStart,
  submitScore,
  type LbMode,
  type LbPeriod,
  type ScoreStore,
} from '../../shared/leaderboard';

/**
 * Leaderboard + analytics API (J3/J6). Pure request handler with injected
 * storage so it runs the same on Cloudflare Workers (D1) and in tests.
 *
 *   POST /api/scores                 submit a score (validated, rate limited)
 *   GET  /api/scores?mode&period     top 50 (best per player)
 *   GET  /api/scores/around?mode&period&playerId
 *   POST /api/events                 anonymous aggregate gameplay stats
 *   GET  /api/health
 */
export interface EventSink {
  record(day: string, type: string, stage: number, value: number): Promise<void>;
}

export interface Deps {
  store: ScoreStore;
  events: EventSink;
  allowedOrigin: string;
  salt: string;
  now: () => number;
}

const EVENT_TYPES = new Set(['stage_start', 'stage_clear', 'death', 'game_over', 'session_length']);

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req, deps.allowedOrigin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  try {
    if (url.pathname === '/api/health') return json(200, { ok: true });

    if (url.pathname === '/api/scores' && req.method === 'POST') {
      const body = await readJson(req, 500_000);
      const ipHash = await hashIp(req.headers.get('cf-connecting-ip') ?? 'local', deps.salt);
      const res = await submitScore(deps.store, body, ipHash, deps.now());
      return json(res.status, res.body);
    }

    if (url.pathname.startsWith('/api/scores') && req.method === 'GET') {
      const mode = (url.searchParams.get('mode') ?? 'arcade') as LbMode;
      if (!LB_MODES.includes(mode)) return json(400, { error: 'bad mode' });
      const period = (url.searchParams.get('period') === 'weekly' ? 'weekly' : 'all') as LbPeriod;
      const since = periodStart(period, deps.now());
      if (url.pathname === '/api/scores/around') {
        const playerId = url.searchParams.get('playerId') ?? '';
        if (!/^[0-9a-f]{24}$/.test(playerId)) return json(400, { error: 'bad playerId' });
        return json(200, { entries: await aroundMe(deps.store, mode, since, playerId) });
      }
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
      return json(200, { entries: await deps.store.top(mode, since, limit) });
    }

    if (url.pathname === '/api/events' && req.method === 'POST') {
      const body = (await readJson(req, 20_000)) as {
        events?: { type?: string; stage?: number; value?: number }[];
      };
      const day = new Date(deps.now()).toISOString().slice(0, 10);
      let n = 0;
      for (const e of body.events?.slice(0, 100) ?? []) {
        if (!e.type || !EVENT_TYPES.has(e.type)) continue;
        const stage = Math.max(0, Math.min(99, Math.floor(Number(e.stage) || 0)));
        const value = Math.max(0, Math.min(1e6, Number(e.value) || 0));
        await deps.events.record(day, e.type, stage, value);
        n++;
      }
      return json(200, { recorded: n });
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    return json(err instanceof HttpError ? err.status : 500, {
      error: err instanceof Error ? err.message : 'error',
    });
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

function corsHeaders(req: Request, allowed: string): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = allowed === '*' || allowed.split(',').includes(origin);
  return {
    'access-control-allow-origin': ok ? origin || '*' : 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** Salted SHA-256 of the client IP — raw IPs are never stored. */
async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
