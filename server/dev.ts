import { createServer } from 'node:http';
import { MemoryScoreStore } from '../shared/leaderboard';
import { handleRequest } from './handler';
import { validateReplay } from './validate-replay';
import vercelHandler from './vercel';
import { MemoryOpsStore } from './ops';

/**
 * Local API for `pnpm dev:api` (Vite proxies /api here). Uses Supabase when
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set, otherwise an in-memory board.
 */
const port = Number(process.env.PORT ?? 8787);
const useSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const memory = {
  store: new MemoryScoreStore(),
  events: { record: async (...a: unknown[]) => console.log('[event]', ...a) },
  allowedOrigin: '*',
  salt: 'dev',
  now: () => Date.now(),
  validate: validateReplay,
  cronSecret: 'dev',
  ops: new MemoryOpsStore(),
};

createServer(async (req, res) => {
  if (useSupabase) return vercelHandler(req, res);
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const response = await handleRequest(
    new Request(url, {
      method: req.method,
      headers,
      body:
        req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks).toString('utf8'),
    }),
    memory,
  );
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () =>
  console.log(`Hot Tail API on http://localhost:${port} (${useSupabase ? 'Supabase' : 'in-memory'})`),
);
