import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * Airframe toolkit: smooth lofted bodies and airfoil-section wings, generated
 * as closed, outward-facing indexed meshes with smooth normals. Everything is
 * built in model space (nose toward -Z, +Y up, +X to starboard).
 */

/** One fuselage cross-section: a superellipse at `z`. */
export interface Station {
  z: number;
  /** Half width. */
  w: number;
  /** Half height above the centre line (default: w). */
  h?: number;
  /** Half height below the centre line (default: h) — flat bellies, bulged canopies. */
  hb?: number;
  x?: number;
  y?: number;
  /** Superellipse exponent: 2 = ellipse, higher = boxier (intakes, blended bodies). */
  n?: number;
}

export interface LoftOpts {
  /** Vertices around each ring. */
  seg?: number;
  /** Close the first / last ring. Open ends show the inside (intakes, nozzles). */
  caps?: [boolean, boolean];
  /** Face inward: for cavities seen through an open end (nozzle interiors). */
  inside?: boolean;
  /** Insert interpolated stations so none are further apart than this (for `paint`). */
  maxStep?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function resample(st: Station[], maxStep: number): Station[] {
  const out: Station[] = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1];
    const b = st[i];
    const k = Math.max(1, Math.ceil(Math.abs(b.z - a.z) / maxStep));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      const ah = a.h ?? a.w;
      const bh = b.h ?? b.w;
      out.push({
        z: lerp(a.z, b.z, t),
        w: lerp(a.w, b.w, t),
        h: lerp(ah, bh, t),
        hb: lerp(a.hb ?? ah, b.hb ?? bh, t),
        x: lerp(a.x ?? 0, b.x ?? 0, t),
        y: lerp(a.y ?? 0, b.y ?? 0, t),
        n: lerp(a.n ?? 2, b.n ?? 2, t),
      });
    }
  }
  return out;
}

const spow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

/** Smooth body lofted through superellipse stations. */
export function loft(stations: Station[], o: LoftOpts = {}): BufferGeometry {
  const seg = o.seg ?? 20;
  const st = o.maxStep ? resample(stations, o.maxStep) : stations;
  const rings = st.map((s) => {
    const e = 2 / (s.n ?? 2);
    const h = s.h ?? s.w;
    const hb = s.hb ?? h;
    const ring: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ring.push((s.x ?? 0) + s.w * spow(c, e), (s.y ?? 0) + (sn >= 0 ? h : hb) * spow(sn, e), s.z);
    }
    return ring;
  });
  return sweep(rings, o.caps ?? [true, true], o.inside ?? false);
}

/** One wing section: span position `x`, leading edge at `z`, chord `c`, height `y`, thickness ratio `t`. */
export interface WingSection {
  x: number;
  z: number;
  c: number;
  y?: number;
  t?: number;
}

// Chord stations for the airfoil ring, trailing edge → leading edge (upper surface).
const CHORD = [1, 0.82, 0.62, 0.42, 0.26, 0.14, 0.06, 0.018, 0];

/** NACA 4-digit symmetric half-thickness at chord fraction u (closed trailing edge). */
const naca = (u: number, t: number) =>
  5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);

/**
 * Tapered wing through airfoil sections along +X (lofted linearly between
 * sections, so kinks and sawtooth trailing edges come out exactly).
 */
export function wing(sections: WingSection[], t = 0.05): BufferGeometry {
  const rings = sections.map((s) => {
    const ring: number[] = [];
    const tt = s.t ?? t;
    const y = s.y ?? 0;
    for (const u of CHORD) ring.push(s.x, y + naca(u, tt) * s.c, s.z + u * s.c);
    for (let i = CHORD.length - 2; i > 0; i--) {
      const u = CHORD[i];
      ring.push(s.x, y - naca(u, tt) * s.c, s.z + u * s.c);
    }
    return ring;
  });
  return sweep(rings, [true, true], false);
}

/** Vertical fin: a wing whose span runs up +Y (sections' `x` is height). */
export function vfin(sections: WingSection[], t = 0.05): BufferGeometry {
  return wing(sections, t).rotateZ(Math.PI / 2);
}

/**
 * Stitch rings (equal vertex counts) into a tube with optional flat caps, then
 * orient every face outward using the signed volume of the closed shape.
 */
