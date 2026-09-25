// Generates the PWA / home-screen icons (I13 placeholder art) as PNGs with no
// dependencies: rasterises the Hot Tail jet silhouette with 4x4 supersampling.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const JET = [
  [32, 4],
  [44, 40],
  [60, 48],
  [44, 50],
  [36, 60],
  [32, 54],
  [28, 60],
  [20, 50],
  [4, 48],
  [20, 40],
];

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size, padding) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = (size * (1 - padding * 2)) / 64;
  const off = size * padding;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if (inside(JET, (x + (sx + 0.5) / 4 - off) / scale, (y + (sy + 0.5) / 4 - off) / scale)) cov++;
      const a = cov / 16;
      // Background: deep navy with a warm radial glow; jet: hot orange → yellow.
      const dx = x / size - 0.5;
      const dy = y / size - 0.55;
      const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2);
      const bg = [10 + glow * 60, 20 + glow * 30, 34 + glow * 10];
      const t = y / size;
      const fg = [255, 106 + t * 90, 42 + t * 20];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(bg[k] * (1 - a) + fg[k] * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.12));
writeFileSync('public/icons/icon-512.png', icon(512, 0.12));
writeFileSync('public/icons/maskable-512.png', icon(512, 0.22));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 0.14));
console.log('icons written to public/icons');
