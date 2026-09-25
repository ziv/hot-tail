// K5: pre-compress build output (.br + .gz) for static hosts/CDNs that serve
// precompressed files (Cloudflare Pages, Netlify, nginx gzip_static/brotli_static).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const exts = /\.(js|css|html|json|webmanifest|svg|map)$/;
let raw = 0;
let br = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (exts.test(name) && !name.endsWith('.map')) {
      const data = readFileSync(p);
      const b = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
      writeFileSync(`${p}.br`, b);
      writeFileSync(`${p}.gz`, gzipSync(data, { level: 9 }));
      raw += data.length;
      br += b.length;
    }
  }
}
walk('dist');
console.log(`compressed ${(raw / 1024).toFixed(0)} KB → ${(br / 1024).toFixed(0)} KB brotli`);
