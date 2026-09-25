import {
  AmbientLight,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import type { Sim } from '@/sim/sim';
import type { Entity } from '@/sim/types';
import { MODEL_FACTORIES, MODEL_SCALE } from './registry';
import { cloaked } from './entities';

/**
 * Retro style (open question: "both" visual directions): sprite-scaling
 * pseudo-3D. At boot every model is pre-rendered into a sprite atlas from a
 * ring of viewing angles — like the pre-drawn sprites of 80s super-scaler
 * arcade boards — and in retro mode entities are drawn as camera-facing
 * billboards that pick the frame matching their orientation to the camera.
 */
const YAWS = 12;
const ELEVS = [0.35, -0.2];
const ROLL_FRAMES = 16;
const PLAYER_MODELS = ['player', 'playerDart', 'playerManta'];
const BIG_MODELS = ['fortress', 'carrier', 'stealth', 'orbital'];

interface SpriteInfo {
  atlas: number; // 0 = small, 1 = big
  base: number; // first cell index
  frames: number;
  size: number; // world-space quad size
  roll: boolean;
}

class Atlas {
  readonly rt: WebGLRenderTarget;
  readonly cols: number;
  next = 0;

  constructor(
    readonly cell: number,
    count: number,
  ) {
    this.cols = Math.ceil(Math.sqrt(count));
    const size = this.cols * cell;
    this.rt = new WebGLRenderTarget(size, size, { depthBuffer: true });
    this.rt.texture.colorSpace = SRGBColorSpace;
    this.rt.texture.magFilter = NearestFilter;
    this.rt.texture.minFilter = NearestFilter;
    this.rt.texture.generateMipmaps = false;
  }
}

export class SpriteBank {
  readonly info = new Map<string, SpriteInfo>();
  readonly atlases: Atlas[];

  constructor(renderer: WebGLRenderer) {
    const keys = Object.keys(MODEL_FACTORIES);
    const small = keys.filter((k) => !BIG_MODELS.includes(k));
    const cellsSmall = small.reduce(
      (n, k) => n + (PLAYER_MODELS.includes(k) ? ROLL_FRAMES : YAWS * ELEVS.length),
      0,
    );
    this.atlases = [new Atlas(64, cellsSmall), new Atlas(192, BIG_MODELS.length * YAWS * ELEVS.length)];
    this.bake(renderer, keys);
  }

  private bake(renderer: WebGLRenderer, keys: string[]): void {
    const scene = new Scene();
    scene.add(new HemisphereLight(0xdfefff, 0x404040, 1.4));
    scene.add(new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.5, 1, 0.6);
    scene.add(sun);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    const holder = new Group();
    scene.add(holder);
    const bodyMat = new MeshLambertMaterial({ vertexColors: true });
    const glowMat = new MeshBasicMaterial({ vertexColors: true });
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.setClearColor(0x000000, 0);
    for (const a of this.atlases) {
      renderer.setRenderTarget(a.rt);
      renderer.clear();
    }

    for (const key of keys) {
      const geo = MODEL_FACTORIES[key]();
      geo.body.computeBoundingSphere();
      const r = (geo.body.boundingSphere?.radius ?? geo.radius) * 1.05;
      holder.clear();
      holder.add(new Mesh(geo.body, bodyMat));
      if (geo.glow) holder.add(new Mesh(geo.glow, glowMat));
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.updateProjectionMatrix();

      const roll = PLAYER_MODELS.includes(key);
      const atlas = this.atlases[BIG_MODELS.includes(key) ? 1 : 0];
      const frames = roll ? ROLL_FRAMES : YAWS * ELEVS.length;
      this.info.set(key, {
        atlas: BIG_MODELS.includes(key) ? 1 : 0,
        base: atlas.next,
        frames,
        size: r * 2 * (MODEL_SCALE[key] ?? 1),
        roll,
      });
      for (let f = 0; f < frames; f++) {
        if (roll) {
          // Seen from behind and slightly above, rolled through 360°.
          holder.rotation.set(0, 0, (f / ROLL_FRAMES) * Math.PI * 2);
          cam.position.set(0, Math.sin(0.2) * 500, Math.cos(0.2) * 500);
        } else {
          holder.rotation.set(0, 0, 0);
          const yaw = ((f % YAWS) / YAWS) * Math.PI * 2;
          const elev = ELEVS[Math.floor(f / YAWS)];
          cam.position.set(
            Math.sin(yaw) * Math.cos(elev) * 500,
            Math.sin(elev) * 500,
            Math.cos(yaw) * Math.cos(elev) * 500,
          );
        }
        cam.lookAt(0, 0, 0);
        const cell = atlas.next++;
        const cx = (cell % atlas.cols) * atlas.cell;
        const cy = Math.floor(cell / atlas.cols) * atlas.cell;
        atlas.rt.viewport.set(cx, cy, atlas.cell, atlas.cell);
        atlas.rt.scissor.set(cx, cy, atlas.cell, atlas.cell);
        atlas.rt.scissorTest = true;
        renderer.setRenderTarget(atlas.rt);
        renderer.render(scene, cam);
      }
      geo.body.dispose();
      geo.glow?.dispose();
    }
    for (const a of this.atlases) {
      a.rt.scissorTest = false;
      a.rt.viewport.set(0, 0, a.rt.width, a.rt.height);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTone;
  }
}

const vertex = /* glsl */ `
  attribute vec3 iCell; // u0, v0, cell size (uv)
  attribute vec2 iData; // world size, flash
  varying vec2 vUv;
  varying float vFlash;
  varying float vDepth;
  void main() {
    vUv = iCell.xy + uv * iCell.z;
    vFlash = iData.y;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * iData.x;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vFlash;
  varying float vDepth;
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.5) discard;
    vec3 col = mix(c.rgb, vec3(4.0), vFlash);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _m = new Matrix4();
const _q = new Quaternion();
const _inv = new Quaternion();
const _p = new Vector3();
const _v = new Vector3();
const ONE = new Vector3(1, 1, 1);

class SpriteBatch {
  readonly mesh: InstancedMesh;
  readonly cells: InstancedBufferAttribute;
  readonly data: InstancedBufferAttribute;
  count = 0;

  constructor(
    readonly atlas: Atlas,
    capacity: number,
  ) {
    const geo = new PlaneGeometry(1, 1);
    this.cells = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.data = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.cells.setUsage(DynamicDrawUsage);
    this.data.setUsage(DynamicDrawUsage);
    geo.setAttribute('iCell', this.cells);
    geo.setAttribute('iData', this.data);
    const mat = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.rt.texture },
        uFogColor: { value: new Color() },
        uFogNear: { value: 800 },
        uFogFar: { value: 6000 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  push(pos: Vector3, cell: number, size: number, flash: number): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const a = this.atlas;
    const i = this.count++;
    _m.compose(pos, _q.identity(), ONE);
    this.mesh.setMatrixAt(i, _m);
    const inv = 1 / a.cols;
    this.cells.setXYZ(i, (cell % a.cols) * inv, Math.floor(cell / a.cols) * inv, inv);
    this.data.setXY(i, size, flash);
  }

  commit(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cells.needsUpdate = true;
    this.data.needsUpdate = true;
    this.count = 0;
  }

  setFog(color: Color, near: number, far: number): void {
    const u = (this.mesh.material as ShaderMaterial).uniforms;
    u.uFogColor.value.copy(color);
    u.uFogNear.value = near;
    u.uFogFar.value = far;
  }
}

/** Draws simulation entities (and the player) as angle-selected sprites. */
export class RetroRenderer {
  readonly group = new Group();
  private readonly batches: SpriteBatch[];

  constructor(private readonly bank: SpriteBank) {
    this.batches = [new SpriteBatch(bank.atlases[0], 512), new SpriteBatch(bank.atlases[1], 4)];
    for (const b of this.batches) this.group.add(b.mesh);
  }

  setFog(color: Color, near: number, far: number): void {
    for (const b of this.batches) b.setFog(color, near, far);
  }

  update(sim: Sim, alpha: number, camera: Camera, playerPos: Vector3, playerVisible: boolean): void {
    for (const e of sim.world.entities) {
      if (!e.alive || e.kind === 'bullet' || e.kind === 'ebullet' || e.kind === 'flare' || cloaked(e))
        continue;
      this.pushEntity(e, alpha, camera);
    }
    // Player: roll frames seen from behind.
    const p = sim.player;
    if (playerVisible) {
      const info = this.bank.info.get(p.e.model);
      if (info) {
        const roll = p.bank + p.rollAngle;
        const f =
          ((Math.round((roll / (Math.PI * 2)) * ROLL_FRAMES) % ROLL_FRAMES) + ROLL_FRAMES) % ROLL_FRAMES;
        this.batches[info.atlas].push(playerPos, info.base + f, info.size, 0);
      }
    }
    for (const b of this.batches) b.commit();
  }

  private pushEntity(e: Entity, alpha: number, camera: Camera): void {
    const info = this.bank.info.get(e.model);
    if (!info) return;
    _p.lerpVectors(e.prev, e.pos, alpha);
    _inv.slerpQuaternions(e.prevRot, e.rot, alpha).invert();
    _v.subVectors(camera.position, _p).applyQuaternion(_inv).normalize();
    const yaw = Math.atan2(_v.x, _v.z);
    const yi = ((Math.round((yaw / (Math.PI * 2)) * YAWS) % YAWS) + YAWS) % YAWS;
    const row = _v.y > 0.05 ? 0 : 1;
    this.batches[info.atlas].push(_p, info.base + row * YAWS + yi, info.size, e.hitFlash > 0 ? 0.8 : 0);
  }
}
