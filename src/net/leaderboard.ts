import {
  aroundMe,
  MemoryScoreStore,
  periodStart,
  submitScore,
  type LbMode,
  type LbPeriod,
  type ScoreEntry,
  type ScoreRow,
  type ScoreSubmission,
  type SubmitResult,
} from '../../shared/leaderboard';

/**
 * Leaderboard client (G10/J3). Talks to the Hot Tail API when VITE_API_BASE is
 * set — an empty string means same-origin (/api on the Vercel deployment) — and
 * falls back to a local board in localStorage when offline or unconfigured.
 */
const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const LOCAL_KEY = 'hot-tail.localScores';

export interface Board {
  entries: ScoreEntry[];
  around: ScoreEntry[];
  online: boolean;
}

export class Leaderboard {
  private readonly local: MemoryScoreStore;
  online = API !== undefined;

  constructor() {
    this.local = new MemoryScoreStore(readLocal());
  }

  get configured(): boolean {
    return API !== undefined;
  }

  async submit(sub: ScoreSubmission): Promise<SubmitResult & { online: boolean }> {
    // Always keep a local copy (without the bulky replay).
    const localRes = await submitScore(this.local, { ...sub, replay: undefined }, 'local', Date.now());
    this.persist();
    if (API !== undefined) {
      try {
        const res = await fetchJson<SubmitResult>(`${API}/api/scores`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sub),
        });
        this.online = true;
        return { ...res, online: true };
      } catch {
        this.online = false;
      }
    }
    const body = localRes.body as SubmitResult;
    return {
      rank: body.rank ?? 0,
      weeklyRank: body.weeklyRank ?? 0,
      best: body.best ?? false,
      status: 'unverifiable',
      online: false,
    };
  }

  async board(mode: LbMode, period: LbPeriod, playerId: string): Promise<Board> {
    if (API !== undefined) {
      try {
        const q = `mode=${mode}&period=${period}`;
        const [top, around] = await Promise.all([
          fetchJson<{ entries: ScoreEntry[] }>(`${API}/api/scores?${q}&limit=20`),
          fetchJson<{ entries: ScoreEntry[] }>(`${API}/api/scores/around?${q}&playerId=${playerId}`),
        ]);
        this.online = true;
        return { entries: top.entries, around: around.entries, online: true };
      } catch {
        this.online = false;
      }
    }
    const since = periodStart(period, Date.now());
    return {
      entries: await this.local.top(mode, since, 20),
      around: await aroundMe(this.local, mode, since, playerId),
      online: false,
    };
  }

  /** Would this score make the local top 20 (for the name-entry prompt)? */
  async qualifies(mode: LbMode, score: number): Promise<boolean> {
    if (score <= 0) return false;
    const top = await this.local.top(mode, 0, 20);
    return top.length < 20 || score > top[top.length - 1].score;
  }

  private persist(): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.local.rows.slice(-500)));
    } catch {
      // ignore quota errors
    }
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function readLocal(): ScoreRow[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as ScoreRow[];
  } catch {
    return [];
  }
}
