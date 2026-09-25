import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import { Pool, World } from '../core/ecs';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/loop';
import { SpatialHash, sweptSpheres } from './collision';
import { Director } from './director';
import { Rail, type RailSample } from './rail';
import { ScoreKeeper } from './score';
import { tuning } from './tuning';
import {
  createPlayer,
  damagePlayer,
  isPlayerImmune,
  LOOP_DURATION,
  updatePlayer,
  type PlayerState,
} from './player';
import { updatePlayerWeapons, updateMissile } from './weapons';
import { updateEnemies } from './enemies';
import { bossScore, isCloaked, onBossPartDestroyed, syncBossParts, updateBosses } from './boss';
import { approach, clamp } from './math';
import {
  DIFFICULTY,
  JETS,
  type Difficulty,
  type DifficultyDef,
  type JetDef,
  type JetId,
  type StageDef,
} from './defs';
import {
  createEntity,
  EMPTY_INPUT,
  type Entity,
  type EntityKind,
  type InputFrame,
  type Motion,
  type SimEvents,
} from './types';

export type SimState = 'playing' | 'cleared' | 'gameover' | 'refuel';

export interface SimOptions {
  difficulty: Difficulty;
  jet: JetId;
  aimAssist: boolean;
  autoFire: boolean;
  /** Ease enemy fire after two deaths in one stage. */
  dynamicDifficulty: boolean;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  difficulty: 'normal',
  jet: 'kestrel',
  aimAssist: false,
  autoFire: false,
  dynamicDifficulty: true,
};

