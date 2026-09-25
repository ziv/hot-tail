import type { OpsStore } from './ops';
import {
  aroundMe,
  LB_MODES,
  periodStart,
  processPending,
  submitScore,
  type RunValidator,
  type LbMode,
  type LbPeriod,
  type ScoreStore,
} from '../shared/leaderboard';

/**
 * Leaderboard + analytics API (J3/J4/J6). Pure request handler with injected
 * storage and validator, so it runs the same on Vercel (Supabase), in the local
 * dev server (memory) and in tests.
 *
 *   POST /api/scores                 submit a score (validated, rate limited)
 *   GET  /api/scores?mode&period     top 50 (best per player)
 *   GET  /api/scores/around?mode&period&playerId
 *   POST /api/scores/delete          erase a player's scores (privacy request)
 *   POST /api/events                 anonymous aggregate gameplay stats
 *   GET  /api/cron/validate          daily sweep of unvalidated runs (Bearer CRON_SECRET)
 *   POST /api/errors                 client error reports, deduplicated (J7)
 *   GET  /api/status                 public aggregate health/usage summary (R3)
 *   GET  /api/health[?deep=1]
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
  /** Re-simulates a run replay (J4); omitted → scores stay 'pending' for the cron. */
  validate?: RunValidator;
  cronSecret?: string;
  /** Error reports + status summary (J7/R3); omitted → those routes answer 404. */
  ops?: OpsStore;
}

// load_ms uses `stage` as a 250 ms histogram bucket so the status page can report p50/p95.
const EVENT_TYPES = new Set([
  'stage_start',
  'stage_clear',
  'death',
  'game_over',
  'session_length',
  'load_ms',
]);

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(req, deps.allowedOrigin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  try {
    if (url.pathname === '/api/health') {
      // ?deep=1 also touches the database (used by the uptime workflow, which
      // incidentally keeps a free Supabase project from pausing).
      if (url.searchParams.has('deep')) {
        try {
          await deps.store.top('arcade', 0, 1);
          return json(200, { ok: true, db: true });
        } catch {
          return json(503, { ok: false, db: false });
        }
      }
      return json(200, { ok: true });
    }

    if (url.pathname === '/api/status' && req.method === 'GET' && deps.ops) {
      const summary = await deps.ops.summary(deps.now());
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
      });
    }

    if (url.pathname === '/api/errors' && req.method === 'POST' && deps.ops) {
      const body = (await readJson(req, 40_000)) as {
        errors?: { message?: string; stack?: string; version?: string }[];
      };
      const ua = (req.headers.get('user-agent') ?? '').slice(0, 200);
      let n = 0;
      for (const e of body.errors?.slice(0, 10) ?? []) {
        const message = String(e.message ?? '').slice(0, 300);
        if (!message) continue;
        const stack = String(e.stack ?? '').slice(0, 2000);
        const version = String(e.version ?? '').slice(0, 16);
        await deps.ops.recordError(
          { fingerprint: await fingerprint(message, stack), version, message, stack, userAgent: ua },
          deps.now(),
        );
        n++;
      }
      return json(200, { recorded: n });
    }

    if (url.pathname === '/api/cron/validate') {
      if (!deps.cronSecret || req.headers.get('authorization') !== `Bearer ${deps.cronSecret}`)
        return json(401, { error: 'unauthorized' });
      if (!deps.validate) return json(200, { validated: 0 });
      return json(200, { validated: await processPending(deps.store, deps.validate, 50) });
    }

    if (url.pathname === '/api/scores' && req.method === 'POST') {
      const body = await readJson(req, 500_000);
      const ipHash = await hashIp(clientIp(req), deps.salt);
      const res = await submitScore(deps.store, body, ipHash, deps.now(), deps.validate);
      return json(res.status, res.body);
    }

    if (url.pathname === '/api/scores/delete' && req.method === 'POST') {
      const body = (await readJson(req, 2_000)) as { playerId?: string };
      const playerId = String(body.playerId ?? '');
      if (!/^[0-9a-f]{24}$/.test(playerId)) return json(400, { error: 'bad playerId' });
      return json(200, { deleted: await deps.store.deletePlayer(playerId) });
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

/** Groups identical errors: message with numbers masked + the first stack frame (without line/col). */
async function fingerprint(message: string, stack: string): Promise<string> {
  const frame = stack.split('\n').find((l) => l.includes('at ') || l.includes('@')) ?? '';
  const key = `${message.replace(/\d+/g, '#')}|${frame.replace(/:\d+:\d+/g, '').trim()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Client IP from the platform's proxy headers (Vercel sets x-real-ip / x-forwarded-for). */
function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'local'
  );
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
