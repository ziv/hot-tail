/**
 * Leaderboard domain logic shared by the game client and the serverless API:
 * submission validation, name sanitising + profanity filter (J5), plausibility
 * limits, weekly periods, and an in-memory store used for offline play,
 * local development and tests.
 */
export type LbMode = 'arcade' | 'scoreAttack';
export type LbPeriod = 'all' | 'weekly';

export const LB_MODES: LbMode[] = ['arcade', 'scoreAttack'];
export const NAME_MAX = 12;
export const MAX_STAGE = 18;
/** Generous per-stage ceiling; real validation is replay re-simulation (J4, M4). */
export const MAX_POINTS_PER_STAGE = 2_500_000;

export interface ScoreSubmission {
  playerId: string;
  name: string;
  score: number;
  mode: LbMode;
  stage: number;
  jet: string;
  difficulty: string;
  seed: number;
  version: string;
  replay?: string;
}

export type ScoreStatus = 'pending' | 'verified' | 'rejected' | 'unverifiable';

export interface ScoreRow extends ScoreSubmission {
  id?: number;
  createdAt: number;
  ipHash: string;
  /** Replay validation state (J4). Rejected rows never appear on boards. */
  status?: ScoreStatus;
}

export interface ScoreEntry {
  rank: number;
  name: string;
  score: number;
  stage: number;
  jet: string;
  createdAt: number;
  status?: ScoreStatus;
  me?: boolean;
}

export interface ScoreStore {
  insert(row: ScoreRow): Promise<void>;
  /** Best score per player, descending. */
  top(mode: LbMode, since: number, limit: number, offset?: number): Promise<ScoreEntry[]>;
  /** 1-based rank of the player's best score, or 0 if absent. */
  rankOf(mode: LbMode, since: number, playerId: string): Promise<number>;
  countRecent(playerId: string, ipHash: string, since: number): Promise<number>;
  bestOf(mode: LbMode, since: number, playerId: string): Promise<number>;
  /** Oldest rows awaiting replay validation. */
  pending(limit: number): Promise<(ScoreRow & { id: number })[]>;
  setStatus(id: number, status: ScoreStatus): Promise<void>;
  /** Erases every score of a player (privacy request); returns rows removed. */
  deletePlayer(playerId: string): Promise<number>;
}

const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'nigg',
  'fag',
  'dick',
  'cock',
  'pussy',
  'whore',
  'slut',
  'rape',
  'nazi',
  'twat',
  'wank',
  'asshole',
  'retard',
  'kike',
  'spic',
  'chink',
  'penis',
  'vagina',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

export function isProfane(name: string): boolean {
  const flat = name
    .toLowerCase()
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
  return BLOCKED.some((w) => flat.includes(w));
}

/** Uppercase A–Z, digits and a few separators; blocked words become PILOT. */
export function cleanName(raw: string): string {
  const s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!s || isProfane(s)) return 'PILOT';
  return s;
}

export type Validation = { ok: true; value: ScoreSubmission } | { ok: false; error: string };

export function validateSubmission(input: unknown): Validation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'bad body' };
  const s = input as Record<string, unknown>;
  const playerId = String(s.playerId ?? '');
  if (!/^[0-9a-f]{24}$/.test(playerId)) return { ok: false, error: 'bad playerId' };
  const mode = s.mode as LbMode;
  if (!LB_MODES.includes(mode)) return { ok: false, error: 'bad mode' };
  const stage = Number(s.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > MAX_STAGE) return { ok: false, error: 'bad stage' };
  const score = Number(s.score);
  if (!Number.isInteger(score) || score < 0) return { ok: false, error: 'bad score' };
  if (score > stage * MAX_POINTS_PER_STAGE) return { ok: false, error: 'implausible score' };
  const replay = s.replay === undefined ? undefined : String(s.replay);
  if (replay && replay.length > 400_000) return { ok: false, error: 'replay too large' };
  return {
    ok: true,
    value: {
      playerId,
      name: cleanName(String(s.name ?? '')),
      score,
      mode,
      stage,
      jet: String(s.jet ?? 'kestrel').slice(0, 16),
      difficulty: String(s.difficulty ?? 'normal').slice(0, 8),
      seed: Number(s.seed) >>> 0,
      version: String(s.version ?? '').slice(0, 16),
      replay,
    },
  };
}

