// R6: package the game for itch.io as an HTML5 zip.
// itch serves games from its own CDN origin inside an iframe, so the build
// points the leaderboard at the Vercel API explicitly:
//
//   node scripts/package-itch.mjs      (API: https://hot-tail.vercel.app)
//
// Override with ITCH_API_BASE=… (ITCH_API_BASE= for local-only scores). The
// Vercel project needs ALLOWED_ORIGIN=https://html-classic.itch.zone
// (comma-separate if you already set one).
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const api = process.env.ITCH_API_BASE ?? 'https://hot-tail.vercel.app';
const env = { ...process.env, VITE_API_BASE: api };
if (!api) {
  console.warn('ITCH_API_BASE is empty — the itch build will use local-only leaderboards.');
  delete env.VITE_API_BASE;
}

execSync('pnpm build', { stdio: 'inherit', env });
mkdirSync('release', { recursive: true });
const out = `release/hot-tail-itch.zip`;
rmSync(out, { force: true });
// Precompressed copies, the landing page and its media are not needed on itch.
execSync(`cd dist && zip -qr ../${out} . -x '*.br' '*.gz' 'about.html' 'media/*' 'assets/about-*'`, {
  stdio: 'inherit',
});
console.log(
  `wrote ${out} — upload as "HTML: this file will be played in the browser", viewport 1280×720, enable fullscreen button + mobile friendly.`,
);
