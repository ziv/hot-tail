import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Rail } from '@/sim/rail';
import { Rng } from '@/core/rng';
import { fbm, valueNoise } from './noise';
import type { LightingPreset } from './environment';

/**
 * Biome terrain kits (F3/I8): a profile-driven heightfield strip that follows
 * the rail (desert canyon, mountain valley, city ground, harbour quay), the
 * instanced night-city buildings, and the stratosphere cloud sea.
 */
export interface TerrainProfile {
  /** World height at lateral offset u from the rail, distance d. */
  height(u: number, d: number, seed: number): number;
  color(h: number, u: number, x: number, z: number): Color;
}

const c = (hex: string) => new Color(hex);

// ------------------------------------------------------------------ profiles
const DUNE = c('#d9b27a');
const SAND_LIGHT = c('#e6c48e');
const STRATA = [c('#b86a3c'), c('#cf8d58'), c('#9a4f2e'), c('#c4784a')];
const MESA_TOP = c('#c99462');

export const DESERT: TerrainProfile = {
  height(u, d, s) {
    const au = Math.abs(u);
    const w0 = 330 + 90 * valueNoise(d * 0.0011, 3.3, s);
    const wallH = 170 + 120 * valueNoise(d * 0.0007, 7.1 + Math.sign(u), s);
    if (au < w0) return Math.max(0, 5 * Math.sin(u * 0.02 + d * 0.004) * valueNoise(u * 0.004, d * 0.003, s));
    const t = Math.min(1, (au - w0) / 170);
    const wall = wallH * (t * t * (3 - 2 * t));
    const plateau = au > w0 + 170 ? fbm(u * 0.0012, d * 0.0012, 3, s) * 90 : 0;
    const mesa = au > w0 + 600 && valueNoise(u * 0.0025 + 11, d * 0.0025, s) > 0.72 ? 140 : 0;
    return wall + plateau + mesa;
  },
  color(h, _u, x, z) {
    if (h < 6) return valueNoise(x * 0.004, z * 0.004, 5) > 0.55 ? SAND_LIGHT : DUNE;
    if (h > 230) return MESA_TOP;
    return STRATA[Math.floor(h / 28) % STRATA.length];
  },
};

const GRASS = c('#5c8a3c');
const GRASS_DARK = c('#4a7433');
const RIVER = c('#3d6f8e');
const PINE = c('#2f4f2e');
const ROCK = c('#6f6a64');
const ROCK_DARK = c('#57534f');
const SNOW = c('#eef2f6');

export const MOUNTAINS: TerrainProfile = {
  height(u, d, s) {
    const au = Math.abs(u);
    const w0 = 360 + 110 * valueNoise(d * 0.0009, 1.7, s);
    if (au < w0) return au < 40 ? 0 : 2 + 6 * valueNoise(u * 0.01, d * 0.01, s);
    const t = Math.min(1, (au - w0) / 320);
    const base = (380 + 280 * valueNoise(d * 0.0006, 9.1 + Math.sign(u), s)) * (t * t * (3 - 2 * t));
    // Ridged noise for jagged peaks.
    const r = 1 - Math.abs(2 * fbm(u * 0.0016, d * 0.0016, 4, s) - 1);
    return base + (au > w0 + 150 ? r * r * 420 : 0);
  },
  color(h, u, x, z) {
    if (h < 1 && Math.abs(u) < 45) return RIVER;
    if (h < 12) return valueNoise(x * 0.006, z * 0.006, 2) > 0.5 ? GRASS : GRASS_DARK;
    const n = valueNoise(x * 0.01, z * 0.01, 3) * 90;
    if (h + n > 470) return SNOW;
    if (h < 150 + n) return PINE;
    return h + n > 300 ? ROCK : ROCK_DARK;
  },
};

const ASPHALT = c('#2e3034');
const ROAD = c('#3c3f45');
const PAVE = c('#55585e');
const QUAY = c('#4a4a48');

function cityColor(x: number, z: number): Color {
  const rx = ((x % 180) + 180) % 180;
  const rz = ((z % 220) + 220) % 220;
  if (rx < 14 || rz < 14) return PAVE;
  if (rx < 40 || rz < 40) return ROAD;
  return ASPHALT;
}

export const CITY: TerrainProfile = {
  height() {
    return 0;
  },
  color(_h, _u, x, z) {
    return cityColor(x, z);
  },
};

/** Waterfront: land (with the city) on the left, open water on the right. */
export const HARBOR: TerrainProfile = {
  height(u) {
    return u < -320 ? 3 : -40;
  },
  color(h, _u, x, z) {
    return h > 0 ? (((x % 60) + 60) % 60 < 6 ? QUAY : cityColor(x, z)) : ASPHALT;
  },
};

// --------------------------------------------------------------- strip kit
const STRIP_W = 7200;
const COLS = 72;
const ROWS = 18;

/**
 * Heightfield strips that follow the rail, so the flight corridor always bends
 * with the path. Meshes are pooled and rewritten in place as chunks stream in.
 */
