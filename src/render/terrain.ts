import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Rng } from '@/core/rng';
import type { Rail } from '@/sim/rail';
import type { Biome } from '@/sim/defs';
import { fbm, valueNoise } from './noise';
import type { LightingPreset } from './environment';

/**
 * Terrain streaming (F3) for the ocean biome: the world is split into chunks
 * along the rail; each chunk deterministically places islands, sea stacks and
 * cloud clusters from its index. Visible chunks are rebuilt into a handful of
 * instanced meshes whenever the window moves, so draw calls stay constant.
 */
const CHUNK = 1500;
const BEHIND = 2500;
const AHEAD = 8000;
const ISLAND_VARIANTS = 5;
const ROCK_VARIANTS = 3;
const MAX_PER_VARIANT = 48;
const MAX_PUFFS = 320;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

export class Terrain {
  /** Positioned each frame at (-railX, -railY, dist): children use world coords. */
  readonly group = new Group();
  private readonly islands: InstancedMesh[] = [];
  private readonly rocks: InstancedMesh[] = [];
  private readonly clouds: CloudLayer;
  private rail: Rail | null = null;
  private seed = 1;
  private c0 = NaN;
  private c1 = NaN;
  private biome: Biome = 'ocean';
  private readonly canyon = new CanyonKit();

  constructor() {
    const islandMat = new MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < ISLAND_VARIANTS; i++) {
      const mesh = new InstancedMesh(islandGeometry(i * 31 + 7), islandMat, MAX_PER_VARIANT);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.islands.push(mesh);
      this.group.add(mesh);
    }
    const rockMat = new MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < ROCK_VARIANTS; i++) {
      const mesh = new InstancedMesh(rockGeometry(i * 13 + 3), rockMat, MAX_PER_VARIANT);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.rocks.push(mesh);
      this.group.add(mesh);
    }
    this.clouds = new CloudLayer(MAX_PUFFS);
    this.group.add(this.clouds.mesh);
    this.group.add(this.canyon.group);
  }

  setStage(rail: Rail, seed: number, biome: Biome = 'ocean'): void {
    this.rail = rail;
    this.seed = seed;
    this.biome = biome;
    this.c0 = this.c1 = NaN;
    const ocean = biome === 'ocean';
    for (const m of [...this.islands, ...this.rocks]) m.visible = ocean;
    this.canyon.group.visible = !ocean;
    this.canyon.reset(rail, seed);
  }

  applyPreset(p: LightingPreset): void {
    this.clouds.applyPreset(p);
  }

  setCloudsVisible(v: boolean): void {
    this.clouds.mesh.visible = v;
  }

  update(dist: number, railX: number, railY: number): void {
    this.group.position.set(-railX, -railY, dist);
    const c0 = Math.floor((dist - BEHIND) / CHUNK);
    const c1 = Math.floor((dist + AHEAD) / CHUNK);
    if (c0 !== this.c0 || c1 !== this.c1) {
      this.c0 = c0;
      this.c1 = c1;
      this.rebuild(c0, c1);
    }
  }

  private rebuild(c0: number, c1: number): void {
    const rail = this.rail;
    if (!rail) return;
    for (const m of this.islands) m.count = 0;
    for (const m of this.rocks) m.count = 0;
    this.clouds.begin();
    if (this.biome === 'desert') this.canyon.show(c0, c1, CHUNK);
    const sample = { x: 0, y: 0 };
    for (let c = c0; c <= c1; c++) {
      if (c < 0) continue;
      const rng = new Rng(((c * 2654435761) ^ this.seed) >>> 0);
      if (this.biome === 'desert') {
        this.addClouds(rng, c, rail, sample, 0.5);
        continue;
      }
      // Islands
      const count = rng.int(1, 3);
      for (let i = 0; i < count; i++) {
        const d = (c + rng.next()) * CHUNK;
        rail.sample(d, sample);
        const side = rng.sign();
        const offset = side * rng.range(260, 3200);
        const near = Math.abs(offset) < 700;
        const radius = near ? rng.range(90, 220) : rng.range(180, 700);
        const height = near ? rng.range(10, 26) : radius * rng.range(0.15, 0.55);
        this.place(this.islands, rng.int(0, ISLAND_VARIANTS - 1), sample.x + offset, d, radius, height, rng);
      }
      // Sea stacks near the flight path: strong parallax speed cues.
      const stacks = rng.int(0, 3);
      for (let i = 0; i < stacks; i++) {
        const d = (c + rng.next()) * CHUNK;
        rail.sample(d, sample);
        const offset = rng.sign() * rng.range(160, 900);
        const r = rng.range(10, 28);
        this.place(
          this.rocks,
          rng.int(0, ROCK_VARIANTS - 1),
          sample.x + offset,
          d,
          r,
          rng.range(18, 34),
          rng,
        );
      }
      this.addClouds(rng, c, rail, sample, 1);
    }
    for (const m of [...this.islands, ...this.rocks]) m.instanceMatrix.needsUpdate = true;
    this.clouds.end();
  }

  private addClouds(
    rng: Rng,
    c: number,
    rail: Rail,
    sample: { x: number; y: number },
    density: number,
  ): void {
    const clusters = Math.round(rng.int(1, 3) * density);
    for (let i = 0; i < clusters; i++) {
      const d = (c + rng.next()) * CHUNK;
      rail.sample(d, sample);
      const cx = sample.x + rng.sign() * rng.range(0, 3600);
      const cy = rng.range(420, 1100);
      const puffs = rng.int(4, 8);
      const size = rng.range(160, 380);
      for (let k = 0; k < puffs; k++) {
        this.clouds.add(
          cx + rng.range(-1, 1) * size * 1.6,
          cy + rng.range(-0.3, 0.4) * size,
          -d + rng.range(-1, 1) * size,
          size * rng.range(0.7, 1.3),
          rng.next(),
        );
      }
    }
  }

  private place(
    set: InstancedMesh[],
    variant: number,
    x: number,
    d: number,
    r: number,
    h: number,
    rng: Rng,
  ): void {
    const mesh = set[variant];
    if (mesh.count >= MAX_PER_VARIANT) return;
    _q.setFromAxisAngle(_up, rng.range(0, Math.PI * 2));
    _p.set(x, 0, -d);
    _s.set(r, h, r * rng.range(0.7, 1.2));
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(mesh.count++, _m);
  }
}

