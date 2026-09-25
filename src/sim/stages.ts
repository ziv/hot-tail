import s1 from '@/data/stages/stage1.json';
import s2 from '@/data/stages/stage2.json';
import s3 from '@/data/stages/stage3.json';
import type { StageDef } from './defs';

/** Stage timelines are data (F1); edits hot-reload in dev (A8). */
export const STAGES: StageDef[] = [s1, s2, s3] as StageDef[];

const listeners = new Set<(index: number) => void>();

export function onStageReload(fn: (index: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (import.meta.hot) {
  const files = ['../data/stages/stage1.json', '../data/stages/stage2.json', '../data/stages/stage3.json'];
  import.meta.hot.accept(files, (mods) => {
    mods.forEach((mod, i) => {
      if (!mod) return;
      STAGES[i] = mod.default as StageDef;
      for (const fn of listeners) fn(i);
    });
  });
}
