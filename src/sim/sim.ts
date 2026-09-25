import { Vector3 } from 'three';
import { EventBus } from '@/core/events';
import { Pool, World } from '@/core/ecs';
import { Rng } from '@/core/rng';
import { TICK_DT } from '@/core/loop';
import { SpatialHash, sweptSpheres } from './collision';
import { Director } from './director';
import { Rail, type RailSample } from './rail';
import { ScoreKeeper } from './score';
import { tuning } from './tuning';
import { createPlayer, damagePlayer, isPlayerImmune, updatePlayer, type PlayerState } from './player';
import { updatePlayerWeapons, updateMissile } from './weapons';
import { updateEnemies } from './enemies';
import { onBossPartDestroyed, syncBossParts, updateBosses } from './boss';
import type { StageDef } from './defs';
import {
  createEntity,
  EMPTY_INPUT,
  type Entity,
  type EntityKind,
  type InputFrame,
  type Motion,
  type SimEvents,
} from './types';

export type SimState = 'playing' | 'cleared' | 'gameover';

export interface Cheats {
  invincible: boolean;
  infiniteMissiles: boolean;
}

/**
 * The headless game simulation. Owns all gameplay state; advances only through
 * step(input) at a fixed tick, so the same seed + input log reproduces a run.
 * No rendering or DOM access happens here.
 */
export class Sim {
  readonly events = new EventBus<SimEvents>();
  readonly world = new World<Entity>();
  private readonly pool = new Pool<Entity>();
  readonly rng: Rng;
  readonly score: ScoreKeeper;
  readonly player: PlayerState;
  readonly cheats: Cheats = { invincible: false, infiniteMissiles: false };

  readonly enemies = this.world.query((e) => e.kind === 'enemy');
  readonly targets = this.world.query(
    (e) => e.kind === 'enemy' || e.kind === 'bossPart' || e.kind === 'emissile',
  );
  readonly playerShots = this.world.query((e) => e.kind === 'bullet' || e.kind === 'missile');
  readonly enemyShots = this.world.query((e) => e.kind === 'ebullet' || e.kind === 'emissile');
  readonly missiles = this.world.query((e) => e.kind === 'missile' || e.kind === 'emissile');
  readonly bosses = this.world.query((e) => e.kind === 'boss');
  readonly bossParts = this.world.query((e) => e.kind === 'bossPart');

  tick = 0;
  time = 0;
  state: SimState = 'playing';
  stage: StageDef | null = null;
  director: Director | null = null;
  rail = new Rail([[0, 0, 120]]);
  /** Distance travelled along the rail this stage. */
  dist = 0;
  prevDist = 0;
  readonly railNow: RailSample = { x: 0, y: 120 };
  readonly railPrev: RailSample = { x: 0, y: 120 };
  /** Base forward speed for the stage (units/s) and scripted multiplier. */
  cruise = 320;
  cruiseScale = 1;
  /** Actual forward speed including throttle. */
  speed = 320;
  /** Remaining frozen ticks (hit-stop). */
  hitStop = 0;
  /** Number of enemy missiles currently tracking the player. */
  threats = 0;

  input: InputFrame = EMPTY_INPUT;
  prevButtons = 0;

