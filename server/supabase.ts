import type { LbMode, ScoreEntry, ScoreRow, ScoreStatus, ScoreStore } from '../shared/leaderboard';
import type { EventSink } from './handler';

/**
 * Supabase (Postgres) storage for the API. Every call goes through the SQL
 * functions in supabase/migrations (callable only with the service-role key),
 * so the tables stay closed to the public anon key.
 */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

type Row = Record<string, unknown>;

export class SupabaseScoreStore implements ScoreStore {
  constructor(private readonly db: RpcClient) {}

  async insert(r: ScoreRow): Promise<void> {
    await call(this.db, 'lb_insert', {
      p_player_id: r.playerId,
      p_name: r.name,
      p_score: r.score,
      p_mode: r.mode,
      p_stage: r.stage,
      p_jet: r.jet,
      p_difficulty: r.difficulty,
      p_seed: r.seed,
      p_version: r.version,
      p_replay: r.replay ?? null,
      p_ip_hash: r.ipHash,
      p_created_at: r.createdAt,
      p_status: r.status ?? 'unverifiable',
    });
  }

  async top(mode: LbMode, since: number, limit: number, offset = 0): Promise<ScoreEntry[]> {
    const rows = await call<Row[]>(this.db, 'lb_top', {
      p_mode: mode,
      p_since: since,
      p_limit: limit,
      p_offset: offset,
    });
    return (rows ?? []).map((r, i) => ({
      rank: offset + i + 1,
      name: String(r.name),
      score: Number(r.score),
      stage: Number(r.stage),
      jet: String(r.jet),
      createdAt: Number(r.created_at),
      status: r.status as ScoreStatus,
    }));
  }

  async rankOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    return Number(await call(this.db, 'lb_rank', { p_mode: mode, p_since: since, p_player_id: playerId }));
  }

  async bestOf(mode: LbMode, since: number, playerId: string): Promise<number> {
    return Number(await call(this.db, 'lb_best', { p_mode: mode, p_since: since, p_player_id: playerId }));
  }

  async countRecent(playerId: string, ipHash: string, since: number): Promise<number> {
    return Number(
      await call(this.db, 'lb_recent', { p_player_id: playerId, p_ip_hash: ipHash, p_since: since }),
    );
  }

  async pending(limit: number): Promise<(ScoreRow & { id: number })[]> {
    const rows = await call<Row[]>(this.db, 'lb_pending', { p_limit: limit });
    return (rows ?? []).map((r) => ({
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
    await call(this.db, 'lb_set_status', { p_id: id, p_status: status });
  }

  async deletePlayer(playerId: string): Promise<number> {
    return Number(await call(this.db, 'lb_delete_player', { p_player_id: playerId }));
  }
}

export class SupabaseEventSink implements EventSink {
  constructor(private readonly db: RpcClient) {}

  async record(day: string, type: string, stage: number, value: number): Promise<void> {
    await call(this.db, 'stats_record', { p_day: day, p_type: type, p_stage: stage, p_value: value });
  }
}
