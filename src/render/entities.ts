import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import type { Sim } from '@/sim/sim';
import type { Entity } from '@/sim/types';
import { MODEL_FACTORIES, enemyBullet, playerBullet, type ModelGeo } from './models';

/**
 * Instanced rendering (B8): one InstancedMesh (plus an optional unlit "glow"
 * sibling sharing the same instance matrices) per model type, rebuilt every
 * frame from interpolated simulation state.
 */
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _m = new Matrix4();
const _dir = new Vector3();
const WHITE = new Color(1, 1, 1);
const FLASH = new Color(5, 5, 5);
const Z = new Vector3(0, 0, 1);

class InstancedModel {
  readonly body: InstancedMesh;
  readonly glow?: InstancedMesh;
  count = 0;

  constructor(geo: ModelGeo, capacity: number, bodyMat: MeshStandardMaterial, glowMat: MeshBasicMaterial) {
    this.body = new InstancedMesh(geo.body, bodyMat, capacity);
    this.body.instanceMatrix.setUsage(DynamicDrawUsage);
    this.body.setColorAt(0, WHITE);
    this.body.frustumCulled = false;
    this.body.count = 0;
    if (geo.glow) {
      this.glow = new InstancedMesh(geo.glow, glowMat, capacity);
      this.glow.instanceMatrix = this.body.instanceMatrix;
      this.glow.frustumCulled = false;
      this.glow.count = 0;
    }
  }

  push(m: Matrix4, color: Color): void {
    if (this.count >= this.body.instanceMatrix.count) return;
    this.body.setMatrixAt(this.count, m);
    this.body.setColorAt(this.count, color);
    this.count++;
  }

  commit(): void {
    this.body.count = this.count;
    this.body.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.glow) this.glow.count = this.count;
    this.count = 0;
  }
}

/** Render-only scale so small silhouettes stay readable at arcade speed. */
const MODEL_SCALE: Record<string, number> = {
  fighter: 1.7,
  chaser: 1.6,
  drone: 1.8,
  ace: 1.7,
  missile: 1.3,
  emissile: 1.6,
};

const CAPACITY: Record<string, number> = {
  fighter: 48,
  chaser: 24,
  drone: 96,
  ace: 8,
  missile: 64,
  emissile: 48,
  fortress: 1,
  bossTurret: 8,
  bossEngine: 4,
  bossCore: 2,
};

export class EntityRenderer {
  readonly group = new Group();
  private readonly models = new Map<string, InstancedModel>();
  private readonly bullets: InstancedMesh;
  private readonly ebullets: InstancedMesh;
  private readonly ebulletHalo: InstancedMesh;
  readonly bodyMat: MeshStandardMaterial;
  private nb = 0;
  private ne = 0;