/** Unit island: radius ~1, peak height 1, base slightly below sea level. */
function islandGeometry(seed: number): BufferGeometry {
  const n = 34;
  const g = new PlaneGeometry(2.6, 2.6, n, n);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const edge = 0.75 + 0.3 * valueNoise(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5, seed);
    const t = Math.max(0, 1 - r / edge);
    const ridge = 0.55 + 0.6 * fbm(x * 2.2 + seed, z * 2.2 - seed, 4, seed);
    const h = Math.pow(t, 1.3) * ridge;
    pos.setY(i, h > 0 ? h : -0.08 - (r - edge) * 0.2);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  colorBy(flat, (y, i) => {
    const jitter = valueNoise(i * 0.37, 0.5, seed) * 0.1;
    if (y < 0.03) return SAND;
    if (y < 0.5 + jitter) return y < 0.2 ? GRASS_LO : GRASS_HI;
    if (y < 0.85) return ROCK;
    return PEAK;
  });
  flat.deleteAttribute('uv');
  return flat;
}

function rockGeometry(seed: number): BufferGeometry {
  const g = new DodecahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.75 + 0.5 * valueNoise(x * 3 + seed, z * 3 + y * 2, seed);
    pos.setXYZ(i, x * k, Math.max(-0.2, y * 0.5 + 0.5) * k, z * k);
  }
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  colorBy(flat, (y) => (y < 0.12 ? SAND : y > 0.85 ? PEAK : ROCK_DARK));
  flat.deleteAttribute('uv');
  return flat;
}

const SAND = new Color('#d9c38f');
const GRASS_LO = new Color('#4f8a3a');
const GRASS_HI = new Color('#3a6e30');
const ROCK = new Color('#7d7466');
const ROCK_DARK = new Color('#5e5850');
const PEAK = new Color('#b5ab9a');

