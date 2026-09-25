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

class Builder {
  private parts: BufferGeometry[] = [];

  add(geo: BufferGeometry, color: ColorRepresentation, xf: Xf = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    _q.setFromEuler(new Euler(...(xf.r ?? [0, 0, 0])));
    _m.compose(new Vector3(...(xf.p ?? [0, 0, 0])), _q, new Vector3(...(xf.s ?? [1, 1, 1])));
    g.applyMatrix4(_m);
    // Negative scale flips winding; restore it so faces stay front-facing.
    const s = xf.s ?? [1, 1, 1];
    if (s[0] * s[1] * s[2] < 0) g = flipWinding(g);
    _c.set(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    this.parts.push(g);
    return this;
  }

  /** Adds the geometry and its mirror across the YZ plane. */
  mirror(make: () => BufferGeometry, color: ColorRepresentation, xf: Xf): this {
    this.add(make(), color, xf);
    const p = xf.p ?? [0, 0, 0];
    const r = xf.r ?? [0, 0, 0];
    const s = xf.s ?? [1, 1, 1];
    return this.add(make(), color, {
      p: [-p[0], p[1], p[2]],
      r: [r[0], -r[1], -r[2]],
      s: [-s[0], s[1], s[2]],
    });
  }

  build(): BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    // Non-indexed, so this bakes per-face normals: a flat low-poly look without
    // flatShading's screen-space derivatives (which yield NaN on sub-pixel
    // triangles and poison the bloom pass).
    g.computeVertexNormals();
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
function plate(points: [number, number][], thickness = 0.3): BufferGeometry {
  const shape = new Shape(points.map(([x, z]) => new Vector2(x, z)));
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  // Lay the shape flat: shape (x, y) -> world (x, ·, z=y), thickness along Y.
  g.rotateX(Math.PI / 2);
  return g;
}

/** Flat profile (z, y) extruded thin along X — for fins and tails. */
function fin(points: [number, number][], thickness = 0.25): BufferGeometry {
  const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2); // shape X -> +Z
  return g;
}

const cyl = (rt: number, rb: number, h: number, seg = 8) => {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.rotateX(Math.PI / 2); // axis along Z; top (rt) at +Z
  return g;
};
const cone = (r: number, h: number, seg = 8) => {
  const g = new ConeGeometry(r, h, seg);
  g.rotateX(-Math.PI / 2); // tip toward -Z
  return g;
};

// ---------------------------------------------------------------- player jet
export function playerJet(): ModelGeo {
  const b = new Builder();
  const hull = '#c9ced8';
  const dark = '#39414f';
  const accent = '#2f7bd9';
  b.add(cone(1.15, 4.6), hull, { p: [0, 0.1, -9.6] });
  b.add(cyl(1.55, 1.15, 5), hull, { p: [0, 0.1, -4.9] });
  b.add(cyl(1.7, 1.55, 7), hull, { p: [0, 0, 1.1] });
  b.add(new SphereGeometry(1, 10, 6), '#1b2a3a', { p: [0, 1.15, -5.2], s: [0.85, 0.75, 2.4] });
  // Intakes
  b.mirror(() => new BoxGeometry(1.1, 1.3, 4.5), dark, { p: [1.75, -0.35, -1.2] });
  // Main wings
  b.mirror(
    () =>
      plate([
        [0.8, -3.2],
        [8.2, 2.6],
        [8.2, 3.9],
        [0.8, 4.6],
      ]),
    hull,
    { p: [0, -0.1, 0] },
  );
  // Wing stripes
  b.mirror(
    () =>
      plate(
        [
          [5.6, 0.95],
          [7.4, 2.4],
          [7.4, 3],
          [5.6, 2],
        ],
        0.34,
      ),
    accent,
    { p: [0, -0.1, 0] },
  );
  // Stabilisers
  b.mirror(
    () =>
      plate([
        [1.2, 5.4],
        [4.6, 7.8],
        [4.6, 8.6],
        [1.2, 8.4],
      ]),
    hull,
    { p: [0, -0.2, 0] },
  );
  // Twin canted tails
  b.mirror(
    () =>
      fin([
        [4.2, 0],
        [7.6, 4.2],
        [8.6, 4.2],
        [8.4, 0],
      ]),
    hull,
    { p: [1.3, 0.8, 0], r: [0, 0, -0.26] },
  );
  b.mirror(
    () =>
      fin(
        [
          [7.2, 3.1],
          [7.8, 4.25],
          [8.6, 4.25],
          [8.5, 3.1],
        ],
        0.3,
      ),
    accent,
    { p: [1.3, 0.8, 0], r: [0, 0, -0.26] },
  );
  // Nozzles
  b.mirror(() => cyl(0.95, 1.05, 1.6, 10), dark, { p: [0.85, -0.05, 5.1] });
  const glow = new Builder();
  glow.mirror(() => new CylinderGeometry(0.7, 0.7, 0.2, 10).rotateX(Math.PI / 2), '#ffb266', {
    p: [0.85, -0.05, 5.95],
  });
  return { body: b.build(), glow: glow.build(), radius: 10 };
}

// ------------------------------------------------------------------- enemies
export function fighter(): ModelGeo {
  const b = new Builder();
  const hull = '#6b6f78';
  const trim = '#9c2f2a';
  b.add(cone(1.1, 5), hull, { p: [0, 0, -9] });
  b.add(cyl(1.6, 1.1, 9), hull, { p: [0, 0, -2.2] });
  b.add(new SphereGeometry(1, 8, 6), '#2a1414', { p: [0, 1.0, -5], s: [0.8, 0.7, 2] });
  b.mirror(
    () =>
      plate([
        [1, -4],
        [9, 3],
        [9, 4.5],
        [1, 4],
      ]),
    hull,
    {},
  );
  b.mirror(
    () =>
      plate(
        [
          [6.5, 1.2],
          [9, 3],
          [9, 4.5],
          [6.5, 3.5],
        ],
        0.34,
      ),
    trim,
    {},
  );
  b.add(
    fin([
      [2, 0],
      [5.5, 4.8],
      [6.8, 4.8],
      [6.2, 0],
    ]),
    trim,
    { p: [0, 0.8, 0] },
  );
  b.add(cyl(1.1, 1.2, 1.5), '#2b2b2b', { p: [0, 0, 3] });
  const glow = new Builder().add(new CylinderGeometry(0.8, 0.8, 0.2, 8).rotateX(Math.PI / 2), '#ff7a3a', {
    p: [0, 0, 3.8],
  });
  return { body: b.build(), glow: glow.build(), radius: 10 };
}

export function chaser(): ModelGeo {
  const b = new Builder();
  const hull = '#586048';
  const trim = '#c9a23a';
  b.add(cone(1.3, 4), hull, { p: [0, 0.3, -8.5] });
  b.add(cyl(1.8, 1.3, 7), hull, { p: [0, 0.3, -3] });
  b.add(new SphereGeometry(1, 8, 6), '#1c2014', { p: [0, 1.5, -5], s: [0.9, 0.7, 2] });
  // Twin booms
  b.mirror(() => cyl(0.9, 0.9, 13), hull, { p: [4, 0, 1] });
  b.mirror(
    () =>
      plate([
        [0.5, -2],
        [10.5, 0],
        [10.5, 2.8],
        [0.5, 3.5],
      ]),
    hull,
    {},
  );
  b.mirror(
    () =>
      fin([
        [4.5, 0],
        [6.5, 3.6],
        [7.6, 3.6],
        [7.6, 0],
      ]),
    trim,
    { p: [4, 0.6, 0] },
  );
  b.add(
    plate([
      [-4, 6],
      [4, 6],
      [4, 7.5],
      [-4, 7.5],
    ]),
    hull,
    { p: [0, 1.5, 0] },
  );
  const glow = new Builder().mirror(
    () => new CylinderGeometry(0.6, 0.6, 0.2, 8).rotateX(Math.PI / 2),
    '#ff7a3a',
    { p: [4, 0, 7.6] },
  );
  return { body: b.build(), glow: glow.build(), radius: 11 };
}

export function drone(): ModelGeo {
  const b = new Builder();
  b.add(
    plate(
      [
        [0, -6],
        [7.5, 3],
        [4.5, 4.2],
        [0, 2.4],
        [-4.5, 4.2],
        [-7.5, 3],
      ],
      1,
    ),
    '#2d2638',
    {},
  );
  b.add(new SphereGeometry(1.6, 8, 5), '#3d3450', { p: [0, 0.4, -0.5], s: [1, 0.6, 2] });
  b.mirror(
    () =>
      fin([
        [1, 0],
        [3, 2.2],
        [4, 2.2],
        [3.6, 0],
      ]),
    '#2d2638',
    { p: [3, 0.4, 0], r: [0, 0, -0.4] },
  );
  const glow = new Builder()
    .add(new SphereGeometry(0.7, 8, 6), '#ff3b3b', { p: [0, 0.3, -4.8] })
    .mirror(() => new BoxGeometry(3.6, 0.25, 0.3), '#ff3b3b', { p: [3, 0.35, 1.2], r: [0, 0.8, 0] });
  return { body: b.build(), glow: glow.build(), radius: 8 };
}

export function ace(): ModelGeo {
  const b = new Builder();
  const hull = '#1d1f24';
  const gold = '#d4a640';
  b.add(cone(1.1, 5.5), hull, { p: [0, 0, -9.8] });
  b.add(cyl(1.5, 1.1, 9), hull, { p: [0, 0, -2.7] });
  b.add(new SphereGeometry(1, 8, 6), '#4a3a10', { p: [0, 1.0, -5.5], s: [0.8, 0.7, 2.2] });
  // Forward-swept wings
  b.mirror(
    () =>
      plate([
        [1, 0],
        [8.5, -3.5],
        [9.2, -2.2],
        [1, 4.5],
      ]),
    hull,
    {},
  );
  b.mirror(
    () =>
      plate(
        [
          [6.5, -2.4],
          [8.5, -3.5],
          [9.2, -2.2],
          [7, -0.6],
        ],
        0.34,
      ),
    gold,
    {},
  );
  // Canards
  b.mirror(
    () =>
      plate([
        [1, -6.5],
        [3.6, -5],
        [3.6, -4.3],
        [1, -4.6],
      ]),
    gold,
    {},
  );
  b.mirror(
    () =>
      fin([
        [2.5, 0],
        [5.6, 3.8],
        [6.6, 3.8],
        [6.4, 0],
      ]),
    hull,
    { p: [1.2, 0.8, 0], r: [0, 0, -0.35] },
  );
  b.mirror(() => cyl(0.8, 0.9, 1.4), '#101010', { p: [0.7, 0, 2.6] });
  const glow = new Builder().mirror(
    () => new CylinderGeometry(0.6, 0.6, 0.2, 8).rotateX(Math.PI / 2),
    '#ffd36a',
    { p: [0.7, 0, 3.35] },
  );
  return { body: b.build(), glow: glow.build(), radius: 10 };
}

// ------------------------------------------------------------------ missiles
export function missile(enemy: boolean): ModelGeo {
  const b = new Builder();
  const body = enemy ? '#3b3b3b' : '#e8e8e8';
  const tip = enemy ? '#d23b1f' : '#9aa4b4';
  b.add(cyl(0.45, 0.45, 5), body, {});
  b.add(cone(0.45, 1.4), tip, { p: [0, 0, -3.2] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(new BoxGeometry(0.08, 1.4, 1.2), body, {
      p: [Math.sin(a) * 0.6, Math.cos(a) * 0.6, 2.1],
      r: [0, 0, -a],
    });
  }
  const glow = new Builder().add(new SphereGeometry(0.55, 6, 4), enemy ? '#ff6a1f' : '#9fe8ff', {
    p: [0, 0, 2.7],
    s: [1, 1, 1.8],
  });
  return { body: b.build(), glow: glow.build(), radius: 3 };
}

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

export const MODEL_FACTORIES: Record<string, () => ModelGeo> = {
  player: playerJet,
  fighter,
  chaser,
  drone,
  ace,
  missile: () => missile(false),
  emissile: () => missile(true),
  fortress: fortressHull,
  bossTurret,
  bossEngine,
  bossCore,
};
