import './style.css';
import { App } from '@/game/app';
import type { QualityLevel } from '@/render/quality';

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
  const quality = params.get('quality') as QualityLevel | null;
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

  if (import.meta.env.PROD && !params.has('autotest')) registerServiceWorker();
  await app.boot();
  if (params.has('debug')) void openDebug();
}

void main();

/** PWA (K3): offline cache plus an in-game prompt when a new version is ready. */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  void navigator.serviceWorker.register(`./sw.js?v=${__APP_VERSION__}`).then((reg) => {
    const prompt = (worker: ServiceWorker) => {
      const el = document.createElement('div');
      el.className = 'toast update-toast';
      el.innerHTML = 'A new version of Hot Tail is ready.';
      const btn = document.createElement('button');
      btn.textContent = 'UPDATE';
      btn.onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
      el.append(btn);
      document.body.append(el);
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
  });
}
