import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
} from 'three';

/**
 * GPU particle system (B9). Particles are written once into a ring buffer at
 * emission; all motion (drag, gravity, world scroll), size and colour-over-life
 * is evaluated in the vertex shader, so the CPU cost is just the emit writes.
 * World-anchored particles (anchor = 1) scroll back with the distance flown so
 * explosions and trails stay where they happened.
 */
export interface EmitParams {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  drag?: number;
  gravity?: number;
  anchor?: number;
  color0: Color;
  color1: Color;
  alpha?: number;
}

const vertex = /* glsl */ `
  attribute vec3 aVel;
  attribute vec4 aTime;   // spawnTime, life, dist0, anchor
  attribute vec4 aSize;   // size0, size1, drag, gravity
  attribute vec4 aColor0; // rgb, alpha
  attribute vec3 aColor1;
  uniform float uTime;
  uniform float uDist;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    float age = uTime - aTime.x;
    float t = age / aTime.y;
    if (t < 0.0 || t >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float drag = aSize.z;
    float k = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = position + aVel * k;
    p.y -= 0.5 * aSize.w * age * age;
    p.z += (uDist - aTime.z) * aTime.w;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(aSize.x, aSize.y, t);
    gl_PointSize = size * uScale / max(-mv.z, 1.0);
    float fade = t < 0.08 ? t / 0.08 : 1.0 - smoothstep(0.35, 1.0, t);
    vColor = vec4(mix(aColor0.rgb, aColor1, t), aColor0.a * fade);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uTex;
  varying vec4 vColor;
  void main() {
    float a = texture2D(uTex, gl_PointCoord).a * vColor.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

export class ParticleSystem {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly time: Float32Array;
  private readonly size: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private head = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  now = 0;
  dist = 0;
  /** 0..1 multiplier applied to emission counts (quality tiers). */
  density = 1;

  constructor(
    readonly capacity: number,
    blending: Blending,
    texture: CanvasTexture,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.time = new Float32Array(capacity * 4).fill(-1000);
    this.size = new Float32Array(capacity * 4);
    this.col0 = new Float32Array(capacity * 4);
    this.col1 = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.time[i * 4 + 1] = 1;
    this.geo = new BufferGeometry();
    const attrs: [string, Float32Array, number][] = [
      ['position', this.pos, 3],
      ['aVel', this.vel, 3],
      ['aTime', this.time, 4],
      ['aSize', this.size, 4],
      ['aColor0', this.col0, 4],
      ['aColor1', this.col1, 3],
    ];
    for (const [name, arr, n] of attrs) {
      const a = new Float32BufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      this.geo.setAttribute(name, a);
    }
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDist: { value: 0 },
        uScale: { value: 400 },
        uTex: { value: texture },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(p: EmitParams): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx;
    this.vel[i * 3 + 1] = p.vy;
    this.vel[i * 3 + 2] = p.vz;
    this.time[i * 4] = this.now;
    this.time[i * 4 + 1] = p.life;
    this.time[i * 4 + 2] = this.dist;
    this.time[i * 4 + 3] = p.anchor ?? 1;
    this.size[i * 4] = p.size0;
    this.size[i * 4 + 1] = p.size1;
    this.size[i * 4 + 2] = p.drag ?? 0;
    this.size[i * 4 + 3] = p.gravity ?? 0;
    this.col0[i * 4] = p.color0.r;
    this.col0[i * 4 + 1] = p.color0.g;
    this.col0[i * 4 + 2] = p.color0.b;
    this.col0[i * 4 + 3] = p.alpha ?? 1;
    this.col1[i * 3] = p.color1.r;
    this.col1[i * 3 + 1] = p.color1.g;
    this.col1[i * 3 + 2] = p.color1.b;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Uploads only the ring-buffer range written this frame. */
  update(now: number, dist: number, viewportHeight: number, fovDeg: number): void {
    this.now = now;
    this.dist = dist;
    const u = this.mat.uniforms;
    u.uTime.value = now;
    u.uDist.value = dist;
    u.uScale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    if (this.dirtyMax < 0) return;
    const start = this.dirtyMin;
    const count = this.dirtyMax - this.dirtyMin + 1;
    for (const name of ['position', 'aVel', 'aTime', 'aSize', 'aColor0', 'aColor1']) {
      const a = this.geo.getAttribute(name) as Float32BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(start * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.time[i * 4] = -1000;
    this.dirtyMin = 0;
    this.dirtyMax = this.capacity - 1;
  }
}

export function softTexture(kind: 'glow' | 'smoke'): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'glow') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function createParticleSystems(capacityScale = 1): { fx: ParticleSystem; smoke: ParticleSystem } {
  return {
    fx: new ParticleSystem(Math.round(6000 * capacityScale), AdditiveBlending, softTexture('glow')),
    smoke: new ParticleSystem(Math.round(5000 * capacityScale), NormalBlending, softTexture('smoke')),
  };
}