function sweep(rings: number[][], caps: [boolean, boolean], inside: boolean): BufferGeometry {
  const seg = rings[0].length / 3;
  const pos: number[] = rings.flat();
  const tube: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      tube.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  // Caps get their own vertices so they stay flat-shaded.
  const capTris: number[][] = [];
  for (const [end, ring] of [rings[0], rings[rings.length - 1]].entries()) {
    const base = pos.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < seg; i++) {
      cx += ring[i * 3];
      cy += ring[i * 3 + 1];
      cz += ring[i * 3 + 2];
    }
    pos.push(cx / seg, cy / seg, cz / seg, ...ring);
    const tris: number[] = [];
    // The two ends of a closed tube wind in opposite directions.
    for (let i = 0; i < seg; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % seg);
      tris.push(base, ...(end === 0 ? [b, a] : [a, b]));
    }
    capTris.push(tris);
  }
  // Signed volume of the closed mesh: negative means faces point inward.
  let vol = 0;
  const all = [...tube, ...capTris[0], ...capTris[1]];
  for (let i = 0; i < all.length; i += 3) {
    const [a, b, c] = [all[i] * 3, all[i + 1] * 3, all[i + 2] * 3];
    vol +=
      pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
      pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
      pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  const index = [...tube];
  if (caps[0]) index.push(...capTris[0]);
  if (caps[1]) index.push(...capTris[1]);
  if (vol < 0 !== inside) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A body's cross-section at `z`, interpolated between stations (sorted by z). */
export function stationAt(st: Station[], z: number): Station {
  const sorted = [...st].sort((a, b) => a.z - b.z);
  let i = 1;
  while (i < sorted.length - 1 && sorted[i].z < z) i++;
  const a = sorted[i - 1];
  const b = sorted[i];
  const t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z || 1)));
  const ah = a.h ?? a.w;
  const bh = b.h ?? b.w;
  return {
    z,
    w: lerp(a.w, b.w, t),
    h: lerp(ah, bh, t),
    hb: lerp(a.hb ?? ah, b.hb ?? bh, t),
    x: lerp(a.x ?? 0, b.x ?? 0, t),
    y: lerp(a.y ?? 0, b.y ?? 0, t),
    n: lerp(a.n ?? 2, b.n ?? 2, t),
  };
}

/**
 * A patch of a body's skin — the arc a0..a1 (radians, 0 = starboard, π/2 = top)
 * of every section between z0 and z1 — lifted just proud of the surface.
 * Crisp-edged windscreens, cockpit glazing and stripes on lofted bodies.
 */
export function shell(
  stations: Station[],
  z0: number,
  z1: number,
  a0: number,
  a1: number,
  o: { lift?: number; seg?: number; steps?: number } = {},
): BufferGeometry {
  const seg = o.seg ?? 16;
  const steps = o.steps ?? 6;
  const lift = o.lift ?? 0.03;
  const pos: number[] = [];
  const index: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = stationAt(stations, lerp(z0, z1, k / steps));
    const e = 2 / (s.n ?? 2);
    for (let i = 0; i <= seg; i++) {
      const a = lerp(a0, a1, i / seg);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      pos.push(
        (s.x ?? 0) + (s.w + lift) * spow(c, e),
        (s.y ?? 0) + ((sn >= 0 ? s.h! : s.hb!) + lift) * spow(sn, e),
        s.z,
      );
    }
  }
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * (seg + 1) + i;
      const c = a + seg + 1;
      index.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Face away from the body's axis.
  const mid = Math.floor(steps / 2) * (seg + 1) + Math.floor(seg / 2);
  const s = stationAt(stations, lerp(z0, z1, Math.floor(steps / 2) / steps));
  const n = g.getAttribute('normal');
  const out = n.getX(mid) * (pos[mid * 3] - (s.x ?? 0)) + n.getY(mid) * (pos[mid * 3 + 1] - (s.y ?? 0));
  if (out < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    g.setIndex(index);
    g.computeVertexNormals();
  }
  return g;
}

/** Interpolated section between two wing sections at span `x` (for trim pieces). */
export function sectionAt(a: WingSection, b: WingSection, x: number, t?: number): WingSection {
  const f = (x - a.x) / (b.x - a.x);
  return {
    x,
    z: lerp(a.z, b.z, f),
    c: lerp(a.c, b.c, f),
    y: lerp(a.y ?? 0, b.y ?? 0, f),
    t: t ?? lerp(a.t ?? 0.05, b.t ?? 0.05, f),
  };
}
