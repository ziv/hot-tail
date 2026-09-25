import s1 from '../data/stages/stage1.json';
import s2 from '../data/stages/stage2.json';
import s3 from '../data/stages/stage3.json';
import s4 from '../data/stages/stage4.json';
import s5 from '../data/stages/stage5.json';
import s6 from '../data/stages/stage6.json';
import s7 from '../data/stages/stage7.json';
import s8 from '../data/stages/stage8.json';
import s9 from '../data/stages/stage9.json';
import s10 from '../data/stages/stage10.json';
import s11 from '../data/stages/stage11.json';
import s12 from '../data/stages/stage12.json';
import s13 from '../data/stages/stage13.json';
import s14 from '../data/stages/stage14.json';
import s15 from '../data/stages/stage15.json';
import s16 from '../data/stages/stage16.json';
import s17 from '../data/stages/stage17.json';
import s18 from '../data/stages/stage18.json';
import type { StageDef } from './defs';

/** Arcade campaign order (18 stages). Timelines are data (F1); edits hot-reload in dev (A8). */
export const STAGES: StageDef[] = [
  s1,
  s2,
  s3,
  s4,
  s5,
  s6,
  s7,
  s8,
  s9,
  s10,
  s11,
  s12,
  s13,
  s14,
  s15,
  s16,
  s17,
  s18,
] as StageDef[];

/** Practice-only stages built ahead of their campaign slot (none left in the beta). */
export const EXTRA_STAGES: StageDef[] = [];

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
    '../data/stages/stage7.json',
    '../data/stages/stage8.json',
    '../data/stages/stage9.json',
    '../data/stages/stage10.json',
    '../data/stages/stage11.json',
    '../data/stages/stage12.json',
    '../data/stages/stage13.json',
    '../data/stages/stage14.json',
    '../data/stages/stage15.json',
    '../data/stages/stage16.json',
    '../data/stages/stage17.json',
    '../data/stages/stage18.json',
  ];
  import.meta.hot.accept(files, (mods) => {
    mods.forEach((mod, i) => {
      if (!mod) return;
      STAGES[i] = mod.default as StageDef;
      for (const fn of listeners) fn(i);
    });
  });
}
