import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrames, loadSave, SAVE_KEY, writeSave, type KeyValueStore } from '@/game/save';

class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('save system (J1)', () => {
  it('creates a fresh v2 save with an anonymous player id', () => {
    const save = loadSave(new MemoryStore());
    expect(save.version).toBe(3);
    expect(save.profile.playerId).toMatch(/^[0-9a-f]{24}$/);
    expect(save.settings.difficulty).toBe('normal');
  });

  it('migrates the M2 v1 settings + hi-score keys', () => {
    const store = new MemoryStore();
    store.setItem(
      'hot-tail.settings',
      JSON.stringify({ version: 1, quality: 'low', master: 0.3, invertY: true, seenTips: true }),
    );
    store.setItem('hot-tail.hiscore', '123456');
    const save = loadSave(store);
    expect(save.version).toBe(3);
    expect(save.settings.quality).toBe('low');
    expect(save.settings.master).toBe(0.3);
    expect(save.settings.invertY).toBe(true);
    expect(save.progress.bests.arcade).toBe(123456);
    // Legacy keys are replaced by the unified document.
    expect(store.getItem('hot-tail.settings')).toBeNull();
    expect(JSON.parse(store.getItem(SAVE_KEY)!).version).toBe(3);
  });

  it('fills fields added later and survives corrupt data', () => {
    const store = new MemoryStore();
    store.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 2,
        attract: { data: 'old' },
        settings: { music: 0.1 },
        progress: { furthestStage: 3 },
      }),
    );
    const save = loadSave(store);
    expect(save.settings.music).toBe(0.1);
    expect(save.settings.palette).toBe('default');
    expect(save.progress.furthestStage).toBe(3);
    expect(save.progress.bests.scoreAttack).toBe(0);
    expect(save.attract).toBeNull(); // v2 raw-frame demos are dropped by the v3 migration
    store.setItem(SAVE_KEY, '{nope');
    expect(loadSave(store).version).toBe(3);
  });

  it('round-trips through write/load and replay encoding', () => {
    const store = new MemoryStore();
    const save = loadSave(store);
    save.profile.name = 'MAVERICK';
    writeSave(save, store);
    expect(loadSave(store).profile.name).toBe('MAVERICK');
    const frames = Int8Array.from([0, 127, -127, 5, -1, 64]);
    expect(Array.from(decodeFrames(encodeFrames(frames)))).toEqual(Array.from(frames));
  });
});
