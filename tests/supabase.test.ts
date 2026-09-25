import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { SupabaseEventSink, SupabaseScoreStore, type RpcClient } from '../server/supabase';
import { handleRequest, type Deps } from '../server/handler';
import { validateReplay } from '../server/validate-replay';
import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { encodeRun, quantizeInput, RunRecorder } from '@/sim/replay';
import type { InputFrame } from '@/sim/types';

/**
 * Runs the real Supabase migration in PGlite (Postgres compiled to WASM) and
 * drives it through the same RPC calls supabase-js makes, so the SQL is tested.
 */
const MIGRATION = readFileSync('supabase/migrations/20260925120000_leaderboard.sql', 'utf8');

/** Mimics supabase-js rpc(): named args; scalar functions return the bare value. */
function pgliteRpc(db: PGlite): RpcClient {
  return {
    async rpc(fn, args) {
      const keys = Object.keys(args);
      const sql = `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      try {
        const r = await db.query<Record<string, unknown>>(
          sql,
          keys.map((k) => args[k]),
        );
        if (r.fields.length === 1 && r.fields[0].name === fn)
          return { data: r.rows[0]?.[fn] ?? null, error: null };
        return { data: r.rows, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  };
}

const NOW = Date.UTC(2026, 8, 25, 12);
const pid = (c: string) => c.repeat(24);

let db: PGlite;
let deps: Deps;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(MIGRATION);
  const rpc = pgliteRpc(db);
  deps = {
    store: new SupabaseScoreStore(rpc),
    events: new SupabaseEventSink(rpc),
    allowedOrigin: '',
    salt: 't',
    now: () => NOW,
    validate: validateReplay,
    cronSecret: 'secret',
  };
});

const post = (path: string, body: unknown, ip = '1.1.1.1') =>
  handleRequest(
    new Request(`https://game.test${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'x-real-ip': ip },
    }),
    deps,
  );
const get = (path: string, headers: Record<string, string> = {}) =>
  handleRequest(new Request(`https://game.test${path}`, { headers }), deps);
const base = { mode: 'arcade', stage: 3, jet: 'kestrel', difficulty: 'normal', seed: 1, version: 't' };

function recordRun(seed: number): { replay: string; score: number } {
  const sim = new Sim(seed);
  const rec = new RunRecorder(seed, sim.options, 0);
  sim.loadStage(STAGES[0]);
  const raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  const q: InputFrame = { x: 0, y: 0, buttons: 0 };
  for (let t = 0; t < 60 * 25; t++) {
    quantizeInput(botInput(sim, raw), q);
    rec.record(q);
    sim.step(q);
  }
  return { replay: encodeRun(rec.finish()), score: sim.score.score };
}

describe('Supabase store (PGlite)', () => {
  it('ranks best score per player, weekly and all-time, and serves around-me', async () => {
    await post('/api/scores', { ...base, playerId: pid('a'), name: 'ace', score: 1000 });
    await post('/api/scores', { ...base, playerId: pid('a'), name: 'ace', score: 5000 }, '1.1.1.2');
    await post('/api/scores', { ...base, playerId: pid('b'), name: 'viper', score: 3000 }, '2.2.2.2');
    await post('/api/scores', { ...base, playerId: pid('c'), name: 'goose', score: 3000 }, '3.3.3.3');
    const top = (await (await get('/api/scores?mode=arcade&period=all')).json()) as {
      entries: { rank: number; name: string; score: number }[];
    };
    expect(top.entries.map((e) => [e.rank, e.name, e.score])).toEqual([
      [1, 'ACE', 5000],
      [2, 'VIPER', 3000],
      [3, 'GOOSE', 3000],
    ]);
    const around = (await (
      await get(`/api/scores/around?mode=arcade&period=weekly&playerId=${pid('c')}`)
    ).json()) as {
      entries: { rank: number; me?: boolean }[];
    };
    expect(around.entries.find((e) => e.me)?.rank).toBe(3);
    expect(await deps.store.rankOf('arcade', 0, pid('z'))).toBe(0);
  });

  it('verifies real replays inline and rejects forged scores', async () => {
    const { replay, score } = recordRun(3);
    const ok = await (
      await post('/api/scores', { ...base, playerId: pid('d'), name: 'real', score, replay })
    ).json();
    expect(ok).toMatchObject({ status: 'verified', rank: 1 });
    const bad = await (
      await post(
        '/api/scores',
        { ...base, playerId: pid('e'), name: 'forger', score: score * 5, replay },
        '9.9.9.9',
      )
    ).json();
    expect(bad).toMatchObject({ status: 'rejected', rank: 0 });
    const top = await deps.store.top('arcade', 0, 10);
    expect(top.map((e) => [e.name, e.status])).toEqual([['REAL', 'verified']]);
  });

  it('daily cron validates leftovers and requires the secret', async () => {
    const { replay, score } = recordRun(4);
    const noValidate = { ...deps, validate: undefined };
    await handleRequest(
      new Request('https://game.test/api/scores', {
        method: 'POST',
        body: JSON.stringify({ ...base, playerId: pid('f'), name: 'late', score, replay }),
      }),
      noValidate,
    );
    expect((await deps.store.pending(10)).length).toBe(1);
    expect((await get('/api/cron/validate')).status).toBe(401);
    const res = await get('/api/cron/validate', { authorization: 'Bearer secret' });
    expect(await res.json()).toEqual({ validated: 1 });
    expect((await deps.store.pending(10)).length).toBe(0);
    expect((await deps.store.top('arcade', 0, 5))[0]).toMatchObject({ name: 'LATE', status: 'verified' });
  });

  it('rate limits and aggregates anonymous events', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 10; i++)
      codes.push((await post('/api/scores', { ...base, playerId: pid('9'), name: 'spam', score: i })).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
    await post('/api/events', {
      events: [
        { type: 'death', stage: 4 },
        { type: 'death', stage: 4, value: 2 },
      ],
    });
    const r = await db.query<{ count: number; total: number }>('select count, total from events');
    expect(r.rows).toEqual([{ count: 2, total: 2 }]);
  });
});
