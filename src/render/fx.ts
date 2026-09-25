import { Color, Vector3 } from 'three';
import { Rng } from '@/core/rng';
import type { Sim } from '@/sim/sim';
import type { KillSize } from '@/sim/types';
import type { EmitParams, ParticleSystem } from './particles';
import type { CameraRig } from './camera';
import type { PostFX } from './post';

/**
 * Event-driven visual effects (D8 + VFX): explosions, sparks, muzzle flashes,
 * missile trails and afterburner exhaust, all built from the two particle pools.
 * Uses its own RNG so cosmetic randomness never touches simulation determinism.
 */
const C = {
  white: new Color(3, 3, 3),
  flash: new Color(4, 3.2, 2.2),
  fire0: new Color(3.2, 1.8, 0.6),
  fire1: new Color(0.9, 0.18, 0.04),
  spark0: new Color(3, 2.6, 1.6),
  spark1: new Color(1.4, 0.5, 0.1),
  smoke0: new Color(0.32, 0.3, 0.3),
  smoke1: new Color(0.18, 0.18, 0.2),
  lightSmoke0: new Color(0.85, 0.85, 0.88),
  lightSmoke1: new Color(0.6, 0.62, 0.66),
  cyan: new Color(1.2, 2.8, 3.6),
  cyanDim: new Color(0.1, 0.4, 0.8),
  muzzle: new Color(2.2, 3.0, 3.4),
  enemyTrail0: new Color(3.5, 1.2, 0.2),
  enemyTrail1: new Color(0.8, 0.12, 0.02),
  afterburn0: new Color(1.6, 1.6, 3.4),
  afterburn1: new Color(0.9, 0.3, 0.1),
  vapor: new Color(0.9, 0.95, 1),
};

const SIZE_SCALE: Record<KillSize, number> = { small: 0.7, medium: 1, large: 1.8, huge: 4 };

const _v = new Vector3();

