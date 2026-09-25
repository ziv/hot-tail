import type { QualityLevel } from '@/render/quality';

/**
 * Player settings persisted in localStorage under a versioned key. The full
 * save system with migrations is J1 (M3); this keeps the slice's options.
 */
export interface Settings {
  version: 1;
  quality: QualityLevel;
  master: number;
  music: number;
  sfx: number;
  invertY: boolean;
  shake: boolean;
  flashes: boolean;
  seenTips: boolean;
}

const KEY = 'hot-tail.settings';

export function defaultSettings(quality: QualityLevel): Settings {
  return {
    version: 1,
    quality,
    master: 0.8,
    music: 0.55,
    sfx: 0.8,
    invertY: false,
    shake: true,
    flashes: true,
    seenTips: false,
  };
}

export function loadSettings(quality: QualityLevel): Settings {
  const d = defaultSettings(quality);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (parsed.version !== 1) return d;
    return { ...d, ...parsed };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode): settings just don't persist.
  }
}

export function loadHighScore(): number {
  try {
    return Number(localStorage.getItem('hot-tail.hiscore') ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): void {
  try {
    localStorage.setItem('hot-tail.hiscore', String(score));
  } catch {
    // ignore
  }
}
