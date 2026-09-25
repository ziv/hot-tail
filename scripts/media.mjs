// I13/R4: renders screenshots, key art and the social (OG) image straight from
// the game. Needs the dev server running (`pnpm dev`); writes public/media/.
//   node scripts/media.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = 'public/media';
mkdirSync(`${OUT}/shots`, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Plays a stage with the autopilot, jumps to `t`, lets it run, then captures. */
async function scene(page, { stage, t, settle = 4, style = 'modern', hud = true, lighting }) {
  await page.evaluate(
    async ({ stage, t, style, hud, lighting }) => {
      const h = window.__hotTail;
      const a = h.app;
      h.debug.turbo();
      a.loop.timeScale = 1;
      await a.view.setStyle(style);
      h.debug.startGame('practice', stage);
      a.sim.cheats.invincible = true;
      if (t) a.sim.director.jumpTo(a.sim, t);
      if (lighting) a.view.setLighting(lighting);
      a.hud.visible = hud;
      document.querySelectorAll('.toast').forEach((e) => e.remove());
    },
    { stage, t, style, hud, lighting },
  );
  await page.waitForTimeout(settle * 1000);
}

async function shoot(page, file) {
  const png = `${OUT}/${file}.png`;
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-q:v', '3', `${OUT}/${file}.jpg`]);
  rmSync(png);
  console.log('wrote', `${OUT}/${file}.jpg`);
}

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${BASE}/?autotest&quality=high&hooks`);
  await page.waitForFunction(() => window.__hotTail?.state === 'playing', null, { timeout: 90_000 });
  return page;
}

/** Logo lockup overlay for key art / OG. */
async function overlay(page, tagline) {
  await page.evaluate((tagline) => {
    const el = document.createElement('div');
    el.id = 'keyart';
    el.style.cssText =
      'position:fixed;left:5%;bottom:9%;z-index:99;font-family:system-ui,sans-serif;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.55)';
    el.innerHTML = `<div style="font:italic 900 min(15vw,150px)/.9 system-ui,sans-serif;letter-spacing:-.02em">
      <span style="background:linear-gradient(180deg,#ffe08a,#ffb020 35%,#ff6a2a 70%,#d8261a);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.12em">HOT</span>TAIL</div>
      <div style="font:700 min(2.2vw,26px) system-ui;letter-spacing:.2em;color:#7fe9ff;margin-top:12px">${tagline}</div>`;
    document.body.append(el);
    document.getElementById('ui').style.display = 'none';
  }, tagline);
}

// Gameplay screenshots (1280×720, HUD on).
const page = await open(1280, 720);
const shots = [
  ['ocean', { stage: 0, t: 12 }],
  ['desert', { stage: 3, t: 27 }],
  ['mountains', { stage: 6, t: 20 }],
  ['city', { stage: 9, t: 13 }],
  ['stratosphere', { stage: 16, t: 9 }],
  ['boss-fortress', { stage: 5, t: 41, settle: 9 }],
  ['boss-halo', { stage: 17, t: 30, settle: 10 }],
  ['retro', { stage: 1, t: 21, style: 'retro' }],
];
for (const [name, opts] of shots) {
  await scene(page, opts);
  await shoot(page, `shots/${name}`);
}
await page.close();

// Key art (1920×1080) and OG image (1200×630): boss at dusk, no HUD.
for (const [file, w, h] of [
  ['keyart', 1920, 1080],
  ['og', 1200, 630],
]) {
  const p = await open(w, h);
  await scene(p, { stage: 5, t: 41, settle: 8, hud: false });
  await overlay(p, 'ARCADE JET COMBAT · FREE IN YOUR BROWSER');
  await shoot(p, file);
  await p.close();
}
await browser.close();
