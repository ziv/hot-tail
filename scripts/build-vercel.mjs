// Builds the Vercel deployment with the Build Output API (.vercel/output):
//   static/            the Vite game build (precompressed), API same-origin
//   functions/api.func one bundled Node function serving every /api/* route
//   config.json        routes, cache headers and the daily validation cron
// Works on the free Hobby plan: one cron per day, functions under 60 s.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { SECURITY_HEADERS } from './security-headers.mjs';
import { fillContact } from './contact.mjs';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });

// 1. Game: same-origin API unless VITE_API_BASE is set explicitly.
execSync('pnpm build', {
  stdio: 'inherit',
  env: { ...process.env, VITE_API_BASE: process.env.VITE_API_BASE ?? '' },
});
// Vercel compresses on the fly; skip the .br/.gz copies made for other hosts.
cpSync('dist', `${out}/static`, { recursive: true, filter: (src) => !/\.(br|gz)$/.test(src) });
fillContact(`${out}/static/privacy.html`);

// 2. API function: bundle server + simulation (for replay validation) + supabase-js.
const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  define: { 'import.meta.hot': 'undefined' },
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30 },
    null,
    2,
  ),
);
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));

// 3. Routing, headers, cron.
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(.*)', headers: SECURITY_HEADERS, continue: true },
        {
          src: '/assets/(.*)',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        {
          src: '/(sw\\.js|index\\.html|manifest\\.webmanifest)?',
          headers: { 'cache-control': 'no-cache' },
          continue: true,
        },
        { src: '/api/(.*)', dest: '/api?__path=$1' },
        { handle: 'filesystem' },
      ],
      // Hobby plan: at most daily. Scores are validated inline; this sweeps leftovers.
      crons: [{ path: '/api/cron/validate', schedule: '0 5 * * *' }],
    },
    null,
    2,
  ),
);
console.log('Vercel build output ready in .vercel/output');
