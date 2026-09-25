import { describe, expect, it } from 'vitest';
import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import {
  decodeRun,
  encodeRun,
  quantizeInput,
  rleDecode,
  rleEncode,
  RunRecorder,
  type RunReplay,
} from '@/sim/replay';
import { validateRun } from '@/sim/validate';
import { dacos, dasin, datan, datan2, dcos, dexp, dsin } from '@/core/dmath';
import { MemoryScoreStore, processPending } from '../shared/leaderboard';
import { handleRequest } from '../server/src/handler';
import { validateReplay } from '../server/src/worker';
import type { InputFrame } from '@/sim/types';

/** Plays like the app does: stage 1, stage mark into 2 after the clear, refuel mark. */
function recordRun(seed: number, seconds: number): { replay: RunReplay; score: number } {
  const sim = new Sim(seed, { jet: 'dart', difficulty: 'hard' });
  sim.cheats.invincible = false;
  const rec = new RunRecorder(seed, sim.options, 0);
  sim.loadStage(STAGES[0]);
  const raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  const q: InputFrame = { x: 0, y: 0, buttons: 0 };
  let cleared = false;
  sim.events.on('stageClear', () => (cleared = true));
  let stage = 0;
  for (let t = 0; t < seconds * 60 && sim.state !== 'gameover'; t++) {
    if (cleared && stage === 0 && sim.tick % 60 === 0) {
      // Results screen, then a refuel and the next stage — as marks.
      rec.mark('refuel');
      sim.startRefuel();
      stage = -1;
    }
    if (stage === -1 && sim.state === 'cleared' && sim.refuel.done) {
      stage = 1;
      rec.mark('stage', 1);
      sim.loadStage(STAGES[1]);
    }
    quantizeInput(botInput(sim, raw), q);
    rec.record(q);
    sim.step(q);
  }
  return { replay: rec.finish(), score: sim.score.score };
}

describe('deterministic math', () => {
  it('matches Math.* to ~1e-14', () => {
    for (let i = -2000; i <= 2000; i++) {
      const x = i * 0.0173;
      expect(dsin(x)).toBeCloseTo(Math.sin(x), 13);
      expect(dcos(x)).toBeCloseTo(Math.cos(x), 13);
      expect(datan(x)).toBeCloseTo(Math.atan(x), 13);
      expect(datan2(x, 1.3 - i * 0.001)).toBeCloseTo(Math.atan2(x, 1.3 - i * 0.001), 13);
      expect(dexp(x * 0.1)).toBeCloseTo(Math.exp(x * 0.1), 11);
      const c = Math.sin(x);
      expect(dacos(c)).toBeCloseTo(Math.acos(c), 12);
      expect(dasin(c)).toBeCloseTo(Math.asin(c), 12);
    }
  });

  it('produces fixed golden bit patterns (catches engine/implementation drift)', () => {
    // If these change, replays recorded by older clients stop validating: bump SIM_VERSION.
    const bits = (v: number) => {
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, v);
      return b.getBigUint64(0).toString(16);
    };
    expect([dsin(1.234), dcos(-7.5), dexp(-0.05), dacos(0.3)].map(bits)).toMatchSnapshot();
  });
});

describe('run replays (J4)', () => {
  it('RLE round-trips and compresses', () => {
    const frames = new Int8Array(3 * 1000);
    for (let i = 0; i < 1000; i++) frames[i * 3] = i < 500 ? 0 : 127;
    const enc = rleEncode(frames);
    expect(enc.length).toBeLessThan(40);
    expect(Array.from(rleDecode(enc))).toEqual(Array.from(frames));
  });

  it('a recorded multi-stage run with refuel re-simulates to the same score', () => {
    const { replay, score } = recordRun(77, 130);
    expect(replay.marks.map((m) => m.kind)).toEqual(['refuel', 'stage']);
    expect(score).toBeGreaterThan(100000);
    const decoded = decodeRun(encodeRun(replay));
    expect(validateRun(decoded, score)).toEqual({ status: 'verified', score });
  });

  it('rejects inflated scores and doctored inputs; old sims are unverifiable', () => {
    const { replay, score } = recordRun(5, 40);
    expect(validateRun(replay, score + 1000).status).toBe('rejected');
    const doctored = { ...replay, frames: replay.frames.slice() };
    for (let i = 0; i < doctored.frames.length; i += 3) doctored.frames[i + 2] = 1; // hold fire the whole time
    expect(validateRun(doctored, score).status).toBe('rejected');
    expect(validateRun({ ...replay, simVersion: 1 }, score).status).toBe('unverifiable');
  });

  it('API queues submissions with replays and the cron validator settles them', async () => {
    const { replay, score } = recordRun(9, 40);
    const store = new MemoryScoreStore();
    const deps = {
      store,
      events: { record: async () => undefined },
      allowedOrigin: '*',
      salt: 's',
      now: () => Date.UTC(2026, 8, 25),
    };
    const post = (body: unknown, ip: string) =>
      handleRequest(
        new Request('https://api.test/api/scores', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'cf-connecting-ip': ip },
        }),
        deps,
      );
    const base = {
      name: 'ace',
      mode: 'arcade',
      stage: 1,
      jet: 'dart',
      difficulty: 'hard',
      seed: 9,
      version: 't',
    };
    await post({ ...base, playerId: 'a'.repeat(24), score, replay: encodeRun(replay) }, '1.1.1.1');
    await post({ ...base, playerId: 'b'.repeat(24), score: score * 3, replay: encodeRun(replay) }, '2.2.2.2');
    expect(store.rows.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(await processPending(store, validateReplay)).toBe(2);
    expect(store.rows.map((r) => r.status)).toEqual(['verified', 'rejected']);
    const top = await store.top('arcade', 0, 10);
    expect(top.map((e) => [e.score, e.status])).toEqual([[score, 'verified']]);
  });
});
