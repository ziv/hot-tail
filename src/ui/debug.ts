import GUI from 'lil-gui';
import { tuning, resetTuning } from '@/sim/tuning';
import { STAGES } from '@/sim/stages';
import { PRESETS } from '@/render/environment';
import type { App } from '@/game/app';

/**
 * Debug overlay (A6) with live tuning of every data curve (C8) and the stage
 * timeline scrubber (F2). Loaded lazily with `?debug` or the ` key.
 */
export function createDebug(app: App): { toggle(): void } {
  const gui = new GUI({ title: 'Hot Tail debug', width: 300 });
  gui.domElement.style.zIndex = '50';

  const stats = { fps: '', frame: '', calls: 0, tris: '', entities: '', particles: '', state: '' };
  const sf = gui.addFolder('Stats');
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) sf.add(stats, k).listen().disable();

  const cheats = gui.addFolder('Cheats');
  cheats
    .add(
      {
        get v() {
          return app.sim.cheats.invincible;
        },
        set v(b: boolean) {
          app.sim.cheats.invincible = b;
        },
      },
      'v',
    )
    .name('invincible');
  cheats
    .add(
      {
        get v() {
          return app.sim.cheats.infiniteMissiles;
        },
        set v(b: boolean) {
          app.sim.cheats.infiniteMissiles = b;
        },
      },
      'v',
    )
    .name('infinite missiles');
  cheats.add(app.loop, 'timeScale', 0.1, 2, 0.05).name('time scale');

  const stage = gui.addFolder('Stage / timeline');
  const st = {
    stage: 0,
    time: 0,
    start() {
      app.startGame('practice', st.stage);
    },
    jump() {
      const d = app.sim.director;
      if (d) d.jumpTo(app.sim, st.time);
    },
    lighting: 'day' as keyof typeof PRESETS,
  };
  stage.add(st, 'stage', Object.fromEntries(STAGES.map((s, i) => [`${s.index} ${s.name}`, i])));
  stage.add(st, 'start').name('start stage');
  stage.add(st, 'time', 0, 90, 0.5).name('scrub to (s)');
  stage.add(st, 'jump').name('jump to time');
  stage
    .add(st, 'lighting', Object.keys(PRESETS))
    .onChange((v: keyof typeof PRESETS) => app.view.setLighting(v));
  stage
    .add({ q: app.view.qualityLevel }, 'q', ['low', 'medium', 'high'])
    .name('quality')
    .onChange((q: 'low' | 'medium' | 'high') => app.view.applyQuality(q));

  const tf = gui.addFolder('Tuning');
  for (const [group, values] of Object.entries(tuning)) {
    const f = tf.addFolder(group);
    for (const key of Object.keys(values)) f.add(values as Record<string, number>, key).listen();
    f.close();
  }
  tf.add({ reset: () => resetTuning() }, 'reset').name('reset to tuning.json');
  tf.close();

  let visible = true;
  let last = performance.now();
  let frameMs = 16;
  const update = () => {
    const now = performance.now();
    frameMs += (now - last - frameMs) * 0.1;
    last = now;
    if (visible) {
      const s = app.view.stats();
      stats.fps = app.fps.toFixed(0);
      stats.frame = `${frameMs.toFixed(1)} ms`;
      stats.calls = s.calls;
      stats.tris = `${(s.triangles / 1000).toFixed(1)}k`;
      const counts: Record<string, number> = {};
      for (const e of app.sim.world.entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      stats.entities = Object.entries(counts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      stats.state = `${app.state} t=${app.sim.director?.time.toFixed(1) ?? '-'}`;
      stats.particles = '';
    }
    requestAnimationFrame(update);
  };
  requestAnimationFrame(update);

  return {
    toggle() {
      visible = !visible;
      gui.show(visible);
    },
  };
}