export class Fx {
  private readonly rng = new Rng(4242);
  private readonly p: EmitParams = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    color0: C.white,
    color1: C.white,
  };
  private offs: (() => void)[] = [];
  flashes = true;

  constructor(
    private readonly fx: ParticleSystem,
    private readonly smoke: ParticleSystem,
    private readonly rig: CameraRig,
    private readonly post: PostFX,
  ) {}

  bind(sim: Sim): void {
    this.unbind();
    const ev = sim.events;
    this.offs.push(
      ev.on('vulcan', (e) => this.muzzle(e.x, e.y, e.z)),
      ev.on('hit', (e) => this.sparks(e.x, e.y, e.z, e.armored ? 10 : 5, e.armored)),
      ev.on('kill', (e) => {
        sim.frameVelocity(e.target, _v);
        this.explode(e.x, e.y, e.z, e.size, _v);
        this.shakeFor(e.z, e.size);
      }),
      ev.on('explosion', (e) => {
        this.explode(e.x, e.y, e.z, e.size, _v.set(0, 0, 0));
        this.rig.addTrauma(0.15);
      }),
      ev.on('playerHit', () => {
        const pe = sim.player.e.pos;
        this.sparks(pe.x, pe.y, pe.z, 16, true);
        this.rig.addTrauma(0.55);
        if (this.flashes) this.post.flashScreen(1, 0.1, 0.05, 0.35, 2.5);
      }),
      ev.on('playerDeath', (e) => {
        this.explode(e.x, e.y, e.z, 'large', _v.set(0, 0, 0));
        this.rig.addTrauma(1);
        if (this.flashes) this.post.flashScreen(1, 0.8, 0.6, 0.6, 1.5);
      }),
      ev.on('bossDefeated', (e) => {
        this.explode(e.x, e.y, e.z, 'huge', _v.set(0, 0, 0));
        this.rig.addTrauma(1);
        if (this.flashes) this.post.flashScreen(1, 1, 1, 0.9, 0.8);
      }),
      ev.on('missileFire', (e) => {
        const m = e.missile.pos;
        for (let i = 0; i < 4; i++)
          this.puff(
            this.smoke,
            m.x,
            m.y,
            m.z,
            this.rng.range(-20, 20),
            this.rng.range(-10, 10),
            this.rng.range(0, 40),
            0.7,
            5,
            14,
            C.lightSmoke0,
            C.lightSmoke1,
            0.5,
          );
      }),
      ev.on('roll', () => {
        const pe = sim.player.e.pos;
        for (const side of [-1, 1])
          for (let i = 0; i < 6; i++)
            this.puff(
              this.smoke,
              pe.x + side * 8,
              pe.y,
              pe.z + i * 3,
              0,
              0,
              60,
              0.5,
              2,
              6,
              C.vapor,
              C.vapor,
              0.35,
              0,
            );
      }),
    );
  }

  unbind(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  /** Continuous per-frame emitters: trails, afterburner, damage smoke. */
  frame(sim: Sim, alpha: number, dt: number, playerPos: Vector3): void {
    const n = Math.min(3, Math.max(1, Math.round(dt * 90)));
    // Flares: blinding magnesium sparks with a smoke tail.
    for (const f of sim.flares.items) {
      if (!f.alive) continue;
      _v.lerpVectors(f.prev, f.pos, alpha);
      this.puff(this.fx, _v.x, _v.y, _v.z, 0, 0, 0, 0.12, 14, 4, C.flash, C.fire0, 1, 0);
      this.puff(this.smoke, _v.x, _v.y, _v.z, 0, 4, 0, 1.4, 3, 12, C.lightSmoke0, C.lightSmoke1, 0.4);
    }
    for (const m of sim.missiles.items) {
      if (!m.alive) continue;
      _v.lerpVectors(m.prev, m.pos, alpha);
      const enemy = m.kind === 'emissile';
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const x = _v.x - m.vel.x * dt * t;
        const y = _v.y - m.vel.y * dt * t;
        const z = _v.z - m.vel.z * dt * t;
        this.puff(
          this.smoke,
          x,
          y,
          z,
          0,
          0,
          0,
          enemy ? 1.1 : 0.9,
          3,
          11,
          enemy ? C.smoke0 : C.lightSmoke0,
          enemy ? C.smoke1 : C.lightSmoke1,
          0.45,
        );
        this.puff(
          this.fx,
          x,
          y,
          z,
          0,
          0,
          0,
          0.08,
          5,
          1,
          enemy ? C.enemyTrail0 : C.cyan,
          enemy ? C.enemyTrail1 : C.cyanDim,
          1,
        );
      }
    }
    const p = sim.player;
    if (!p.dead) {
      const boost = Math.max(0, (p.speedFactor - 1) / 0.6);
      if (boost > 0.2 && this.rng.chance(0.9 * this.fx.density)) {
        for (const side of [-0.85, 0.85]) {
          _v.set(side, 0, 6.5).applyQuaternion(p.e.rot).add(playerPos);
          this.puff(
            this.fx,
            _v.x,
            _v.y,
            _v.z,
            this.rng.range(-6, 6),
            this.rng.range(-6, 6),
            180,
            0.18,
            4 + boost * 3,
            1,
            C.afterburn0,
            C.afterburn1,
            0.8,
            0,
          );
        }
      }
      if (p.armor <= 1 && this.rng.chance(0.6)) {
        this.puff(
          this.smoke,
          playerPos.x,
          playerPos.y + 1,
          playerPos.z + 5,
          0,
          8,
          50,
          1,
          3,
          12,
          C.smoke0,
          C.smoke1,
          0.55,
        );
      }
      // Wingtip vapour when pulling hard.
      if (Math.abs(p.stickX) > 0.85 || Math.abs(p.stickY) > 0.85) {
        for (const side of [-1, 1]) {
          _v.set(side * 8.2, -0.1, 3.5)
            .applyQuaternion(p.e.rot)
            .add(playerPos);
          this.puff(this.smoke, _v.x, _v.y, _v.z, 0, 0, 0, 0.35, 0.8, 2.2, C.vapor, C.vapor, 0.4);
        }
      }
    }
  }

  private shakeFor(z: number, size: KillSize): void {
    const near = Math.max(0, 1 - Math.abs(z) / 900);
    this.rig.addTrauma(near * 0.25 * SIZE_SCALE[size]);
  }

  private muzzle(x: number, y: number, z: number): void {
    this.puff(this.fx, x, y, z, 0, 0, 0, 0.05, 7, 3, C.muzzle, C.cyanDim, 0.9, 0);
  }

  private sparks(x: number, y: number, z: number, count: number, hot: boolean): void {
    const r = this.rng;
    const n = Math.ceil(count * this.fx.density);
    for (let i = 0; i < n; i++) {
      this.puff(
        this.fx,
        x,
        y,
        z,
        r.range(-160, 160),
        r.range(-120, 160),
        r.range(-160, 160),
        r.range(0.15, 0.35),
        hot ? 3 : 2.2,
        0.5,
        C.spark0,
        C.spark1,
        1,
        1,
        3,
        200,
      );
    }
  }

  explode(x: number, y: number, z: number, size: KillSize, vel: Vector3): void {
    const s = SIZE_SCALE[size];
    const r = this.rng;
    const d = this.fx.density;
    const vx = vel.x * 0.35;
    const vy = vel.y * 0.35;
    const vz = vel.z * 0.35;
    // Initial flash
    this.puff(this.fx, x, y, z, vx, vy, vz, 0.18, 30 * s, 60 * s, C.flash, C.fire0, 1, 1, 2);
    // Fireballs
    const fire = Math.ceil(10 * s * d);
    for (let i = 0; i < fire; i++) {
      this.puff(
        this.fx,
        x + r.range(-4, 4) * s,
        y + r.range(-4, 4) * s,
        z + r.range(-4, 4) * s,
        vx + r.range(-70, 70) * s,
        vy + r.range(-50, 80) * s,
        vz + r.range(-70, 70) * s,
        r.range(0.35, 0.8) * Math.sqrt(s),
        r.range(10, 18) * s,
        r.range(18, 34) * s,
        C.fire0,
        C.fire1,
        1,
        1,
        3.5,
      );
    }
    // Sparks / debris
    const sparks = Math.ceil(14 * s * d);
    for (let i = 0; i < sparks; i++) {
      this.puff(
        this.fx,
        x,
        y,
        z,
        vx + r.range(-320, 320),
        vy + r.range(-200, 320),
        vz + r.range(-320, 320),
        r.range(0.4, 1.1),
        2.5 * Math.min(2, s),
        0.6,
        C.spark0,
        C.spark1,
        1,
        1,
        1.4,
        260,
      );
    }
    // Smoke
    const smoke = Math.ceil(8 * s * d);
    for (let i = 0; i < smoke; i++) {
      this.puff(
        this.smoke,
        x + r.range(-8, 8) * s,
        y + r.range(-6, 6) * s,
        z + r.range(-8, 8) * s,
        vx + r.range(-40, 40) * s,
        vy + r.range(5, 60),
        vz + r.range(-40, 40) * s,
        r.range(1.2, 2.4) * Math.sqrt(s),
        r.range(10, 16) * s,
        r.range(30, 55) * s,
        C.smoke0,
        C.smoke1,
        0.55,
        1,
        1.6,
      );
    }
  }

  private puff(
    sys: ParticleSystem,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    color0: Color,
    color1: Color,
    alpha: number,
    anchor = 1,
    drag = 0,
    gravity = 0,
  ): void {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.color0 = color0;
    p.color1 = color1;
    p.alpha = alpha;
    p.anchor = anchor;
    p.drag = drag;
    p.gravity = gravity;
    sys.emit(p);
  }
}
