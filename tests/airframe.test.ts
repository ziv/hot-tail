import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry } from 'three';
import { loft, shell, wing, type Station } from '@/render/airframe';
import { MODEL_FACTORIES } from '@/render/registry';

/** Normal of the vertex nearest to `p` (the geometry's own smooth normal). */
function normalNear(g: BufferGeometry, p: Vector3): Vector3 {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const used = new Set<number>(g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()]);
  let best = -1;
  let bestD = Infinity;
  const v = new Vector3();
  for (const i of used) {
    const d = v.fromBufferAttribute(pos, i).distanceToSquared(p);
    if (d < bestD) [best, bestD] = [i, d];
  }
  return new Vector3().fromBufferAttribute(nrm, best);
}

/** Face normal of the triangle whose centroid is nearest to `p` (tests caps, which are flat). */
function faceNear(g: BufferGeometry, p: Vector3): Vector3 {
  const pos = g.getAttribute('position');
  const idx = g.index!.array;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let best = new Vector3();
  let bestD = Infinity;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]);
    b.fromBufferAttribute(pos, idx[i + 1]);
    c.fromBufferAttribute(pos, idx[i + 2]);
    const cen = a.clone().add(b).add(c).divideScalar(3);
    const d = cen.distanceToSquared(p);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (d < bestD && n.lengthSq() > 1e-12) [best, bestD] = [n.normalize(), d];
  }
  return best;
}

const AIRCRAFT = new Set([
  'player',
  'playerDart',
  'playerManta',
  'fighter',
  'chaser',
  'drone',
  'ace',
  'bomber',
  'gunship',
  'awacs',
  'tanker',
  'stealth',
  'missile',
  'emissile',
]);

const tube: Station[] = [
  { z: -2, w: 1 },
  { z: 2, w: 1 },
];

describe('airframe toolkit', () => {
  it('lofts face outward, with both caps outward, whichever way the stations run', () => {
    for (const st of [tube, [...tube].reverse()]) {
      const g = loft(st);
      expect(normalNear(g, new Vector3(1, 0, 0)).x).toBeGreaterThan(0.9);
      expect(normalNear(g, new Vector3(0, 1, 0)).y).toBeGreaterThan(0.9);
      expect(faceNear(g, new Vector3(0, 0, 2)).z).toBeGreaterThan(0.99);
      expect(faceNear(g, new Vector3(0, 0, -2)).z).toBeLessThan(-0.99);
    }
  });

  it('inside lofts face inward (cavities seen through an opening)', () => {
    for (const st of [tube, [...tube].reverse()]) {
      const g = loft(st, { inside: true });
      expect(normalNear(g, new Vector3(1, 0, 0)).x).toBeLessThan(-0.9);
      expect(faceNear(g, new Vector3(0, 0, 2)).z).toBeLessThan(-0.99);
      expect(faceNear(g, new Vector3(0, 0, -2)).z).toBeGreaterThan(0.99);
    }
  });

  it('wings have a rounded leading edge, and tip caps face outboard', () => {
    const g = wing([
      { x: 0, z: 0, c: 4, t: 0.1 },
      { x: 5, z: 1, c: 2, t: 0.1 },
    ]);
    expect(normalNear(g, new Vector3(2.5, 0.2, 1.8)).y).toBeGreaterThan(0.8); // upper surface
    expect(normalNear(g, new Vector3(2.5, -0.2, 1.8)).y).toBeLessThan(-0.8); // lower surface
    expect(normalNear(g, new Vector3(0, 0, 0)).z).toBeLessThan(-0.7); // leading edge (root section)
    expect(faceNear(g, new Vector3(5, 0, 1.6)).x).toBeGreaterThan(0.99);
  });

  it('shells face away from the body', () => {
    const g = shell(tube, -1, 1, 0.3, Math.PI - 0.3);
    expect(normalNear(g, new Vector3(0, 1.03, 0)).y).toBeGreaterThan(0.9);
  });

  it('every model builds finite, normalised geometry; aircraft stay within their declared footprint', () => {
    for (const [key, make] of Object.entries(MODEL_FACTORIES)) {
      const m = make();
      for (const geo of [m.body, m.glow].filter(Boolean) as BufferGeometry[]) {
        const pos = geo.getAttribute('position').array;
        const nrm = geo.getAttribute('normal').array;
        expect(pos.every(Number.isFinite), key).toBe(true);
        expect(nrm.every(Number.isFinite), key).toBe(true);
        for (let i = 0; i < nrm.length; i += 3) {
          const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
          // Zero only for degenerate slivers (nose tips); never un-normalised.
          if (l > 1e-6) expect(Math.abs(l - 1), key).toBeLessThan(1e-3);
        }
      }
      expect(m.body.getAttribute('surf'), key).toBeDefined();
      if (AIRCRAFT.has(key)) expect(m.body.boundingSphere!.radius, key).toBeLessThan(m.radius * 1.25);
    }
  });
});
