import type { QualityLevel } from '@/render/quality';
import type { Difficulty, JetId } from '@/sim/defs';
import type { Action } from '@/input/input';
import type { HudPalette } from '@/ui/hud';
import type { VisualStyle } from '@/render/view';

/**
 * Save system (J1): one versioned JSON document in localStorage with an
 * explicit migration chain, so old saves are upgraded rather than dropped.
 * Also holds the anonymous player identity (J2).
 */
export type GameMode = 'arcade' | 'scoreAttack' | 'practice';

export interface Settings {
  quality: QualityLevel | 'auto';
  style: VisualStyle;
  master: number;
  music: number;
  sfx: number;
  voice: boolean;
  invertY: boolean;
  mouseSensitivity: number;
  lockToggle: boolean;
  boostToggle: boolean;
  aimAssist: boolean;
  autoFire: boolean;
  difficulty: Difficulty;
  shake: boolean;
  flashes: boolean;
  subtitles: boolean;
  palette: HudPalette;
  hudScale: number;
  analytics: boolean;
  bindings: Partial<Record<Action, string[]>>;
  seenTips: boolean;
}

export interface SaveData {
  version: 2;
  settings: Settings;
  profile: { playerId: string; name: string };
  progress: {
    /** Highest 0-based stage index reached in any mode (unlocks practice). */
    furthestStage: number;
    bests: Record<GameMode, number>;
    jet: JetId;
  };
  /** Base64 input log of the best stage-1 run, replayed in attract mode (G2). */
  attract: { seed: number; jet: JetId; difficulty: Difficulty; data: string; score: number } | null;
  /** Benchmark result (B15); null until measured. */
  benchmark: { quality: QualityLevel; p90: number } | null;
}

export const SAVE_KEY = 'hot-tail.save';
const LEGACY_SETTINGS_KEY = 'hot-tail.settings';
const LEGACY_HISCORE_KEY = 'hot-tail.hiscore';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    style: 'modern',
    master: 0.8,
    music: 0.55,
    sfx: 0.8,
    voice: false,
    invertY: false,
    mouseSensitivity: 1,
    lockToggle: false,
    boostToggle: false,
    aimAssist: false,
    autoFire: false,
    difficulty: 'normal',
    shake: true,
    flashes: true,
    subtitles: true,
    palette: 'default',
    hudScale: 1,
    analytics: true,
    bindings: {},
    seenTips: false,
  };
}

export function newPlayerId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function defaultSave(): SaveData {
  return {
    version: 2,
    settings: defaultSettings(),
    profile: { playerId: newPlayerId(), name: 'PILOT' },
    progress: { furthestStage: 0, bests: { arcade: 0, scoreAttack: 0, practice: 0 }, jet: 'kestrel' },
    attract: null,
    benchmark: null,
  };
}

type AnySave = { version?: number } & Record<string, unknown>;

/** Ordered migrations: index n upgrades a version-n document to n+1. */
const MIGRATIONS: Record<number, (old: AnySave) => AnySave> = {
  // v1 (M2): flat settings object, separate hi-score key.
  1: (old) => {
    const base = defaultSave();
    const s = { ...base.settings };
    for (const k of [
      'quality',
      'master',
      'music',
      'sfx',
      'invertY',
      'shake',
      'flashes',
      'seenTips',
    ] as const) {
      if (k in old) (s as Record<string, unknown>)[k] = old[k];
    }
    const hi = Number(old.__hiscore ?? 0) || 0;
    return {
      ...base,
      settings: s,
      progress: { ...base.progress, bests: { ...base.progress.bests, arcade: hi } },
    };
  },
};

export function migrate(doc: AnySave): SaveData {
  let cur = doc;
  let v = cur.version ?? 1;
  while (v < 2) {
    const step = MIGRATIONS[v];
    if (!step) break;
    cur = step(cur);
    v = cur.version ?? v + 1;
  }
  // Fill any fields added since (forward-compatible defaults).
  const base = defaultSave();
  const out = cur as unknown as SaveData;
  return {
    ...base,
    ...out,
    version: 2,
    settings: { ...base.settings, ...out.settings },
    profile: { ...base.profile, ...out.profile },
    progress: {
      ...base.progress,
      ...out.progress,
      bests: { ...base.progress.bests, ...out.progress?.bests },
    },
  };
}

export function loadSave(store: KeyValueStore | null = safeStorage()): SaveData {
  if (!store) return defaultSave();
  try {
    const raw = store.getItem(SAVE_KEY);
    if (raw) return migrate(JSON.parse(raw) as AnySave);
    const legacy = store.getItem(LEGACY_SETTINGS_KEY);
    if (legacy) {
      const doc = JSON.parse(legacy) as AnySave;
      doc.__hiscore = store.getItem(LEGACY_HISCORE_KEY) ?? 0;
      const migrated = migrate(doc);
      store.setItem(SAVE_KEY, JSON.stringify(migrated));
      store.removeItem(LEGACY_SETTINGS_KEY);
      store.removeItem(LEGACY_HISCORE_KEY);
      return migrated;
    }
  } catch {
    // Corrupt save: start fresh rather than crash.
  }
  return defaultSave();
}

export function writeSave(data: SaveData, store: KeyValueStore | null = safeStorage()): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable (private mode): progress just won't persist.
  }
}

function safeStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// Replay (de)serialisation for attract mode and leaderboard submissions.
export function encodeFrames(frames: Int8Array): string {
  let s = '';
  const bytes = new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeFrames(data: string): Int8Array {
  const s = atob(data);
  const out = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) << 24) >> 24;
  return out;
}
