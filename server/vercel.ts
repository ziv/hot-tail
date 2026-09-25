import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { handleRequest, type Deps } from './handler';
import { SupabaseEventSink, SupabaseScoreStore } from './supabase';
import { SupabaseOpsStore } from './ops';
import { validateReplay } from './validate-replay';

/**
 * Vercel serverless function (Node runtime, Build Output API) serving every
 * /api/* route. Configuration comes from the Vercel project's environment:
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IP_SALT, CRON_SECRET, ALLOWED_ORIGIN.
 */
let deps: Deps | null = null;

function getDeps(): Deps | null {
  if (deps) return deps;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  deps = {
    store: new SupabaseScoreStore(db),
    events: new SupabaseEventSink(db),
    // Same-origin by default (game and API share the Vercel domain).
    allowedOrigin: process.env.ALLOWED_ORIGIN ?? '',
    salt: process.env.IP_SALT ?? 'hot-tail',
    now: () => Date.now(),
    validate: validateReplay,
    cronSecret: process.env.CRON_SECRET,
    ops: new SupabaseOpsStore(db),
  };
  return deps;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
  // Routes rewrite /api/<path> to this function as /api?__path=<path>.
  const path = url.searchParams.get('__path');
  if (path !== null) {
    url.pathname = `/api/${path}`;
    url.searchParams.delete('__path');
  }
  const d = getDeps();
  const response = d
    ? await handleRequest(await toRequest(req, url), d)
    : new Response(JSON.stringify({ error: 'leaderboard not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const method = req.method ?? 'GET';
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = Buffer.concat(chunks).toString('utf8');
  }
  return new Request(url, { method, headers, body });
}
