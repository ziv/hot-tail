// R5: renders the launch trailer (≈60 s, 1280×720, 30 fps) straight from the
// game — deterministic frame stepping, HUD + title cards composited in-page,
// soundtrack rendered offline — and encodes it with ffmpeg.
// Needs the dev server (`pnpm dev`): node scripts/trailer.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const FPS = 30;
const W = 1280;
const H = 720;
const TMP = 'node_modules/.cache/trailer';
mkdirSync(TMP, { recursive: true });
mkdirSync('public/media', { recursive: true });

// Scene list: what to show, for how long, with which caption.
const SCENES = [
  { kind: 'cutscene', id: 'takeoff', secs: 6, from: 1.2, caption: null, logo: [3.2, 6] },
  { stage: 0, t: 10, secs: 8, caption: 'LOCK ON. LET FLY.' },
  { stage: 3, t: 25, secs: 5, caption: '18 STAGES' },
  { stage: 6, t: 18, secs: 5, caption: '5 WORLDS' },
  { stage: 9, t: 12, secs: 5, caption: 'DAY TO NIGHT' },
  { stage: 16, t: 8, secs: 5, caption: 'TO THE EDGE OF SPACE' },
  { stage: 5, t: 41, settle: 4, secs: 7, caption: '4 GIANT BOSSES', music: 'boss' },
  { stage: 17, t: 30, settle: 6, secs: 6, caption: null },
  { stage: 1, t: 20, secs: 5, caption: 'MODERN 3D — OR RETRO SPRITES', style: 'retro' },
  { kind: 'cutscene', id: 'landing', secs: 5, from: 4.2, caption: null, music: 'ending' },
  { kind: 'card', secs: 5, caption: 'PLAY FREE IN YOUR BROWSER · NO ADS · NO DOWNLOAD' },
];
const total = SCENES.reduce((s, x) => s + x.secs, 0);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${BASE}/?autotest&quality=high&hooks`);
await page.waitForFunction(() => window.__hotTail?.state === 'playing', null, { timeout: 90_000 });

// In-page compositor: game canvas + HUD canvas + title cards → JPEG.
await page.evaluate(
  ({ W, H }) => {
    const a = window.__hotTail.app;
    a.loop.stop();
    document.getElementById('ui').style.display = 'none';
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const c = out.getContext('2d');
    const logo = (x, y, size, alpha) => {
      c.save();
      c.globalAlpha = alpha;
      c.font = `italic 900 ${size}px system-ui, sans-serif`;
      c.textBaseline = 'alphabetic';
      const hot = c.measureText('HOT').width;
      const g = c.createLinearGradient(0, y - size * 0.8, 0, y);
      g.addColorStop(0, '#ffe08a');
      g.addColorStop(0.4, '#ffb020');
      g.addColorStop(0.75, '#ff6a2a');
      g.addColorStop(1, '#d8261a');
      c.shadowColor = 'rgba(0,0,0,.5)';
      c.shadowBlur = 30;
      c.fillStyle = g;
      c.fillText('HOT', x, y);
      c.fillStyle = '#fff';
      c.fillText('TAIL', x + hot + size * 0.12, y);
      c.restore();
    };
    window.__trailer = {
      frame(opts) {
        const { fade, caption, capAlpha, logoAlpha, card } = opts;
        c.globalAlpha = 1;
        if (card) {
          c.fillStyle = '#0a1422';
          c.fillRect(0, 0, W, H);
        } else {
          c.drawImage(document.getElementById('game'), 0, 0, W, H);
          if (a.hud.visible) c.drawImage(document.getElementById('hud'), 0, 0, W, H);
        }
        if (logoAlpha > 0) {
          const size = card ? 150 : 120;
          c.font = `italic 900 ${size}px system-ui, sans-serif`;
          const wdt = c.measureText('HOT TAIL').width + size * 0.12;
          logo((W - wdt) / 2, card ? H * 0.5 : H * 0.45, size, logoAlpha);
        }
        if (caption && capAlpha > 0) {
          c.save();
          c.globalAlpha = capAlpha;
          c.font = `800 ${card ? 26 : 34}px system-ui, sans-serif`;
          c.letterSpacing = '6px';
          c.fillStyle = '#7fe9ff';
          c.shadowColor = 'rgba(0,0,0,.7)';
          c.shadowBlur = 16;
          c.textAlign = card ? 'center' : 'left';
          c.fillText(caption, card ? W / 2 : 64, card ? H * 0.62 : H - 64);
          c.restore();
        }
        if (fade > 0) {
          c.fillStyle = `rgba(0,0,0,${fade})`;
          c.fillRect(0, 0, W, H);
        }
        return out.toDataURL('image/jpeg', 0.92).split(',')[1];
      },
    };
  },
  { W, H },
);

// Video encoder fed with JPEG frames over stdin.
const video = `${TMP}/video.mp4`;
const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(FPS),
    '-c:v',
    'mjpeg',
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    video,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

let frames = 0;
for (const sc of SCENES) {
  // Set up the scene and let it settle (simulation only, no rendering).
  await page.evaluate(async (sc) => {
    const h = window.__hotTail;
    const a = h.app;
    if (sc.kind === 'cutscene') {
      a.view.playCutscene(sc.id, 'player', sc.id === 'takeoff' ? 'day' : 'sunset');
      a.hud.visible = false;
      for (let i = 0; i < sc.from * 30; i++) a.render(1, 1 / 30);
    } else if (sc.kind !== 'card') {
      a.view.stopCutscene();
      await a.view.setStyle(sc.style ?? 'modern');
      h.debug.startGame('practice', sc.stage);
      a.sim.cheats.invincible = true;
      if (sc.t) a.sim.director.jumpTo(a.sim, sc.t);
      a.hud.visible = true;
      for (let i = 0; i < (sc.settle ?? 1.5) * 60; i++) a.tick();
      for (let i = 0; i < 6; i++) a.render(1, 1 / 30); // warm terrain/particles
      document.querySelectorAll('.toast').forEach((e) => e.remove());
    }
  }, sc);
  const n = sc.secs * FPS;
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    const edge = Math.min(i, n - 1 - i);
    const fade = edge < 5 ? 1 - edge / 5 : 0;
    const capAlpha = sc.caption
      ? Math.min(1, Math.max(0, (t - 0.4) / 0.4), Math.max(0, (sc.secs - 0.4 - t) / 0.4))
      : 0;
    const logoAlpha = sc.logo
      ? Math.min(1, Math.max(0, (t - sc.logo[0]) / 0.5))
      : sc.kind === 'card'
        ? Math.min(1, t / 0.6)
        : 0;
    const jpeg = await page.evaluate(
      ({ sc, fade, capAlpha, logoAlpha }) => {
        const a = window.__hotTail.app;
        if (sc.kind !== 'card') {
          if (sc.kind !== 'cutscene') {
            a.tick();
            a.tick();
          }
          a.render(1, 1 / 30);
        }
        return window.__trailer.frame({
          fade,
          caption: sc.caption,
          capAlpha,
          logoAlpha,
          card: sc.kind === 'card',
        });
      },
      { sc, fade, capAlpha, logoAlpha },
    );
    if (!ff.stdin.write(Buffer.from(jpeg, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    frames++;
  }
  console.log(`scene ${SCENES.indexOf(sc) + 1}/${SCENES.length} done (${frames} frames)`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));

// Soundtrack: the game's own sequencer rendered offline, with cues per scene.
const cues = [];
let at = 0;
for (const sc of SCENES) {
  if (sc.music) cues.push({ at, track: sc.music });
  at += sc.secs;
}
const wav = await page.evaluate(
  async ({ total, cues }) => {
    const { Playback, SONGS } = await import('/src/audio/music.ts');
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    const music = ctx.createGain();
    music.gain.value = 0.8;
    music.connect(comp);
    const noise = ctx.createBuffer(1, sr * 2, sr);
    const d = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    const fake = { ctx, music, noise, ready: true };
    const segments = [{ at: 0, track: 'ocean' }, ...cues];
    segments.forEach((seg, i) => {
      const end = segments[i + 1]?.at ?? total;
      const pb = new Playback(fake, seg.track, SONGS[seg.track]);
      pb.nextTime = Math.max(0.05, seg.at - 0.3);
      const g = pb.gain.gain;
      g.setValueAtTime(0, Math.max(0, seg.at - 0.4));
      g.linearRampToValueAtTime(1, seg.at + 0.2);
      g.setValueAtTime(1, Math.max(seg.at + 0.2, end - 0.6));
      g.linearRampToValueAtTime(
        i === segments.length - 1 ? 0 : 0,
        end + (i === segments.length - 1 ? 0 : 0.2),
      );
      pb.schedule(end + 0.3);
    });
    const buf = await ctx.startRendering();
    // 16-bit PCM WAV
    const len = buf.length;
    const out = new DataView(new ArrayBuffer(44 + len * 4));
    const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF');
    out.setUint32(4, 36 + len * 4, true);
    str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 2, true);
    out.setUint32(24, sr, true);
    out.setUint32(28, sr * 4, true);
    out.setUint16(32, 4, true);
    out.setUint16(34, 16, true);
    str(36, 'data');
    out.setUint32(40, len * 4, true);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < len; i++) {
      out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let s = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  { total, cues },
);
writeFileSync(`${TMP}/music.wav`, Buffer.from(wav, 'base64'));
await browser.close();

await new Promise((resolve, reject) => {
  const mux = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      video,
      '-i',
      `${TMP}/music.wav`,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-af',
      'afade=t=out:st=' + (total - 1.5) + ':d=1.5',
      '-shortest',
      '-movflags',
      '+faststart',
      'public/media/trailer.mp4',
    ],
    { stdio: 'inherit' },
  );
  mux.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
});
spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '9',
    '-i',
    'public/media/trailer.mp4',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    'public/media/trailer-poster.jpg',
  ],
  { stdio: 'inherit' },
);
console.log(`trailer: ${frames} frames, ${total}s → public/media/trailer.mp4`);