  constructor() {
    this.bodyMat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5 });
    const glowMat = new MeshBasicMaterial({ vertexColors: true, color: new Color(2.6, 2.6, 2.6) });
    for (const [key, cap] of Object.entries(CAPACITY)) {
      const model = new InstancedModel(MODEL_FACTORIES[key](), cap, this.bodyMat, glowMat);
      this.models.set(key, model);
      this.group.add(model.body);
      if (model.glow) this.group.add(model.glow);
    }
    // Player shots: cool colours. Enemy shots: the one reserved warm colour.
    this.bullets = new InstancedMesh(
      playerBullet(),
      new MeshBasicMaterial({ color: new Color(1.2, 3.2, 4.0) }),
      256,
    );
    this.ebullets = new InstancedMesh(
      enemyBullet(),
      new MeshBasicMaterial({ color: new Color(4.0, 1.3, 0.25) }),
      512,
    );
    this.ebulletHalo = new InstancedMesh(
      enemyBullet(),
      new MeshBasicMaterial({
        color: new Color(1.0, 0.25, 0.05),
        transparent: true,
        opacity: 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      512,
    );
    for (const m of [this.bullets, this.ebullets, this.ebulletHalo]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
  }

  setEnvMap(tex: Texture | null): void {
    this.bodyMat.envMap = tex;
    this.bodyMat.envMapIntensity = 0.9;
    this.bodyMat.needsUpdate = true;
  }

  update(sim: Sim, alpha: number): void {
    this.nb = 0;
    this.ne = 0;
    for (const e of sim.world.entities) {
      if (!e.alive) continue;
      if (e.kind === 'bullet') this.pushBullet(e, alpha, false);
      else if (e.kind === 'ebullet') this.pushBullet(e, alpha, true);
      else {
        const model = this.models.get(e.model);
        if (!model) continue;
        interpolate(e, alpha, _p, _q);
        const k = MODEL_SCALE[e.model] ?? 1;
        _s.set(k, k, k);
        _m.compose(_p, _q, _s);
        model.push(_m, e.hitFlash > 0 ? FLASH : WHITE);
      }
    }
    for (const m of this.models.values()) m.commit();
    this.bullets.count = this.nb;
    this.bullets.instanceMatrix.needsUpdate = true;
    this.ebullets.count = this.ne;
    this.ebullets.instanceMatrix.needsUpdate = true;
    this.ebulletHalo.count = this.ne;
    this.ebulletHalo.instanceMatrix.needsUpdate = true;
  }

  private pushBullet(e: Entity, alpha: number, enemy: boolean): void {
    _p.lerpVectors(e.prev, e.pos, alpha);
    if (enemy) {
      if (this.ne >= 512) return;
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      this.ebullets.setMatrixAt(this.ne, _m);
      _s.set(2.2, 2.2, 2.2);
      _m.compose(_p, _q, _s);
      this.ebulletHalo.setMatrixAt(this.ne, _m);
      this.ne++;
    } else {
      if (this.nb >= 256) return;
      _dir.copy(e.vel).normalize();
      _q.setFromUnitVectors(Z, _dir);
      // Fade in the tracer length for the first frames so it starts at the nose.
      const len = Math.min(1, e.age / 0.05 + 0.2);
      _s.set(1, 1, len);
      _m.compose(_p, _q, _s);
      this.bullets.setMatrixAt(this.nb++, _m);
    }
  }
}

export function interpolate(e: Entity, alpha: number, pos: Vector3, rot: Quaternion): void {
  pos.lerpVectors(e.prev, e.pos, alpha);
  rot.slerpQuaternions(e.prevRot, e.rot, alpha);
}

// ------------------------------------------------------------------ player
const flameVertex = /* glsl */ `
  varying float vT;
  void main() {
    vT = 1.0 - uv.y; // 1 at the nozzle (cone base)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const flameFragment = /* glsl */ `
  uniform float uPower;
  uniform float uTime;
  varying float vT;
  void main() {
    float t = vT; // 1 at nozzle, 0 at tip
    float flick = 0.85 + 0.15 * sin(uTime * 90.0 + t * 20.0);
    vec3 core = vec3(1.0, 0.95, 0.85);
    vec3 outer = mix(vec3(1.0, 0.45, 0.1), vec3(0.35, 0.55, 1.0), uPower);
    vec3 col = mix(outer, core, smoothstep(0.55, 1.0, t)) * (1.5 + 2.5 * uPower);
    float a = pow(t, 1.4) * flick;
    gl_FragColor = vec4(col * a, a);
  }
`;

/** The player's jet: a regular mesh group with afterburner flames. */
export class PlayerView {
  readonly group = new Group();
  private readonly flames: Mesh[] = [];
  private readonly flameMat: ShaderMaterial;
  private readonly body: Mesh;

  constructor(bodyMat: MeshStandardMaterial) {
    const geo = MODEL_FACTORIES.player();
    this.body = new Mesh(geo.body, bodyMat);
    this.group.add(this.body);
    if (geo.glow)
      this.group.add(
        new Mesh(geo.glow, new MeshBasicMaterial({ vertexColors: true, color: new Color(2.4, 2.4, 2.4) })),
      );
    this.flameMat = new ShaderMaterial({
      uniforms: { uPower: { value: 0 }, uTime: { value: 0 } },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const flameGeo = new ConeGeometry(0.75, 1, 10, 1, true);
    flameGeo.translate(0, 0.5, 0);
    flameGeo.rotateX(Math.PI / 2); // base at the nozzle, tip toward +Z (behind the jet)
    for (const x of [-0.85, 0.85]) {
      const f = new Mesh(flameGeo, this.flameMat);
      f.position.set(x, -0.05, 5.95);
      f.frustumCulled = false;
      this.flames.push(f);
      this.group.add(f);
    }
  }

  update(sim: Sim, alpha: number, time: number): void {
    const p = sim.player;
    interpolate(p.e, alpha, this.group.position, this.group.quaternion);
    const blink = p.invuln > 0 && Math.floor(time * 14) % 2 === 0;
    this.group.visible = !p.dead && !blink;
    const power = Math.max(0, Math.min(1, (p.speedFactor - 1) / 0.6));
    const brake = Math.max(0, Math.min(1, (1 - p.speedFactor) / 0.4));
    const len = 3.2 + power * 9 - brake * 2.2 + Math.sin(time * 70) * 0.3;
    for (const f of this.flames) f.scale.set(1 + power * 0.25, 1 + power * 0.25, Math.max(0.6, len));
    this.flameMat.uniforms.uPower.value = power;
    this.flameMat.uniforms.uTime.value = time;
  }
}
