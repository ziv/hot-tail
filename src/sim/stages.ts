import s1 from '@/data/stages/stage1.json';
import s2 from '@/data/stages/stage2.json';
import s3 from '@/data/stages/stage3.json';
import s4 from '@/data/stages/stage4.json';
import s5 from '@/data/stages/stage5.json';
import s6 from '@/data/stages/stage6.json';
import carrier from '@/data/stages/boss_carrier.json';
import type { StageDef } from './defs';

/** Arcade campaign order. Stage timelines are data (F1); edits hot-reload in dev (A8). */
export const STAGES: StageDef[] = [s1, s2, s3, s4, s5, s6] as StageDef[];

/** Practice-only stages built ahead of their campaign slot (e.g. Boss 2 for stage 12). */
export const EXTRA_STAGES: StageDef[] = [carrier] as StageDef[];

/** Tanker refuel happens after these (0-based) stage indices: after stages 5, 11, 15. */
export const REFUEL_AFTER = new Set([4, 10, 14]);

export function allStages(): StageDef[] {
  return [...STAGES, ...EXTRA_STAGES];
}

const listeners = new Set<(index: number) => void>();

export function onStageReload(fn: (index: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (import.meta.hot) {
  const files = [
    '../data/stages/stage1.json',
    '../data/stages/stage2.json',
    '../data/stages/stage3.json',
    '../data/stages/stage4.json',
    '../data/stages/stage5.json',
    '../data/stages/stage6.json',
  ];
  import.meta.hot.accept(files, (mods) => {
    mods.forEach((mod, i) => {
      if (!mod) return;
      STAGES[i] = mod.default as StageDef;
      for (const fn of listeners) fn(i);
    });
  });
}
