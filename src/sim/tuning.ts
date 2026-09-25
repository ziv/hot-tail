import defaults from '@/data/tuning.json';

/**
 * All flight/weapon feel curves live in data (C8) so they can be tuned live
 * from the debug panel and hot-reloaded from tuning.json during development.
 */
export type Tuning = typeof defaults;

export const tuning: Tuning = structuredClone(defaults);

export function resetTuning(src: Tuning = defaults): void {
  const fresh = structuredClone(src);
  for (const key of Object.keys(fresh) as (keyof Tuning)[]) {
    Object.assign(tuning[key], fresh[key]);
  }
}

if (import.meta.hot) {
  import.meta.hot.accept('../data/tuning.json', (mod) => {
    if (mod) resetTuning(mod.default as Tuning);
  });
}