export class StripKit {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly assigned = new Map<number, Mesh>();
  private rail: Rail | null = null;
  private seed = 1;
  private profile: TerrainProfile = DESERT;
  private readonly mat = new MeshLambertMaterial({ vertexColors: true });
  private readonly grid = new Float32Array((COLS + 1) * (ROWS + 1) * 3);
  private readonly offsets = new Float32Array(COLS + 1);

  constructor() {
    for (let i = 0; i < 10; i++) {
      const g = new BufferGeometry();
      const n = COLS * ROWS * 6;
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

  reset(rail: Rail, seed: number, profile: TerrainProfile): void {
    this.rail = rail;
    this.seed = seed % 997;
    this.profile = profile;
    this.assigned.clear();
    for (const m of this.meshes) {
      m.visible = false;
      m.userData.chunk = -1;
    }
  }

  show(c0: number, c1: number, chunk: number): void {
    const rail = this.rail;
    if (!rail) return;
    for (const [ci, m] of this.assigned) {
      if (ci < c0 || ci > c1) {
        m.visible = false;
        m.userData.chunk = -1;
        this.assigned.delete(ci);
      }
    }
    for (let ci = Math.max(0, c0); ci <= c1; ci++) {
      if (this.assigned.has(ci)) continue;
      const m = this.meshes.find((x) => x.userData.chunk === -1);
      if (!m) break;
      this.build(m, ci, chunk, rail);
      m.userData.chunk = ci;
      m.visible = true;
      this.assigned.set(ci, m);
    }
  }

  private build(mesh: Mesh, ci: number, chunk: number, rail: Rail): void {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as Float32BufferAttribute;
    const col = g.getAttribute('color') as Float32BufferAttribute;
    const grid = this.grid;
    const sample = { x: 0, y: 0 };
    for (let k = 0; k <= COLS; k++) {
      // Denser columns near the corridor, wider spacing far out.
      const f = (k / COLS) * 2 - 1;
      this.offsets[k] = Math.sign(f) * Math.pow(Math.abs(f), 1.6) * (STRIP_W / 2);
    }
    for (let r = 0; r <= ROWS; r++) {
      const d = ci * chunk + (r / ROWS) * chunk;
      rail.sample(d, sample);
      for (let k = 0; k <= COLS; k++) {
        const u = this.offsets[k];
        const i = (r * (COLS + 1) + k) * 3;
        grid[i] = sample.x + u;
        grid[i + 1] = this.profile.height(u, d, this.seed);
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
    for (let r = 0; r < ROWS; r++) {
      for (let k = 0; k < COLS; k++) {
        const a = (r * (COLS + 1) + k) * 3;
        const b = a + 3;
        const cc = a + (COLS + 1) * 3;
        const dd = cc + 3;
        const u = (this.offsets[k] + this.offsets[k + 1]) / 2;
        // Triangles wind counter-clockwise seen from above.
        const c1 = this.profile.color(
          (grid[a + 1] + grid[b + 1] + grid[cc + 1]) / 3,
          u,
          grid[a],
          grid[a + 2],
        );
        put(a, c1);
        put(b, c1);
        put(cc, c1);
        const c2 = this.profile.color(
          (grid[b + 1] + grid[dd + 1] + grid[cc + 1]) / 3,
          u,
          grid[a],
          grid[a + 2],
        );
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
}

// ------------------------------------------------------------ city buildings
const buildingVertex = /* glsl */ `
  attribute float aSeed;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vec4 local = instanceMatrix * vec4(position, 1.0);
    vLocal = local.xyz;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * local;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const buildingFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGround;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uNight;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying float vSeed;
  varying float vDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 base = mix(vec3(0.22, 0.24, 0.28), vec3(0.46, 0.43, 0.40), fract(vSeed * 7.13));
    vec3 light = max(dot(n, uSunDir), 0.0) * uSunColor * 0.7 + mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * 0.55;
    vec3 col = base * light;
    if (abs(n.y) < 0.5) {
      float h = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
      vec2 g = vec2(h / 8.0, vLocal.y / 9.0);
      vec2 f = fract(g);
      float win = step(0.22, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.85) * step(4.0, vLocal.y);
      vec2 cell = floor(g) + vSeed * 13.0;
      float lit = step(1.0 - uNight * 0.45, hash(cell));
      vec3 glass = mix(vec3(0.08, 0.1, 0.14), uHemiSky * 0.5, 0.5);
      vec3 lamp = mix(vec3(1.0, 0.78, 0.45), vec3(0.6, 0.8, 1.0), hash(cell * 1.7)) * 1.15;
      // Far away the window grid would alias into noise: fade to its average glow.
      float detail = 1.0 - smoothstep(450.0, 1500.0, vDepth);
      float w = mix(0.3, win, detail);
      float l = mix(uNight * 0.16, lit, detail);
      col = mix(col, glass, w * 0.75) + w * l * lamp * uNight;
    } else if (n.y > 0.5) {
      col *= 0.8;
      // Rooftop aviation beacons on the tall ones at night.
      float beacon = step(0.985, fract(vSeed * 91.3)) * step(length(fract(vLocal.xz / 9.0) - 0.5), 0.12);
      col += beacon * vec3(3.0, 0.2, 0.1) * uNight;
    }
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MAX_BUILDINGS = 520;
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

export class BuildingKit {
  readonly mesh: InstancedMesh;
  private readonly seeds: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;

  constructor() {
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.seeds = new InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS), 1);
    this.seeds.setUsage(DynamicDrawUsage);
    geo.setAttribute('aSeed', this.seeds);
    this.mat = new ShaderMaterial({
      uniforms: {
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uHemiSky: { value: new Color() },
        uHemiGround: { value: new Color() },
        uFogColor: { value: new Color() },
        uFogNear: { value: 800 },
        uFogFar: { value: 6000 },
        uNight: { value: 0 },
      },
      vertexShader: buildingVertex,
      fragmentShader: buildingFragment,
    });
    this.mesh = new InstancedMesh(geo, this.mat, MAX_BUILDINGS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  applyPreset(p: LightingPreset): void {
    const u = this.mat.uniforms;
    u.uSunDir.value.set(...p.sunDir).normalize();
    u.uSunColor.value.set(p.sunColor).multiplyScalar(p.sunIntensity / 2.5);
    u.uHemiSky.value.set(p.hemiSky).multiplyScalar(p.hemiIntensity);
    u.uHemiGround.value.set(p.hemiGround);
    u.uFogColor.value.set(p.fog);
    u.uFogNear.value = p.fogNear;
    u.uFogFar.value = p.fogFar;
    u.uNight.value = p.night ?? 0;
  }

  begin(): void {
    this.mesh.count = 0;
  }

  /** Fills one chunk with blocks; `side` -1 = left bank only (harbour). */
  addChunk(ci: number, chunk: number, rail: Rail, seed: number, side: 0 | -1): void {
    const rng = new Rng(((ci * 2246822519) ^ seed) >>> 0);
    const sample = { x: 0, y: 0 };
    const n = side === 0 ? 30 : 18;
    for (let i = 0; i < n && this.mesh.count < MAX_BUILDINGS; i++) {
      const d = (ci + rng.next()) * chunk;
      rail.sample(d, sample);
      const s = side === 0 ? rng.sign() : -1;
      // Keep the flight corridor clear; towers crowd its edges.
      const u = s * (side === 0 ? rng.range(270, 2600) : rng.range(360, 2600));
      const near = Math.abs(u) < 700;
      const tall = rng.chance(near ? 0.35 : 0.15);
      const h = tall ? rng.range(160, 360) : rng.range(30, near ? 150 : 110);
      _p.set(sample.x + u, side === 0 ? 0 : 3, -d);
      _s.set(rng.range(40, 110), h, rng.range(40, 110));
      _m.compose(_p, _q.identity(), _s);
      this.mesh.setMatrixAt(this.mesh.count, _m);
      this.seeds.setX(this.mesh.count, rng.next());
      this.mesh.count++;
    }
  }

  end(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;
  }
}

// ------------------------------------------------------------ stratosphere
const seaVertex = /* glsl */ `
  uniform vec2 uOffset;
  varying vec3 vFrame;
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vFrame = wp.xyz;
    vWorld = wp.xz + uOffset;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const seaFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uFogColor;
  uniform float uFogFar;
  varying vec3 vFrame;
  varying vec2 vWorld;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * n(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  void main() {
    vec2 p = vWorld * 0.0009 + vec2(uTime * 0.01, 0.0);
    float d = fbm(p);
    float billow = smoothstep(0.35, 0.8, d);
    vec3 col = mix(uShade, uLit, billow);
    float dist = length(vFrame - cameraPosition);
    col = mix(col, uFogColor, smoothstep(uFogFar * 0.25, uFogFar * 1.1, dist));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Endless cloud tops far below the stratosphere stages. */
export class CloudSea {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOffset: { value: new Vector2() },
        uLit: { value: new Color() },
        uShade: { value: new Color() },
        uFogColor: { value: new Color() },
        uFogFar: { value: 9000 },
      },
      vertexShader: seaVertex,
      fragmentShader: seaFragment,
    });
    const geo = new PlaneGeometry(40000, 40000);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.mesh.visible = false;
  }

  applyPreset(p: LightingPreset): void {
    const u = this.mat.uniforms;
    u.uLit.value.set(p.cloudLit);
    u.uShade.value.set(p.cloudShade);
    u.uFogColor.value.set(p.below);
    u.uFogFar.value = p.fogFar;
  }

  update(time: number, camX: number, camZ: number, seaY: number, worldX: number, dist: number): void {
    this.mesh.position.set(camX, seaY, camZ - 10000);
    const u = this.mat.uniforms;
    u.uTime.value = time;
    const wrap = 64 * 1024;
    u.uOffset.value.set(worldX % wrap, -(dist % wrap));
  }
}
