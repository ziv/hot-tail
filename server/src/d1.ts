import type { LbMode, ScoreEntry, ScoreRow, ScoreStatus, ScoreStore } from '../../shared/leaderboard';
import type { EventSink } from './handler';

/** Minimal slice of the Cloudflare D1 API used here (avoids a types dependency). */
export interface D1Result<T> {
  results?: T[];
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
}

interface Row {
  name: string;
  score: number;
  stage: number;
  jet: string;
  created_at: number;
  status: ScoreStatus;
}

// Best score per player: SQLite returns the bare columns of the MAX() row.
const BEST = `SELECT player_id, name, MAX(score) AS score, stage, jet, created_at, status
  FROM scores WHERE mode = ?1 AND created_at >= ?2 AND status != 'rejected' GROUP BY player_id`;

export class D1ScoreStore implements ScoreStore {
  constructor(private readonly db: D1Database) {}

  async insert(r: ScoreRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO scores (player_id, name, score, mode, stage, jet, difficulty, seed, version, replay, ip_hash, created_at, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .bind(
        r.playerId,
        r.name,
        r.score,
        r.mode,
        r.stage,
        r.jet,
        r.difficulty,
        r.seed,
        r.version,
        r.replay ?? null,
        r.ipHash,
        r.createdAt,
        r.status ?? 'unverifiable',
      )
      .run();
  }

  async top(mode: LbMode, since: number, limit: number, offset = 0): Promise<ScoreEntry[]> {
    const res = await this.db
      .prepare(`${BEST} ORDER BY score DESC, created_at ASC LIMIT ?3 OFFSET ?4`)
      .bind(mode, since, limit, offset)
      .all<Row>();
    return (res.results ?? []).map((r, i) => ({
      rank: offset + i + 1,
      name: r.name,
      score: r.score,
      stage: r.stage,
      jet: r.jet,
      createdAt: r.created_at,
      status: r.status,
    }));
  }

  async pending(limit: number): Promise<(ScoreRow & { id: number })[]> {
    const res = await this.db
      .prepare(
        `SELECT id, player_id, name, score, mode, stage, jet, difficulty, seed, version, replay, ip_hash, created_at, status
         FROM scores WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?1`,
      )
      .bind(limit)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map((r) => ({
      id: Number(r.id),
      playerId: String(r.player_id),
      name: String(r.name),
      score: Number(r.score),
      mode: r.mode as LbMode,
      stage: Number(r.stage),
      jet: String(r.jet),
      difficulty: String(r.difficulty),
      seed: Number(r.seed),
      version: String(r.version),
      replay: r.replay === null ? undefined : String(r.replay),
      ipHash: String(r.ip_hash),
      createdAt: Number(r.created_at),
      status: r.status as ScoreStatus,
    }));
  }

  async setStatus(id: number, status: ScoreStatus): Promise<void> {
    await this.db.prepare('UPDATE scores SET status = ?1 WHERE id = ?2').bind(status, id).run();
  }

  async bestOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    const row = await this.db
      .prepare(
        'SELECT MAX(score) AS best FROM scores WHERE mode = ?1 AND created_at >= ?2 AND player_id = ?3',
      )
      .bind(mode, since, playerId)
      .first<{ best: number | null }>();
    return row?.best ?? 0;
  }

  async rankOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    const best = await this.bestOf(mode, since, playerId);
    if (!best) return 0;
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM (${BEST}) WHERE score > ?3`)
      .bind(mode, since, best)
      .first<{ n: number }>();
    return (row?.n ?? 0) + 1;
  }

  async countRecent(playerId: string, ipHash: string, since: number): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM scores WHERE created_at >= ?1 AND (player_id = ?2 OR ip_hash = ?3)')
      .bind(since, playerId, ipHash)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

export class D1EventSink implements EventSink {
  constructor(private readonly db: D1Database) {}

  async record(day: string, type: string, stage: number, value: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO events (day, type, stage, count, total) VALUES (?1, ?2, ?3, 1, ?4)
         ON CONFLICT(day, type, stage) DO UPDATE SET count = count + 1, total = total + ?4`,
      )
      .bind(day, type, stage, value)
      .run();
  }
}