/** Start of the ISO week (Monday 00:00 UTC) containing ts. Weekly boards reset then. */
export function weekStart(ts: number): number {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export function periodStart(period: LbPeriod, now: number): number {
  return period === 'weekly' ? weekStart(now) : 0;
}

/** Array-backed store (offline/local mode, dev server, tests). */
export class MemoryScoreStore implements ScoreStore {
  constructor(public rows: ScoreRow[] = []) {}

  async insert(row: ScoreRow): Promise<void> {
    this.rows.push({ ...row, id: this.rows.length + 1, status: row.status ?? 'unverifiable' });
  }

  async pending(limit: number): Promise<(ScoreRow & { id: number })[]> {
    return this.rows.filter((r) => r.status === 'pending').slice(0, limit) as (ScoreRow & { id: number })[];
  }

  async setStatus(id: number, status: ScoreStatus): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = status;
  }

  async deletePlayer(playerId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.playerId !== playerId);
    return before - this.rows.length;
  }

  private bests(mode: LbMode, since: number): ScoreRow[] {
    const best = new Map<string, ScoreRow>();
    for (const r of this.rows) {
      if (r.mode !== mode || r.createdAt < since || r.status === 'rejected') continue;
      const cur = best.get(r.playerId);
      if (!cur || r.score > cur.score || (r.score === cur.score && r.createdAt < cur.createdAt))
        best.set(r.playerId, r);
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  }

  async top(mode: LbMode, since: number, limit: number, offset = 0): Promise<ScoreEntry[]> {
    return this.bests(mode, since)
      .slice(offset, offset + limit)
      .map((r, i) => ({
        rank: offset + i + 1,
        name: r.name,
        score: r.score,
        stage: r.stage,
        jet: r.jet,
        createdAt: r.createdAt,
        status: r.status,
      }));
  }

  async rankOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    const i = this.bests(mode, since).findIndex((r) => r.playerId === playerId);
    return i + 1;
  }

  async countRecent(playerId: string, ipHash: string, since: number): Promise<number> {
    return this.rows.filter((r) => r.createdAt >= since && (r.playerId === playerId || r.ipHash === ipHash))
      .length;
  }

  async bestOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    return this.bests(mode, since).find((r) => r.playerId === playerId)?.score ?? 0;
  }
}

export const RATE_LIMIT = { window: 10 * 60 * 1000, max: 8 };

export interface SubmitResult {
  rank: number;
  weeklyRank: number;
  best: boolean;
  status: ScoreStatus;
}

/**
 * Shared submit flow: validate input → rate-limit → re-simulate the replay
 * (J4; a full run takes well under a second) → store → rank.
 */
export async function submitScore(
  store: ScoreStore,
  body: unknown,
  ipHash: string,
  now: number,
  validate?: RunValidator,
): Promise<{ status: number; body: SubmitResult | { error: string } }> {
  const v = validateSubmission(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const sub = v.value;
  const recent = await store.countRecent(sub.playerId, ipHash, now - RATE_LIMIT.window);
  if (recent >= RATE_LIMIT.max) return { status: 429, body: { error: 'rate limited' } };
  let status: ScoreStatus = sub.replay ? 'pending' : 'unverifiable';
  if (sub.replay && validate) {
    try {
      status = validate(sub.replay, sub.score);
    } catch {
      status = 'rejected';
    }
  }
  const prevBest = await store.bestOf(sub.mode, 0, sub.playerId);
  // Rejected runs are kept for moderation but never ranked.
  await store.insert({ ...sub, createdAt: now, ipHash, status });
  const ranked = status !== 'rejected';
  return {
    status: 200,
    body: {
      rank: ranked ? await store.rankOf(sub.mode, 0, sub.playerId) : 0,
      weeklyRank: ranked ? await store.rankOf(sub.mode, weekStart(now), sub.playerId) : 0,
      best: ranked && sub.score > prevBest,
      status,
    },
  };
}

/** Entries surrounding the player's rank ("around me"). */
export async function aroundMe(
  store: ScoreStore,
  mode: LbMode,
  since: number,
  playerId: string,
  span = 3,
): Promise<ScoreEntry[]> {
  const rank = await store.rankOf(mode, since, playerId);
  if (rank === 0) return [];
  const offset = Math.max(0, rank - 1 - span);
  const rows = await store.top(mode, since, span * 2 + 1, offset);
  return rows.map((r) => ({ ...r, me: r.rank === rank }));
}

export type RunValidator = (replay: string, score: number) => ScoreStatus;

/**
 * Validates queued submissions (J4): re-simulates each replay and marks the
 * row verified or rejected. Called from the API's scheduled handler.
 */
export async function processPending(store: ScoreStore, validate: RunValidator, limit = 5): Promise<number> {
  const rows = await store.pending(limit);
  for (const r of rows) {
    let status: ScoreStatus;
    try {
      status = r.replay ? validate(r.replay, r.score) : 'unverifiable';
    } catch {
      status = 'rejected';
    }
    await store.setStatus(r.id, status);
  }
  return rows.length;
}
