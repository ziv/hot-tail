// `pnpm dev:api`: bundles and runs the local API (server/dev.ts) on :8787.
// Start `pnpm dev` alongside with VITE_API_BASE= (empty) to use it via Vite's /api proxy.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';

await build({
  entryPoints: ['server/dev.ts'],
  outfile: 'node_modules/.cache/hot-tail-dev-api.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  define: { 'import.meta.hot': 'undefined' },
});
spawn(process.execPath, ['node_modules/.cache/hot-tail-dev-api.mjs'], { stdio: 'inherit' });
