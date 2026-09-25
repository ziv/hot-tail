import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural greybox-plus models (I2/I3/I6 placeholders): low-poly meshes built
 * from primitives with baked vertex colours, merged into one geometry per model
 * so each model type is a single instanced draw call. Every model's nose points
 * down -Z. `glow` parts render unlit/additive so bloom picks them up.
 */
export interface ModelGeo {
  body: BufferGeometry;
  glow?: BufferGeometry;
  /** Approximate bounding radius, for LOD/culling decisions. */
  radius: number;
}

interface Xf {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
}

const _m = new Matrix4();
const _q = new Quaternion();
const _c = new Color();

/**
 * Surface response per vertex: [roughness, metalness, panel-line strength].
 * All zero means "use the material defaults" (the older faceted models).
 */
export type Surf = readonly [number, number, number];
export const SURF = {
  none: [0, 0, 0],
  paint: [0.52, 0.28, 0.14],
  gloss: [0.3, 0.3, 0.1],
  glass: [0.06, 0.65, 0],
  metal: [0.3, 0.85, 0.04],
  matte: [0.82, 0.08, 0.05],
  soot: [0.9, 0.2, 0],
} as const satisfies Record<string, Surf>;

export interface PartOpts {
  /** Keep the geometry's own (smooth) normals instead of baking flat ones. */
  smooth?: boolean;
  surf?: Surf;
  /** Underside colour, blended in where the surface faces down (countershading). */
  under?: ColorRepresentation;
  /** Per-vertex override (e.g. a windscreen on a lofted nose), given position and normal. */
  paint?: (p: Vector3, n: Vector3) => { color: ColorRepresentation; surf?: Surf } | null;
}

const _c2 = new Color();
const _pv = new Vector3();
const _nv = new Vector3();

export class Builder {
  private parts: BufferGeometry[] = [];

  add(geo: BufferGeometry, color: ColorRepresentation, xf: Xf = {}, opts: PartOpts = {}): this {
    if (opts.smooth && !geo.getAttribute('normal')) geo.computeVertexNormals();
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    _q.setFromEuler(new Euler(...(xf.r ?? [0, 0, 0])));
    _m.compose(new Vector3(...(xf.p ?? [0, 0, 0])), _q, new Vector3(...(xf.s ?? [1, 1, 1])));
    g.applyMatrix4(_m);
    // Negative scale flips winding; restore it so faces stay front-facing.
    const s = xf.s ?? [1, 1, 1];
    if (s[0] * s[1] * s[2] < 0) g = flipWinding(g);
    // Non-indexed, so this bakes per-face normals: a flat low-poly look without
    // flatShading's screen-space derivatives (which yield NaN on sub-pixel
    // triangles and poison the bloom pass).
    if (!opts.smooth) g.computeVertexNormals();
    _c.set(color);
    if (opts.under !== undefined) _c2.set(opts.under);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const surf = new Float32Array(n * 3);
    const base = opts.surf ?? SURF.none;
    for (let i = 0; i < n; i++) {
      let r = _c.r;
      let gg = _c.g;
      let bb = _c.b;
      let sf: Surf = base;
      if (opts.under !== undefined) {
        const t = Math.min(1, Math.max(0, (-nrm.getY(i) - 0.1) / 0.5));
        r += (_c2.r - r) * t;
        gg += (_c2.g - gg) * t;
        bb += (_c2.b - bb) * t;
      }
      if (opts.paint) {
        const o = opts.paint(_pv.fromBufferAttribute(pos, i), _nv.fromBufferAttribute(nrm, i));
        if (o) {
          _c2.set(o.color);
          r = _c2.r;
          gg = _c2.g;
          bb = _c2.b;
          if (o.surf) sf = o.surf;
          if (opts.under !== undefined) _c2.set(opts.under);
        }
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = bb;
      surf[i * 3] = sf[0];
      surf[i * 3 + 1] = sf[1];
      surf[i * 3 + 2] = sf[2];
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setAttribute('surf', new Float32BufferAttribute(surf, 3));
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'surf'].includes(name)) g.deleteAttribute(name);
    }
    this.parts.push(g);
    return this;
  }

  /** Adds the geometry and its mirror across the YZ plane. */
  mirror(make: () => BufferGeometry, color: ColorRepresentation, xf: Xf, opts: PartOpts = {}): this {
    this.add(make(), color, xf, opts);
    const p = xf.p ?? [0, 0, 0];
    const r = xf.r ?? [0, 0, 0];
    const s = xf.s ?? [1, 1, 1];
    return this.add(
      make(),
      color,
      {
        p: [-p[0], p[1], p[2]],
        r: [r[0], -r[1], -r[2]],
        s: [-s[0], s[1], s[2]],
      },
      opts,
    );
  }

  build(): BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    g.computeBoundingSphere();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return g;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }
}

