import type { RpcClient } from './supabase';

/** Ops storage (J7/R3): deduplicated client errors + the public status summary. */
export interface ErrorReport {
  fingerprint: string;
  version: string;
  message: string;
  stack: string;
  userAgent: string;
}

export interface OpsSummary {
  errors24h: number;
  topErrors: { message: string; version: string; count: number; lastSeen: number }[];
  scores24h: number;
  verified24h: number;
  rejected24h: number;
  pending: number;
  loadP50Ms: number | null;
  loadP95Ms: number | null;
  week: Record<string, number>;
}

export interface OpsStore {
  recordError(e: ErrorReport, now: number): Promise<void>;
  summary(now: number): Promise<OpsSummary>;
}

export class SupabaseOpsStore implements OpsStore {
  constructor(private readonly db: RpcClient) {}

  async recordError(e: ErrorReport, now: number): Promise<void> {
    const { error } = await this.db.rpc('err_record', {
      p_fingerprint: e.fingerprint,
      p_version: e.version,
      p_message: e.message,
      p_stack: e.stack,
      p_user_agent: e.userAgent,
      p_now: now,
    });
    if (error) throw new Error(`err_record: ${error.message}`);
  }

  async summary(now: number): Promise<OpsSummary> {
    const { data, error } = await this.db.rpc('ops_summary', { p_now: now });
    if (error) throw new Error(`ops_summary: ${error.message}`);
    const s = (typeof data === 'string' ? JSON.parse(data) : data) as OpsSummary;
    return {
      ...s,
      errors24h: Number(s.errors24h),
      scores24h: Number(s.scores24h),
      verified24h: Number(s.verified24h),
      rejected24h: Number(s.rejected24h),
      pending: Number(s.pending),
      week: Object.fromEntries(Object.entries(s.week ?? {}).map(([k, v]) => [k, Number(v)])),
    };
  }
}

/** In-memory ops store for the local dev API and tests. */
export class MemoryOpsStore implements OpsStore {
  readonly errors = new Map<string, ErrorReport & { count: number; firstSeen: number; lastSeen: number }>();

  async recordError(e: ErrorReport, now: number): Promise<void> {
    const key = `${e.fingerprint}|${e.version}`;
    const cur = this.errors.get(key);
    if (cur) {
      cur.count++;
      cur.lastSeen = now;
    } else this.errors.set(key, { ...e, count: 1, firstSeen: now, lastSeen: now });
  }

  async summary(now: number): Promise<OpsSummary> {
    const all = [...this.errors.values()];
    return {
      errors24h: all.filter((e) => e.lastSeen >= now - 86400000).reduce((n, e) => n + e.count, 0),
      topErrors: all
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 8)
        .map((e) => ({
          message: e.message.slice(0, 140),
          version: e.version,
          count: e.count,
          lastSeen: e.lastSeen,
        })),
      scores24h: 0,
      verified24h: 0,
      rejected24h: 0,
      pending: 0,
      loadP50Ms: null,
      loadP95Ms: null,
      week: {},
    };
  }
}
