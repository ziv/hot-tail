import './style.css';
import { App } from '@/game/app';
import type { QualityLevel } from '@/render/quality';
import { damagePlayer } from '@/sim/player';
import { Telemetry } from '@/net/telemetry';

/** Boot: feature detection (K1), error capture (J7 stub), then the app. */
const params = new URLSearchParams(location.search);
const errors: string[] = [];

const telemetry = new Telemetry();
window.addEventListener('error', (e) => {
  errors.push(String(e.message));
  telemetry.report(
    String(e.message),
    e.error instanceof Error ? (e.error.stack ?? '') : `${e.filename}:${e.lineno}`,
  );
});
window.addEventListener('unhandledrejection', (e) => {
  errors.push(String(e.reason));
  telemetry.report(
    `Unhandled rejection: ${String(e.reason)}`,
    e.reason instanceof Error ? (e.reason.stack ?? '') : '',
  );
});

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

/** Cross-engine determinism probe (lazy: only loaded by tests). Headless, so it works without WebGL. */
const probe = async () => (await import('@/sim/probe')).determinismProbe();

async function main(): Promise<void> {
  Object.assign(window, { __hotTail: { errors, probe } });
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
  // Error reports follow the same opt-out as anonymous stats.
  telemetry.enabled = app.save.settings.analytics;
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
      probe,
    },
  });

  // Test/capture helpers (?debug, or ?hooks without the panel): drive flows without playing them out.
  if (params.has('debug') || params.has('hooks')) {
    Object.assign((window as unknown as { __hotTail: object }).__hotTail, {
      debug: {
        damagePlayer: (n: number) => {
          app.sim.player.invuln = 0;
          damagePlayer(app.sim, n);
        },
        startGame: (mode: 'arcade' | 'scoreAttack' | 'practice', stage: number) => app.startGame(mode, stage),
        /** Headless CI renders at a few fps: let the sim catch up and run fast. */
        turbo: () => {
          app.loop.maxSteps = 120;
          app.loop.timeScale = 4;
        },
        clearStage: () => {
          app.sim.cheats.invincible = true;
          const d = app.sim.director;
          if (!d) return;
          d.jumpTo(
            app.sim,
            d.bossStage
              ? Math.max(0, ...d.stage.events.filter((e) => e.type === 'boss').map((e) => e.t))
              : d.duration + 0.5,
          );
        },
        destroyBoss: () => {
          const tick = setInterval(() => {
            const part = app.sim.bossParts.items.find((p) => p.alive);
            if (part) app.sim.kill(part);
            else clearInterval(tick);
          }, 250);
        },
      },
    });
  }

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
  // Only an update (a previous worker was in control) should reload the page —
  // not the very first install claiming this client.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
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