function flipWinding(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, nrm]) {
      if (!attr) continue;
      const ax = attr.getX(i + 1);
      const ay = attr.getY(i + 1);
      const az = attr.getZ(i + 1);
      attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
      attr.setXYZ(i + 2, ax, ay, az);
    }
  }
  return g;
}

/** Flat planform (x, z) extruded to a thin slab lying in the XZ plane. */
export function plate(points: [number, number][], thickness = 0.3): BufferGeometry {
  const shape = new Shape(points.map(([x, z]) => new Vector2(x, z)));
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  // Lay the shape flat: shape (x, y) -> world (x, ·, z=y), thickness along Y.
  g.rotateX(Math.PI / 2);
  return g;
}

/** Flat profile (z, y) extruded thin along X — for fins and tails. */
export function fin(points: [number, number][], thickness = 0.25): BufferGeometry {
  const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2); // shape X -> +Z
  return g;
}

export const cyl = (rt: number, rb: number, h: number, seg = 8) => {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.rotateX(Math.PI / 2); // axis along Z; top (rt) at +Z
  return g;
};
export const cone = (r: number, h: number, seg = 8) => {
  const g = new ConeGeometry(r, h, seg);
  g.rotateX(-Math.PI / 2); // tip toward -Z
  return g;
};

export function playerBullet(): BufferGeometry {
  const g = new BoxGeometry(0.5, 0.5, 30);
  g.translate(0, 0, 8);
  return g;
}

export function enemyBullet(): BufferGeometry {
  return new IcosahedronGeometry(3.2, 1);
}

// --------------------------------------------------------------------- boss
export function fortressHull(): ModelGeo {
  const b = new Builder();
  const hull = '#4b5158';
  const panel = '#3a3f45';
  const warn = '#b8862a';
  // Central body
  b.add(new BoxGeometry(56, 18, 120), hull, { p: [0, 0, 0] });
  b.add(cone(28, 40, 4), panel, { p: [0, 0, -78], r: [0, 0, Math.PI / 4], s: [1, 0.45, 1] });
  // Huge swept wings
  b.mirror(
    () =>
      plate(
        [
          [26, -40],
          [175, 10],
          [180, 32],
          [26, 40],
        ],
        6,
      ),
    hull,
    {},
  );
  b.mirror(
    () =>
      plate(
        [
          [150, 2],
          [180, 12],
          [182, 32],
          [150, 28],
        ],
        6.4,
      ),
    warn,
    {},
  );
  // Wing fences / armour plates
  b.mirror(() => new BoxGeometry(4, 8, 50), panel, { p: [110, 5, 8] });
  b.mirror(() => new BoxGeometry(4, 8, 55), panel, { p: [62, 5, 4] });
  // Tail fins
  b.mirror(
    () =>
      fin(
        [
          [25, 0],
          [48, 34],
          [60, 34],
          [60, 0],
        ],
        3,
      ),
    panel,
    { p: [22, 8, 0], r: [0, 0, -0.2] },
  );
  // Bridge
  b.add(new BoxGeometry(22, 8, 26), panel, { p: [0, 12, -24] });
  const glow = new Builder()
    .add(new BoxGeometry(20, 1.2, 1.2), '#8fd8ff', { p: [0, 14, -37.5] })
    .mirror(() => new SphereGeometry(1.6, 6, 4), '#ff3030', { p: [182, 6, 20] });
  return { body: b.build(), glow: glow.build(), radius: 190 };
}

export function bossTurret(): ModelGeo {
  const b = new Builder();
  b.add(new CylinderGeometry(9, 11, 5, 10), '#5d646c', {});
  b.add(new SphereGeometry(8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#6f777f', { p: [0, 2, 0] });
  b.mirror(() => cyl(0.9, 0.9, 16), '#2a2d31', { p: [2.4, 5, 6] });
  const glow = new Builder().add(new BoxGeometry(6, 1, 1), '#ff9a3a', { p: [0, 6, -7.6] });
  return { body: b.build(), glow: glow.build(), radius: 12 };
}

export function bossEngine(): ModelGeo {
  const b = new Builder();
  b.add(cyl(11, 9, 34, 12), '#50565d', { p: [0, 0, -6] });
  b.add(new TorusGeometry(10.5, 1.6, 6, 14), '#2c3035', { p: [0, 0, 11] });
  const glow = new Builder().add(new CylinderGeometry(8.5, 8.5, 0.5, 14).rotateX(Math.PI / 2), '#ff8c3a', {
    p: [0, 0, 11.5],
  });
  return { body: b.build(), glow: glow.build(), radius: 18 };
}

export function bossCore(): ModelGeo {
  const b = new Builder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(new BoxGeometry(4, 20, 5), '#3a3f45', {
      p: [Math.cos(a) * 11, Math.sin(a) * 11, 0],
      r: [0, 0, a + Math.PI / 2],
    });
  }
  const glow = new Builder().add(new IcosahedronGeometry(8, 1), '#ff3355', {});
  return { body: b.build(), glow: glow.build(), radius: 16 };
}