  private readonly hash = new SpatialHash<Entity>(160);
  private readonly railDelta = new Vector3();

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.score = new ScoreKeeper(tuning.player.lives);
    this.player = createPlayer();
  }

  get cruiseSpeed(): number {
    return this.cruise * this.cruiseScale;
  }

  loadStage(def: StageDef): void {
    this.clearWorld();
    this.stage = def;
    this.director = new Director(def);
    this.rail = new Rail(def.rail);
    this.dist = 0;
    this.prevDist = 0;
    this.rail.sample(0, this.railNow);
    this.rail.sample(0, this.railPrev);
    this.cruise = def.cruise;
    this.cruiseScale = 1;
    this.speed = def.cruise;
    this.state = 'playing';
    this.score.resetStage();
    const p = this.player;
    p.missiles = tuning.missile.ammo;
    p.armor = tuning.player.armor;
    p.locks.length = 0;
    p.volley.length = 0;
    if (!p.dead) {
      p.e.pos.set(0, 0, 0);
      p.e.prev.set(0, 0, 0);
      p.e.vel.set(0, 0, 0);
    }
    this.events.emit('stageStart', { index: def.index, name: def.name });
  }

  /** Advances the simulation by one fixed tick. */
  step(input: InputFrame): void {
    this.input = input;
    const dt = TICK_DT;
    if (this.hitStop > 0) {
      this.hitStop--;
      this.prevButtons = input.buttons;
      return;
    }

    for (const e of this.world.entities) {
      e.prev.copy(e.pos);
      e.prevRot.copy(e.rot);
    }
    this.prevDist = this.dist;
    this.railPrev.x = this.railNow.x;
    this.railPrev.y = this.railNow.y;

    if (this.state === 'playing') this.director?.update(this, dt);

    updatePlayer(this, input, dt);
    this.speed = this.cruiseSpeed * this.player.speedFactor;
    this.dist += this.speed * dt;
    this.rail.sample(this.dist, this.railNow);
    this.railDelta.set(
      this.railNow.x - this.railPrev.x,
      this.railNow.y - this.railPrev.y,
      -(this.dist - this.prevDist),
    );

    updatePlayerWeapons(this, input, dt);
    updateEnemies(this, dt);
    updateBosses(this, dt);
    this.threats = 0;
    for (const m of this.missiles.items) {
      if (!m.alive) continue;
      updateMissile(this, m, dt);
      if (m.kind === 'emissile' && m.missile!.tracking) this.threats++;
    }

    this.integrate(dt);
    syncBossParts(this);
    this.collide();
    this.score.update(dt);

    this.world.flush((e) => this.recycle(e));
    this.prevButtons = input.buttons;
    this.tick++;
    this.time += dt;
  }

  spawn(kind: EntityKind, model: string, motion: Motion): Entity {
    const e = this.pool.acquire(kind, () => createEntity(kind, model, motion));
    e.model = model;
    e.motion = motion;
    e.age = 0;
    e.life = 0;
    e.hp = 1;
    e.maxHp = 1;
    e.hitFlash = 0;
    e.lockable = false;
    e.locks = 0;
    e.killed = false;
    e.radius = 1;
    e.pos.set(0, 0, 0);
    e.prev.set(0, 0, 0);
    e.vel.set(0, 0, 0);
    e.rot.identity();
    e.prevRot.identity();
    return this.world.add(e);
  }

  /** Velocity of an entity relative to the player frame this tick. */
  frameVelocity(e: Entity, out: Vector3): Vector3 {
    out.copy(e.vel);
    if (e.motion === 'air') out.z += this.speed - this.cruiseSpeed;
    else if (e.motion === 'ground') out.addScaledVector(this.railDelta, -1 / TICK_DT);
    return out;
  }

  /** Applies damage from the player to a target; handles kills and scoring. */
  damage(target: Entity, amount: number): void {
    if (!target.alive) return;
    const part = target.bossPart;
    if (part && part.phase !== part.boss.boss!.phase) {
      this.events.emit('hit', { target, x: target.pos.x, y: target.pos.y, z: target.pos.z, armored: true });
      return;
    }
    target.hp -= amount;
    target.hitFlash = 0.08;
    this.events.emit('hit', { target, x: target.pos.x, y: target.pos.y, z: target.pos.z, armored: false });
    if (target.hp <= 0) this.kill(target);
  }

  kill(target: Entity): void {
    if (!target.alive) return;
    let base = 500;
    let size: SimEvents['kill']['size'] = 'small';
    if (target.enemy) {
      base = target.enemy.def.score;
      size = target.enemy.def.size;
      this.score.stats.kills++;
    } else if (target.bossPart) {
      base = 30000;
      size = 'large';
      this.hitStop = 4;
    } else if (target.boss) {
      base = 300000;
      size = 'huge';
    }
    const { points, multiplier } = this.score.kill(base);
    this.addScore(points);
    target.killed = true;
    this.events.emit('kill', {
      target,
      x: target.pos.x,
      y: target.pos.y,
      z: target.pos.z,
      score: points,
      multiplier,
      size,
    });
    this.world.remove(target);
    if (target.bossPart) onBossPartDestroyed(this, target);
  }

  addScore(points: number): void {
    const earned = this.score.add(points);
    for (let i = 0; i < earned; i++) this.events.emit('extraLife', { lives: this.score.lives });
  }

  /** Called by the director when the stage objective is complete. */
  clearStage(): void {
    if (this.state !== 'playing') return;
    this.state = 'cleared';
    const bonus = this.score.stageBonus();
    this.addScore(bonus.total);
    this.events.emit('stageClear', { stats: { ...this.score.stats }, bonus });
  }

  /** Removes every entity without scoring (stage load, debug jumps). */
  clearWorld(filter?: (e: Entity) => boolean): void {
    for (const e of this.world.entities) if (!filter || filter(e)) this.world.remove(e);
    this.world.flush((e) => this.recycle(e));
  }

  private recycle(e: Entity): void {
    if (e.missile) e.missile.target = null;
    this.pool.release(e.kind, e);
  }

  private integrate(dt: number): void {
    const dz = this.speed - this.cruiseSpeed;
    const rd = this.railDelta;
    for (const e of this.world.entities) {
      if (!e.alive) continue;
      e.age += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      switch (e.motion) {
        case 'player':
          e.pos.addScaledVector(e.vel, dt);
          break;
        case 'air':
          e.pos.x += e.vel.x * dt;
          e.pos.y += e.vel.y * dt;
          e.pos.z += (e.vel.z + dz) * dt;
          break;
        case 'ground':
          e.pos.addScaledVector(e.vel, dt).sub(rd);
          break;
      }
      if (e.life > 0 && e.age >= e.life) {
        this.world.remove(e);
        continue;
      }
      const p = e.pos;
      if (p.z > 900 || p.z < -3700 || p.x > 2200 || p.x < -2200 || p.y > 1600 || p.y < -800) {
        if (e.kind !== 'boss' && e.kind !== 'bossPart') this.world.remove(e);
      }
    }
  }

  private collide(): void {
    const hash = this.hash;
    hash.clear();
    for (const t of this.targets.items) if (t.alive) hash.insert(t);

    // Player projectiles vs targets (swept, so nothing tunnels).
    const pad = 60;
    for (const s of this.playerShots.items) {
      if (!s.alive) continue;
      const isMissile = s.kind === 'missile';
      const lockTarget = isMissile ? s.missile!.target : null;
      const extra = isMissile ? tuning.missile.fuse : 1.5;
      const cands = hash.queryBox(
        Math.min(s.prev.x, s.pos.x) - pad,
        Math.min(s.prev.y, s.pos.y) - pad,
        Math.min(s.prev.z, s.pos.z) - pad,
        Math.max(s.prev.x, s.pos.x) + pad,
        Math.max(s.prev.y, s.pos.y) + pad,
        Math.max(s.prev.z, s.pos.z) + pad,
      );
      let best: Entity | null = null;
      let bestT = 2;
      for (const c of cands) {
        if (!c.alive) continue;
        if (isMissile && c.kind === 'emissile') continue;
        if (lockTarget && c !== lockTarget) continue;
        const t = sweptSpheres(s.prev, s.pos, c.prev, c.pos, c.radius + extra);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = c;
        }
      }
      if (!best) continue;
      this.world.remove(s);
      if (isMissile) {
        this.damage(best, s.missile!.damage);
      } else {
        this.score.stats.shotsHit++;
        this.damage(best, s.shot!.damage);
      }
    }

    const p = this.player;
    if (p.dead) return;
    const pe = p.e;
    const immune = isPlayerImmune(this);

    // Enemy projectiles vs player.
    for (const s of this.enemyShots.items) {
      if (!s.alive) continue;
      const t = sweptSpheres(s.prev, s.pos, pe.prev, pe.pos, s.radius + tuning.player.radius);
      if (t < 0 || immune) continue;
      this.world.remove(s);
      damagePlayer(this, s.kind === 'emissile' ? 2 : 1);
      if (p.dead) return;
    }

    // Enemy bodies vs player.
    for (const e of this.enemies.items) {
      if (!e.alive) continue;
      const t = sweptSpheres(e.prev, e.pos, pe.prev, pe.pos, e.radius * 0.8 + tuning.player.radius);
      if (t < 0 || immune) continue;
      this.damage(e, 20);
      damagePlayer(this, tuning.player.armor);
      if (p.dead) return;
    }
  }

  /** Compact state fingerprint for determinism tests. */
  stateHash(): string {
    const pe = this.player.e.pos;
    let h = `${this.tick}|${this.score.score}|${this.score.lives}|${this.rng.state}|${this.world.entities.length}|`;
    h += `${pe.x.toFixed(4)},${pe.y.toFixed(4)}|${this.dist.toFixed(3)}`;
    for (const e of this.world.entities) h += `|${e.kind[0]}${e.pos.x.toFixed(2)},${e.pos.z.toFixed(2)}`;
    return h;
  }
}