function colorBy(g: BufferGeometry, pick: (y: number, i: number) => Color): void {
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  // Colour per triangle (by centroid height) for a crisp low-poly look.
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const c = pick(y, i);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

// -------------------------------------------------------------------- clouds
const cloudVertex = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec2 iData; // scale, shade
  varying vec2 vUv;
  varying float vShade;
  varying float vDepth;
  void main() {
    vUv = uv;
    vShade = iData.y;
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    mv.xy += position.xy * iData.x;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  uniform float uNear;
  varying vec2 vUv;
  varying float vShade;
  varying float vDepth;
  void main() {
    float a = texture2D(uTex, vUv).a;
    vec3 col = mix(uShade, uLit, clamp(vUv.y * 0.9 + vShade * 0.3, 0.0, 1.0));
    float fogF = smoothstep(uFogNear, uFogFar * 1.1, vDepth);
    col = mix(col, uFogColor, fogF * 0.85);
    a *= uOpacity * smoothstep(uNear, uNear * 3.0, vDepth) * (1.0 - smoothstep(uFogFar * 0.9, uFogFar * 1.25, vDepth));
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a * 0.9);
  }
`;

export class CloudLayer {
  readonly mesh: Mesh;
  private readonly offsets: InstancedBufferAttribute;
  private readonly data: InstancedBufferAttribute;
  private readonly geo: InstancedBufferGeometry;
  private readonly mat: ShaderMaterial;
  private count = 0;

  constructor(
    private readonly capacity: number,
    nearFade = 150,
  ) {
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offsets = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.data = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.geo.setAttribute('iOffset', this.offsets);
    this.geo.setAttribute('iData', this.data);
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      uniforms: {
        uTex: { value: cloudTexture() },
        uLit: { value: new Color() },
        uShade: { value: new Color() },
        uFogColor: { value: new Color() },
        uFogNear: { value: 800 },
        uFogFar: { value: 6000 },
        uOpacity: { value: 1 },
        uNear: { value: nearFade },
      },
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  applyPreset(p: LightingPreset): void {
    const u = this.mat.uniforms;
    u.uLit.value.set(p.cloudLit);
    u.uShade.value.set(p.cloudShade);
    u.uFogColor.value.set(p.fog);
    u.uFogNear.value = p.fogNear;
    u.uFogFar.value = p.fogFar;
  }

  begin(): void {
    this.count = 0;
  }

  set opacity(v: number) {
    this.mat.uniforms.uOpacity.value = v;
  }

  add(x: number, y: number, z: number, scale: number, shade: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.offsets.setXYZ(i, x, y, z);
    this.data.setXY(i, scale, shade);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.offsets.needsUpdate = true;
    this.data.needsUpdate = true;
  }
}

function cloudTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(77);
  for (let i = 0; i < 14; i++) {
    const x = size * (0.25 + 0.5 * rng.next());
    const y = size * (0.35 + 0.35 * rng.next());
    const r = size * (0.12 + 0.16 * rng.next());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------ desert canyon
const CANYON_W = 7200;
const CANYON_COLS = 72;
const CANYON_ROWS = 18;
const DUNE = new Color('#d9b27a');
const SAND_LIGHT = new Color('#e6c48e');
const STRATA = [new Color('#b86a3c'), new Color('#cf8d58'), new Color('#9a4f2e'), new Color('#c4784a')];
const MESA_TOP = new Color('#c99462');

/**
 * Desert biome kit: canyon strips that follow the rail, so the floor corridor
 * always bends with the flight path. Each chunk is a faceted heightfield whose
 * vertex rows are laid out relative to the rail's x at that distance. Meshes
 * are pooled and rewritten in place when a new chunk scrolls into range.
 */
class CanyonKit {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly assigned = new Map<number, Mesh>();
  private rail: Rail | null = null;
  private seed = 1;
  private readonly mat = new MeshLambertMaterial({ vertexColors: true });
  private readonly grid = new Float32Array((CANYON_COLS + 1) * (CANYON_ROWS + 1) * 3);

  constructor() {
    for (let i = 0; i < 10; i++) {
      const g = new BufferGeometry();
      const n = CANYON_COLS * CANYON_ROWS * 6;
      g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3), 3));
      const m = new Mesh(g, this.mat);
      m.frustumCulled = false;
      m.visible = false;
      m.userData.chunk = -1;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  reset(rail: Rail, seed: number): void {
    this.rail = rail;
    this.seed = seed;
    this.assigned.clear();
    for (const m of this.meshes) {
      m.visible = false;
      m.userData.chunk = -1;
    }
  }

  /** World-space surface height at lateral offset u from the rail, distance d. */
  height(u: number, d: number): number {
    const s = this.seed % 997;
    const au = Math.abs(u);
    const w0 = 330 + 90 * valueNoise(d * 0.0011, 3.3, s);
    const wallH = 170 + 120 * valueNoise(d * 0.0007, 7.1 + Math.sign(u), s);
    if (au < w0) {
      const dunes = 5 * Math.sin(u * 0.02 + d * 0.004) * valueNoise(u * 0.004, d * 0.003, s);
      return Math.max(0, dunes);
    }
    const t = Math.min(1, (au - w0) / 170);
    const wall = wallH * (t * t * (3 - 2 * t));
    const plateau = au > w0 + 170 ? fbm(u * 0.0012, d * 0.0012, 3, s) * 90 : 0;
    const mesa = au > w0 + 600 && valueNoise(u * 0.0025 + 11, d * 0.0025, s) > 0.72 ? 140 : 0;
    return wall + plateau + mesa;
  }

  show(c0: number, c1: number, chunk: number): void {
    const rail = this.rail;
    if (!rail) return;
    for (const [c, m] of this.assigned) {
      if (c < c0 || c > c1) {
        m.visible = false;
        m.userData.chunk = -1;
        this.assigned.delete(c);
      }
    }
    for (let c = Math.max(0, c0); c <= c1; c++) {
      if (this.assigned.has(c)) continue;
      const m = this.meshes.find((x) => x.userData.chunk === -1);
      if (!m) break;
      this.build(m, c, chunk, rail);
      m.userData.chunk = c;
      m.visible = true;
      this.assigned.set(c, m);
    }
  }

  private build(mesh: Mesh, c: number, chunk: number, rail: Rail): void {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as Float32BufferAttribute;
    const col = g.getAttribute('color') as Float32BufferAttribute;
    const cols = CANYON_COLS;
    const rows = CANYON_ROWS;
    const grid = this.grid;
    const sample = { x: 0, y: 0 };
    for (let r = 0; r <= rows; r++) {
      const d = c * chunk + (r / rows) * chunk;
      rail.sample(d, sample);
      for (let k = 0; k <= cols; k++) {
        // Denser columns near the corridor, wider spacing far out.
        const f = (k / cols) * 2 - 1;
        const u = Math.sign(f) * Math.pow(Math.abs(f), 1.6) * (CANYON_W / 2);
        const i = (r * (cols + 1) + k) * 3;
        grid[i] = sample.x + u;
        grid[i + 1] = this.height(u, d);
        grid[i + 2] = -d;
      }
    }
    const pa = pos.array as Float32Array;
    const ca = col.array as Float32Array;
    let o = 0;
    const put = (gi: number, color: Color) => {
      pa[o] = grid[gi];
      pa[o + 1] = grid[gi + 1];
      pa[o + 2] = grid[gi + 2];
      ca[o] = color.r;
      ca[o + 1] = color.g;
      ca[o + 2] = color.b;
      o += 3;
    };
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const a = (r * (cols + 1) + k) * 3;
        const b = a + 3;
        const cc = a + (cols + 1) * 3;
        const dd = cc + 3;
        // Triangles wind counter-clockwise seen from above.
        const h1 = (grid[a + 1] + grid[b + 1] + grid[cc + 1]) / 3;
        const c1 = this.color(h1, grid[a], grid[a + 2]);
        put(a, c1);
        put(b, c1);
        put(cc, c1);
        const h2 = (grid[b + 1] + grid[dd + 1] + grid[cc + 1]) / 3;
        const c2 = this.color(h2, grid[a], grid[a + 2]);
        put(b, c2);
        put(dd, c2);
        put(cc, c2);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    g.computeVertexNormals();
    (g.getAttribute('normal') as Float32BufferAttribute).needsUpdate = true;
  }

  private color(h: number, x: number, z: number): Color {
    // Sand patches follow smooth noise per quad, so dunes read as soft bands.
    if (h < 6) return valueNoise(x * 0.004, z * 0.004, 5) > 0.55 ? SAND_LIGHT : DUNE;
    if (h > 230) return MESA_TOP;
    return STRATA[Math.floor(h / 28) % STRATA.length];
  }
}
