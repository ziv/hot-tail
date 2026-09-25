import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { encodeRun, quantizeInput, RunRecorder } from '@/sim/replay';
import { SECURITY_HEADERS } from '../scripts/security-headers.mjs';

/**
 * End-to-end check of the deployable Vercel function (.vercel/output, built by
 * `pnpm build:vercel`): it talks to a local stand-in for Supabase's PostgREST
 * RPC endpoint backed by PGlite running the real migration, through real
 * supabase-js HTTP calls. Skipped when the bundle hasn't been built.
 */
const BUNDLE = '.vercel/output/functions/api.func/index.mjs';

function listen(server: Server): Promise<number> {
  return new Promise((r) => server.listen(0, () => r((server.address() as { port: number }).port)));
}

describe.skipIf(!existsSync(BUNDLE))('Vercel function bundle', () => {
  it('routes every response through the security headers and ships the cron', () => {
    const config = JSON.parse(readFileSync('.vercel/output/config.json', 'utf8')) as {
      routes: { src?: string; headers?: Record<string, string> }[];
      crons: { path: string }[];
    };
    const all = config.routes.find((r) => r.src === '/(.*)');
    expect(all?.headers).toEqual(SECURITY_HEADERS);
    expect(config.crons.map((c) => c.path)).toEqual(['/api/cron/validate']);
    expect(existsSync('.vercel/output/static/robots.txt')).toBe(true);
    expect(readFileSync('.vercel/output/static/index.html', 'utf8')).toContain(
      'https://hot-tail.vercel.app/media/og.jpg',
    );
  });

  it('serves submit (with replay validation), top and cron against Supabase RPC', async () => {
    const db = new PGlite();
    await db.exec(readFileSync('supabase/migrations/20260925120000_leaderboard.sql', 'utf8'));
    // Minimal PostgREST RPC: POST /rest/v1/rpc/<fn> with JSON named args.
    const supa = createServer(async (req, res) => {
      const fn = req.url!.split('/rpc/')[1].split('?')[0];
      let body = '';
      for await (const c of req) body += c;
      const args = JSON.parse(body || '{}') as Record<string, unknown>;
      const keys = Object.keys(args);
      const r = await db.query<Record<string, unknown>>(
        `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`,
        keys.map((k) => args[k]),
      );
      const scalar = r.fields.length === 1 && r.fields[0].name === fn;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(scalar ? (r.rows[0]?.[fn] ?? null) : r.rows, (_k, v) =>
          typeof v === 'bigint' ? Number(v) : v,
        ),
      );
    });
    const supaPort = await listen(supa);
    Object.assign(process.env, {
      SUPABASE_URL: `http://localhost:${supaPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      CRON_SECRET: 'cron',
      IP_SALT: 'salt',
    });
    const mod = (await import(/* @vite-ignore */ `${process.cwd()}/${BUNDLE}`)) as {
      default: (req: unknown, res: unknown) => Promise<void>;
    };
    const api = createServer((req, res) => void mod.default(req, res));
    const port = await listen(api);
    const base = `http://localhost:${port}`;

    // A genuine 20 s run.
    const sim = new Sim(8);
    const rec = new RunRecorder(8, sim.options, 0);
    sim.loadStage(STAGES[0]);
    const raw = { x: 0, y: 0, buttons: 0 };
    const q = { x: 0, y: 0, buttons: 0 };
    for (let t = 0; t < 60 * 20; t++) {
      quantizeInput(botInput(sim, raw), q);
      rec.record(q);
      sim.step(q);
    }
    const sub = {
      playerId: 'ab'.repeat(12),
      name: 'maverick',
      score: sim.score.score,
      mode: 'arcade',
      stage: 1,
      jet: 'kestrel',
      difficulty: 'normal',
      seed: 8,
      version: 'test',
      replay: encodeRun(rec.finish()),
    };
    // Vercel routes /api/<path> → /api?__path=<path>
    const submit = await fetch(`${base}/api?__path=scores`, { method: 'POST', body: JSON.stringify(sub) });
    expect(await submit.json()).toMatchObject({ status: 'verified', rank: 1, best: true });
    const top = await (await fetch(`${base}/api?__path=scores&mode=arcade&period=weekly`)).json();
    expect(top.entries[0]).toMatchObject({ name: 'MAVERICK', score: sub.score, status: 'verified' });
    expect((await fetch(`${base}/api?__path=cron/validate`)).status).toBe(401);
    const cron = await fetch(`${base}/api?__path=cron/validate`, {
      headers: { authorization: 'Bearer cron' },
    });
    expect(await cron.json()).toEqual({ validated: 0 });
    api.close();
    supa.close();
  }, 60_000);
});