/** Refuel sequence timings (F15). */
const REFUEL = { approach: 3.5, dock: 4, depart: 2.5, bonus: 50000 };

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
  readonly options: SimOptions;
  readonly diff: DifficultyDef;
  readonly jet: JetDef;
  /** Seeded per-stage left/right mirroring of wave layouts (F17). */
  mirror = false;
  /** Refuel sequence state; the tanker is a 'support' entity. */
  refuel: { time: number; tanker: Entity | null; done: boolean } = { time: 0, tanker: null, done: false };

  readonly enemies = this.world.query((e) => e.kind === 'enemy');
  readonly targets = this.world.query(
    (e) => e.kind === 'enemy' || e.kind === 'bossPart' || e.kind === 'emissile',
  );
  readonly playerShots = this.world.query((e) => e.kind === 'bullet' || e.kind === 'missile');
  readonly enemyShots = this.world.query((e) => e.kind === 'ebullet' || e.kind === 'emissile');
  readonly missiles = this.world.query((e) => e.kind === 'missile' || e.kind === 'emissile');
  readonly bosses = this.world.query((e) => e.kind === 'boss');
  readonly bossParts = this.world.query((e) => e.kind === 'bossPart');
  readonly flares = this.world.query((e) => e.kind === 'flare');

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

  constructor(seed = 1, options: Partial<SimOptions> = {}) {
    this.rng = new Rng(seed);
    this.options = { ...DEFAULT_SIM_OPTIONS, ...options };
    this.diff = DIFFICULTY[this.options.difficulty];
    this.jet = JETS[this.options.jet];
    this.score = new ScoreKeeper(tuning.player.lives);
    this.player = createPlayer(this.jet);
  }

  get cruiseSpeed(): number {
    return this.cruise * this.cruiseScale;
  }

  /** Enemy fire-rate multiplier: difficulty plus dynamic easing. */
  get fireRateScale(): number {
    const eased = this.options.dynamicDifficulty && this.score.stats.deaths >= 2 ? 0.8 : 1;
    return this.diff.fireRate * eased * (this.stage?.threat ?? 1);
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
    this.cruise = def.cruise * this.jet.speed;
    this.cruiseScale = 1;
    this.speed = this.cruise;
    this.state = 'playing';
    this.mirror = def.mirror !== false && this.rng.chance(0.5);
    this.score.resetStage();
    const p = this.player;
    // Missiles carry over between stages; the tanker refuel restocks them.
    p.armor = p.maxArmor;
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
    if (this.state === 'refuel') input = this.updateRefuel(dt);

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

  /** Flares (D7): decoy up to three tracking missiles. */
  dropFlares(): void {
    const p = this.player;
    if (p.dead || p.flares <= 0) return;
    p.flares--;
    const decoys: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const f = this.spawn('flare', 'flare', 'air');
      f.pos.copy(p.e.pos);
      f.pos.y -= 2;
      f.prev.copy(f.pos);
      f.vel.set((i - 1) * 70, -45 - i * 10, 60);
      f.life = 2.4;
      decoys.push(f);
    }
    const tracking = this.enemyShots.items
      .filter((m) => m.alive && m.kind === 'emissile' && m.missile!.tracking)
      .sort((a, b) => a.pos.distanceToSquared(p.e.pos) - b.pos.distanceToSquared(p.e.pos))
      .slice(0, 3);
    tracking.forEach((m, i) => {
      m.missile!.tracking = false;
      m.missile!.target = decoys[i];
      m.missile!.targetId = decoys[i].id;
    });
    this.events.emit('flare', { x: p.e.pos.x, y: p.e.pos.y, z: p.e.pos.z, decoyed: tracking.length });
  }

  /** Scripted loop manoeuvre (C5): shakes off tail-chasers, who end up in front. */
  startLoop(): void {
    const p = this.player;
    if (p.dead || p.loopTime >= 0) return;
    p.loopTime = 0;
    p.rollTime = -1;
    p.rollAngle = 0;
    for (const e of this.enemies.items) {
      const s = e.enemy!;
      if (!e.alive || s.spec.behaviour !== 'pursuit' || s.phase >= 3) continue;
      s.phase = 3;
      s.phaseTime = 0;
      e.pos.z = -320 - this.rng.range(0, 260);
      e.pos.y += 25;
      e.prev.copy(e.pos);
      e.vel.z = -40;
    }
    this.events.emit('loop', { duration: LOOP_DURATION });
    this.events.emit('callout', { text: 'Pull up — loop!' });
  }

  /** Tanker refuel (F15): restocks missiles and armour, then awards a bonus. */
  startRefuel(): void {
    this.clearWorld();
    this.state = 'refuel';
    const t = this.spawn('support', 'tanker', 'player');
    t.pos.set(0, 260, -1400);
    t.prev.copy(t.pos);
    this.refuel = { time: 0, tanker: t, done: false };
    this.events.emit('refuelStart', {});
    this.events.emit('callout', { text: 'Tanker ahead. Hold steady for refuelling.' });
  }

  private readonly refuelInput: InputFrame = { x: 0, y: 0, buttons: 0 };

  private updateRefuel(dt: number): InputFrame {
    const r = this.refuel;
    const t = r.tanker!;
    r.time += dt;
    const p = this.player;
    const docked = r.time > REFUEL.approach && r.time < REFUEL.approach + REFUEL.dock;
    if (r.time < REFUEL.approach + REFUEL.dock) {
      // Tanker settles just ahead of and above the jet.
      const k = approach(1.4, dt);
      t.vel.set(((0 - t.pos.x) * k) / dt, ((40 - t.pos.y) * k) / dt, ((-110 - t.pos.z) * k) / dt);
    } else {
      t.vel.y += 60 * dt;
      t.vel.z -= 260 * dt;
    }
    if (docked && this.tick % 2 === 0 && p.missiles < tuning.missile.ammo) p.missiles++;
    if (docked) p.armor = p.maxArmor;
    if (!r.done && r.time >= REFUEL.approach + REFUEL.dock + REFUEL.depart) {
      r.done = true;
      p.missiles = tuning.missile.ammo;
      this.world.remove(t);
      r.tanker = null;
      this.addScore(REFUEL.bonus);
      this.state = 'cleared';
      this.events.emit('refuelDone', { bonus: REFUEL.bonus });
    }
    // Autopilot: centre the jet under the boom.
    const pe = p.e.pos;
    this.refuelInput.x = clamp(-pe.x / 40, -1, 1);
    this.refuelInput.y = clamp(-pe.y / 30, -1, 1);
    this.refuelInput.buttons = 0;
    return this.refuelInput;
  }

  /** Applies damage from the player to a target; handles kills and scoring. */
  damage(target: Entity, amount: number): void {
    if (!target.alive) return;
    const part = target.bossPart;
    if (part && (part.phase !== part.boss.boss!.phase || isCloaked(part.boss))) {
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
      base = bossScore(target);
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
        // Surface targets are missile-only (D10).
        if (!isMissile && c.layer === 'surface') continue;
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
      if (!e.alive || e.layer === 'surface') continue;
      const t = sweptSpheres(e.prev, e.pos, pe.prev, pe.pos, e.radius * 0.8 + tuning.player.radius);
      if (t < 0 || immune) continue;
      this.damage(e, 20);
      damagePlayer(this, p.maxArmor);
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
