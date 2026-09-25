import { describe, expect, it } from 'vitest';
import { cleanName, isProfane, MemoryScoreStore, validateSubmission, weekStart } from '../shared/leaderboard';
import { handleRequest, type Deps } from '../server/handler';

const PID = 'a'.repeat(24);
const PID2 = 'b'.repeat(24);

function deps(now = Date.UTC(2026, 8, 24, 12)): Deps & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    store: new MemoryScoreStore(),
    events: {
      record: async (day, type, stage, value) => void recorded.push(`${day}:${type}:${stage}:${value}`),
    },
    allowedOrigin: '*',
    salt: 'test',
    now: () => now,
    recorded,
  };
}

const post = (path: string, body: unknown, ip = '1.2.3.4') =>
  new Request(`https://api.test${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  });
const get = (path: string) => new Request(`https://api.test${path}`);
const sub = (over: Record<string, unknown> = {}) => ({
  playerId: PID,
  name: 'ace',
  score: 120000,
  mode: 'arcade',
  stage: 3,
  jet: 'kestrel',
  difficulty: 'normal',
  seed: 5,
  version: '0.3.0',
  ...over,
});

describe('name filter (J5)', () => {
  it('sanitises and blocks profanity incl. leetspeak', () => {
    expect(cleanName('  maverick!! ')).toBe('MAVERICK');
    expect(cleanName('a-very-long-callsign-name')).toHaveLength(12);
    expect(isProfane('sh1t')).toBe(true);
    expect(cleanName('F.U.C.K')).toBe('PILOT');
    expect(cleanName('')).toBe('PILOT');
    expect(isProfane('SCUNTHORPE')).toBe(true); // conservative on purpose
    expect(isProfane('HOT TAIL')).toBe(false);
  });
});

describe('validation', () => {
  it('rejects malformed or implausible submissions', () => {
    expect(validateSubmission(sub()).ok).toBe(true);
    expect(validateSubmission(sub({ playerId: 'x' })).ok).toBe(false);
    expect(validateSubmission(sub({ mode: 'god' })).ok).toBe(false);
    expect(validateSubmission(sub({ stage: 0 })).ok).toBe(false);
    expect(validateSubmission(sub({ score: 1.5 })).ok).toBe(false);
    expect(validateSubmission(sub({ score: 99_000_000 })).ok).toBe(false);
  });

  it('weekly periods start Monday 00:00 UTC', () => {
    const thu = Date.UTC(2026, 8, 24, 15); // Thursday
    expect(new Date(weekStart(thu)).toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('API handler (J3)', () => {
  it('submits, ranks best-per-player and serves top + around-me', async () => {
    const d = deps();
    let r = await handleRequest(post('/api/scores', sub()), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ rank: 1, best: true });
    await handleRequest(
      post('/api/scores', sub({ playerId: PID2, name: 'viper', score: 200000 }), '5.6.7.8'),
      d,
    );
    await handleRequest(post('/api/scores', sub({ score: 50000 })), d); // worse: not a new best
    r = await handleRequest(get('/api/scores?mode=arcade&period=all'), d);
    const top = (await r.json()) as { entries: { name: string; score: number; rank: number }[] };
    expect(top.entries.map((e) => [e.rank, e.name, e.score])).toEqual([
      [1, 'VIPER', 200000],
      [2, 'ACE', 120000],
    ]);
    r = await handleRequest(get(`/api/scores/around?mode=arcade&period=weekly&playerId=${PID}`), d);
    const around = (await r.json()) as { entries: { me?: boolean; rank: number }[] };
    expect(around.entries.find((e) => e.me)?.rank).toBe(2);
  });

  it('rate limits bursts from one player', async () => {
    const d = deps();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++)
      codes.push((await handleRequest(post('/api/scores', sub({ score: i })), d)).status);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });

  it('records only whitelisted anonymous events', async () => {
    const d = deps();
    const r = await handleRequest(
      post('/api/events', {
        events: [
          { type: 'death', stage: 3, value: 1 },
          { type: 'email', stage: 1, value: 1 },
        ],
      }),
      d,
    );
    expect(await r.json()).toEqual({ recorded: 1 });
    expect(d.recorded).toEqual(['2026-09-24:death:3:1']);
  });

  it('answers CORS preflight and 404s', async () => {
    const d = deps();
    expect(
      (await handleRequest(new Request('https://api.test/api/scores', { method: 'OPTIONS' }), d)).status,
    ).toBe(204);
    expect((await handleRequest(get('/nope'), d)).status).toBe(404);
    expect((await handleRequest(post('/api/scores', 'garbage'), d)).status).toBe(400);
  });
});
