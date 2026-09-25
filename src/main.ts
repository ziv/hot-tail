import './style.css';
import { App } from '@/game/app';
import { defaultQuality, type QualityLevel } from '@/render/quality';

/** Boot: feature detection (K1), error capture (J7 stub), then the app. */
const params = new URLSearchParams(location.search);
const errors: string[] = [];

window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function fail(message: string): void {
  const ui = document.getElementById('ui')!;
  ui.innerHTML = `<section class="screen in"><h1 class="logo"><span class="logo-hot">HOT</span><span class="logo-tail">TAIL</span></h1><p class="screen-sub">${message}</p></section>`;
}

async function main(): Promise<void> {
  if (!supportsWebGL2()) {
    fail(
      'Your browser or device does not support WebGL 2, which Hot Tail needs. Try a recent Chrome, Edge, Firefox or Safari.',
    );
    return;
  }
  const quality = (params.get('quality') as QualityLevel | null) ?? defaultQuality();
  const app = new App(
    {
      canvas: document.getElementById('game') as HTMLCanvasElement,
      hud: document.getElementById('hud') as HTMLCanvasElement,
      ui: document.getElementById('ui')!,
      touch: document.getElementById('touch')!,
    },
    { autotest: params.has('autotest'), debug: params.has('debug'), quality },
  );
  // Test/automation hook (Playwright smoke + perf fly-through).
  Object.assign(window, {
    __hotTail: {
      app,
      errors,
      get state() {
        return app.state;
      },
      get simTime() {
        return app.sim?.time ?? 0;
      },
      get score() {
        return app.sim?.score.score ?? 0;
      },
    },
  });

  let debug: { toggle(): void } | null = null;
  const openDebug = async () => {
    if (debug) return debug.toggle();
    const mod = await import('@/ui/debug');
    debug = mod.createDebug(app);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') void openDebug();
  });

  await app.boot();
  if (params.has('debug')) void openDebug();
}

void main();
