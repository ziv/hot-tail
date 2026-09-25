import { Vector3 } from 'three';
import { dcos, dsin } from '../core/dmath';
import { approach, clamp, quatFromEuler } from './math';
import { fireAt, spawnEnemy } from './enemies';
import type { FireSpec } from './defs';
import type { BossPartState, Entity } from './types';
import type { Sim } from './sim';

/**
 * Boss framework (F10): a boss is a hull entity plus part entities (weak
 * points) riding on it. Parts are armoured until their phase is active;
 * destroying every part of a phase advances it. Bosses are data (BossDef):
 * Boss 1 "Leviathan" flying fortress (F11), Boss 2 carrier group (F12),
 * Boss 3 stealth ace (F13) and Boss 4 orbital platform (F14).
 */
interface PartDef {
  role: BossPartState['role'];
  model: string;
  offset: [number, number, number];
  hp: number;
  radius: number;
  phase: number;
  /** Fire options; one is picked at random each time the part fires. */
  fire: FireSpec[];
  interval: [number, number];
}

interface EscortDef {
  phase: number;
  enemy: string;
  every: number;
  count: number;
  behaviour: 'formation' | 'flyby';
}

interface BossDef {
  id: string;
  name: string;
  model: string;
  /** Surface bosses ride the sea surface instead of flying. */
  surface: boolean;
  start: [number, number, number];
  holdZ: [number, number, number]; // per phase
  swayX: number;
  y: number;
  pitch: number;
  parts: PartDef[];
  escorts: EscortDef[];
  /** 'sway' drifts on sine curves; 'jink' darts between random points. */
  movement?: 'sway' | 'jink';
  /** Roll rate (rad/s) of spinning hulls. */
  spin?: number;
  /** Periodic cloaking: parts can't be locked or damaged while cloaked. */
  cloak?: { every: number; duration: number };
  score?: number;
}

const TURRET_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 3, spreadDeg: 5, speed: 700 };
const TURRET_LEAD: FireSpec = { pattern: 'leading', interval: 0, speed: 820 };
const MISSILE: FireSpec = { pattern: 'homing', interval: 0 };
const CORE_RING: FireSpec = { pattern: 'ring', interval: 0, count: 12, spreadDeg: 13, speed: 620 };
const CORE_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 5, spreadDeg: 8, speed: 760 };
const FLAK: FireSpec = { pattern: 'flak', interval: 0, speed: 900 };
const ACE_BURST: FireSpec = { pattern: 'leading', interval: 0, speed: 900 };
const ACE_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 5, spreadDeg: 6, speed: 820 };
const BIG_RING: FireSpec = { pattern: 'ring', interval: 0, count: 16, spreadDeg: 16, speed: 560 };
const TIGHT_RING: FireSpec = { pattern: 'ring', interval: 0, count: 10, spreadDeg: 7, speed: 700 };

const BOSSES: Record<string, BossDef> = {
  fortress: {
    id: 'fortress',
    name: 'SKY FORTRESS "LEVIATHAN"',
    model: 'fortress',
    surface: false,
    start: [0, 60, -3000],
    holdZ: [-580, -580, -430],
    swayX: 100,
    y: 10,
    pitch: -0.32,
    parts: [
      ...[-150, -78, 78, 150].map<PartDef>((x) => ({
        role: 'turret',
        model: 'bossTurret',
        offset: [x, Math.abs(x) > 100 ? 12 : 15, Math.abs(x) > 100 ? 12 : 2],
        hp: 30,
        radius: 15,
        phase: 1,
        fire: [TURRET_SPREAD, TURRET_LEAD],
        interval: [1.6, 2.6],
      })),
      ...[-46, 46].map<PartDef>((x) => ({
        role: 'engine',
        model: 'bossEngine',
        offset: [x, -4, 46],
        hp: 55,
        radius: 17,
        phase: 2,
        fire: [MISSILE],
        interval: [3.2, 4.2],
      })),
      {
        role: 'core',
        model: 'bossCore',
        offset: [0, 12, 40],
        hp: 110,
        radius: 17,
        phase: 3,
        fire: [CORE_RING, CORE_SPREAD],
        interval: [1.2, 1.8],
      },
    ],
    escorts: [{ phase: 2, enemy: 'drone', every: 7, count: 3, behaviour: 'formation' }],
  },
  carrier: {
    id: 'carrier',
    name: 'CARRIER GROUP "TRIDENT"',
    model: 'carrier',
    surface: true,
    start: [0, 0, -3200],
    holdZ: [-640, -600, -540],
    swayX: 70,
    y: 6,
    pitch: 0,
    parts: [
      ...[-230, 230].map<PartDef>((x) => ({
        role: 'turret',
        model: 'bossDestroyer',
        offset: [x, 4, 70],
        hp: 45,
        radius: 40,
        phase: 1,
        fire: [FLAK, MISSILE, FLAK],
        interval: [1.4, 2.4],
      })),
      ...[
        [-38, -90],
        [38, -90],
        [-38, 110],
        [38, 110],
      ].map<PartDef>(([x, z]) => ({
        role: 'turret',
        model: 'bossTurret',
        offset: [x, 16, z],
        hp: 20,
        radius: 14,
        phase: 1,
        fire: [FLAK, TURRET_SPREAD],
        interval: [1.5, 2.5],
      })),
      ...[-28, 28].map<PartDef>((x) => ({
        role: 'engine',
        model: 'bossSam',
        offset: [x, 16, 20],
        hp: 45,
        radius: 16,
        phase: 2,
        fire: [MISSILE],
        interval: [2.6, 3.6],
      })),
      {
        role: 'core',
        model: 'bossBridge',
        offset: [34, 30, 10],
        hp: 100,
        radius: 20,
        phase: 3,
        fire: [CORE_RING, FLAK, CORE_SPREAD],
        interval: [1.1, 1.7],
      },
    ],
    escorts: [{ phase: 2, enemy: 'fighter', every: 6, count: 2, behaviour: 'flyby' }],
  },
  stealth: {
    id: 'stealth',
    name: 'STEALTH ACE "WRAITH"',
    model: 'stealth',
    surface: false,
    start: [0, 80, -2600],
    holdZ: [-560, -520, -440],
    swayX: 0,
    y: 20,
    pitch: -0.12,
    movement: 'jink',
    cloak: { every: 7, duration: 2.6 },
    parts: [
      ...[-16, 16].map<PartDef>((x) => ({
        role: 'engine',
        model: 'bossJet',
        offset: [x, 0, 16],
        hp: 45,
        radius: 12,
        phase: 1,
        fire: [ACE_BURST, ACE_SPREAD],
        interval: [0.9, 1.5],
      })),
      {
        role: 'turret',
        model: 'bossBay',
        offset: [0, -4, -2],
        hp: 70,
        radius: 14,
        phase: 2,
        fire: [MISSILE, TIGHT_RING, ACE_BURST],
        interval: [1.1, 1.8],
      },
      {
        role: 'core',
        model: 'bossCockpit',
        offset: [0, 5, -20],
        hp: 90,
        radius: 12,
        phase: 3,
        fire: [ACE_BURST, ACE_SPREAD, TIGHT_RING],
        interval: [0.7, 1.2],
      },
    ],
    escorts: [{ phase: 2, enemy: 'drone', every: 6, count: 4, behaviour: 'formation' }],
  },
  orbital: {
    id: 'orbital',
    name: 'ORBITAL PLATFORM "HALO"',
    model: 'orbital',
    surface: false,
    start: [0, 160, -3200],
    holdZ: [-760, -720, -650],
    swayX: 60,
    y: 40,
    pitch: 0,
    spin: 0.25,
    score: 1000000,
    parts: [
      ...[0, 1, 2, 3, 4, 5].map<PartDef>((i) => {
        const a = (i / 6) * Math.PI * 2;
        return {
          role: 'turret',
          model: 'bossPanel',
          offset: [dcos(a) * 118, dsin(a) * 118, 0],
          hp: 34,
          radius: 16,
          phase: 1,
          fire: [TURRET_SPREAD, TURRET_LEAD, FLAK],
          interval: [1.8, 2.8],
        };
      }),
      ...[0, 1, 2].map<PartDef>((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        return {
          role: 'engine',
          model: 'bossSilo',
          offset: [dcos(a) * 58, dsin(a) * 58, 4],
          hp: 60,
          radius: 15,
          phase: 2,
          fire: [MISSILE, TIGHT_RING],
          interval: [2.2, 3.2],
        };
      }),
      {
        role: 'core',
        model: 'bossReactor',
        offset: [0, 0, 8],
        hp: 170,
        radius: 20,
        phase: 3,
        fire: [BIG_RING, CORE_SPREAD, BIG_RING],
        interval: [1, 1.5],
      },
    ],
    escorts: [
      { phase: 2, enemy: 'drone', every: 7, count: 4, behaviour: 'formation' },
      { phase: 3, enemy: 'fighter', every: 8, count: 2, behaviour: 'flyby' },
    ],
  },
};

const _off = new Vector3();

export function spawnBoss(sim: Sim, id: string): Entity {
  const def = BOSSES[id];
  if (!def) throw new Error(`Unknown boss "${id}"`);
  const boss = sim.spawn('boss', def.model, 'player');
  boss.pos.set(def.start[0], def.surface ? -sim.railNow.y + def.y : def.start[1], def.start[2]);
  boss.prev.copy(boss.pos);
  boss.radius = 140;
  boss.hp = boss.maxHp = 1;
  const parts: Entity[] = [];
  let totalHp = 0;
  def.parts.forEach((d, i) => {
    const p = sim.spawn('bossPart', d.model, 'player');
    p.hp = p.maxHp = d.hp;
    p.radius = d.radius;
    p.lockable = d.phase === 1;
    const state: BossPartState = (p.bossPart ??= {
      boss,
      offset: new Vector3(),
      phase: 1,
      role: d.role,
      fireTimer: 0,
      destroyed: false,
      def: d,
    });
    state.boss = boss;
    state.offset.set(...d.offset);
    state.phase = d.phase;
    state.role = d.role;
    state.fireTimer = 1.5 + i * 0.35;
    state.destroyed = false;
    state.def = d;
    totalHp += d.hp;
    parts.push(p);
  });
  boss.boss = {
    id,
    name: def.name,
    phase: 1,
    parts,
    totalHp,
    entering: true,
    dying: 0,
    spawnTimer: 5,
    spin: 0,
    dieRoll: 0,
    diePitch: 0,
    jink: { x: 0, y: def.y, z: def.holdZ[0], t: 0 },
    cloak: 0,
    cloakTimer: def.cloak?.every ?? 0,
  };
  syncBossParts(sim);
  for (const p of parts) p.prev.copy(p.pos);
  sim.events.emit('bossSpawn', { name: def.name });
  return boss;
}

export function bossScore(boss: Entity): number {
  return BOSSES[boss.boss!.id]?.score ?? 300000;
}

/** True while a cloaking boss is invisible (parts unlockable and immune). */
export function isCloaked(boss: Entity): boolean {
  return (boss.boss?.cloak ?? 0) > 0;
}

export function updateBosses(sim: Sim, dt: number): void {
  for (const boss of sim.bosses.items) {
    if (!boss.alive) continue;
    const b = boss.boss!;
    const def = BOSSES[b.id];
    const t = boss.age;
    b.spin += (def.spin ?? 0) * dt;

    if (b.dying > 0) {
      b.dying -= dt;
      b.cloak = 0;
      if (def.surface) {
        boss.vel.y -= 6 * dt; // sinking
        boss.vel.z = Math.max(-60, boss.vel.z - 40 * dt);
      } else {
        boss.vel.y -= 40 * dt;
        boss.vel.z = Math.max(-120, boss.vel.z - 60 * dt);
      }
      b.dieRoll += (def.surface ? 0.08 : 0.35) * dt;
      b.diePitch -= 0.08 * dt;
      orientBoss(boss, def, t);
      if (sim.rng.chance(0.25)) {
        sim.events.emit('explosion', {
          x: boss.pos.x + sim.rng.range(-150, 150),
          y: boss.pos.y + sim.rng.range(-20, 25),
          z: boss.pos.z + sim.rng.range(-50, 50),
          size: sim.rng.chance(0.3) ? 'large' : 'medium',
        });
      }
      if (b.dying <= 0) {
        sim.events.emit('bossDefeated', { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z });
        sim.kill(boss);
        sim.director?.onBossDefeated();
      }
      continue;
    }

    const phase = Math.min(3, b.phase);
    const holdZ = def.holdZ[phase - 1];
    let tx: number;
    let ty: number;
    let tz: number;
    if (def.movement === 'jink') {
      b.jink.t -= dt;
      if (b.jink.t <= 0 && !b.entering) {
        b.jink.x = sim.rng.range(-190, 190);
        b.jink.y = def.y + sim.rng.range(-50, 80);
        b.jink.z = holdZ + sim.rng.range(-160, 140);
        b.jink.t = sim.rng.range(1.2, 2.2) - phase * 0.2;
      }
      tx = b.jink.x;
      ty = b.jink.y;
      tz = b.entering ? holdZ : b.jink.z;
    } else {
      tx = def.swayX * dsin(t * 0.33) * (phase === 3 ? 1.4 : 1);
      ty = def.surface ? -sim.railNow.y + def.y : def.y + 20 * dsin(t * 0.52);
      tz = holdZ + 50 * dsin(t * 0.21);
    }
    const agile = def.movement === 'jink' ? 2.6 : 1;
    if (b.entering) {
      boss.vel.z = clamp((tz - boss.pos.z) * 1.2, -300, 1100);
      boss.vel.x += (clamp((tx - boss.pos.x) * 1.2, -120, 120) - boss.vel.x) * approach(2, dt);
      boss.vel.y += (clamp((ty - boss.pos.y) * 1.2, -80, 80) - boss.vel.y) * approach(2, dt);
      if (boss.pos.z > tz - 40) b.entering = false;
    } else {
      const k = approach(1.6 * agile, dt);
      boss.vel.x += (clamp((tx - boss.pos.x) * 1.4, -140 * agile, 140 * agile) - boss.vel.x) * k;
      boss.vel.y += (clamp((ty - boss.pos.y) * 1.4, -80 * agile, 80 * agile) - boss.vel.y) * k;
      boss.vel.z += (clamp((tz - boss.pos.z) * 1.4, -200 * agile, 200 * agile) - boss.vel.z) * k;
    }
    orientBoss(boss, def, t);

    // Cloaking (Boss 3): periodically vanishes; locks drop and hits glance off.
    if (def.cloak && !b.entering) {
      if (b.cloak > 0) {
        b.cloak -= dt;
        if (b.cloak <= 0) {
          b.cloak = 0;
          for (const p of b.parts) if (p.alive) p.lockable = p.bossPart!.phase === b.phase;
        }
      } else {
        b.cloakTimer -= dt;
        if (b.cloakTimer <= 0) {
          b.cloakTimer = def.cloak.every;
          b.cloak = def.cloak.duration;
          for (const p of b.parts) if (p.alive) p.lockable = false;
          sim.events.emit('callout', { text: 'It cloaked — watch the radar!' });
        }
      }
    }

    if (b.entering || sim.player.dead || sim.state !== 'playing') continue;

    for (const part of b.parts) {
      if (!part.alive) continue;
      const ps = part.bossPart!;
      if (ps.phase !== b.phase) continue;
      ps.fireTimer -= dt * sim.fireRateScale;
      if (ps.fireTimer > 0) continue;
      const pd = ps.def;
      fireAt(sim, part.pos, pd.fire[sim.rng.int(0, pd.fire.length - 1)]);
      ps.fireTimer = sim.rng.range(pd.interval[0], pd.interval[1]);
      sim.events.emit('enemyFire', { enemy: part });
    }

    for (const esc of def.escorts) {
      if (b.phase !== esc.phase) continue;
      b.spawnTimer -= dt;
      if (b.spawnTimer > 0) continue;
      b.spawnTimer = esc.every;
      for (let i = 0; i < esc.count; i++) {
        spawnEnemy(sim, {
          enemy: esc.enemy,
          behaviour: esc.behaviour,
          from: 'front',
          x: boss.pos.x + (i - (esc.count - 1) / 2) * 60,
          y: def.surface ? boss.pos.y + 60 : boss.pos.y - 20,
          z: boss.pos.z - 30,
          params: { member: i, ampX: 70, freq: 1.8, speed: 0.9, breakaway: 1, home: 0.8 },
        });
      }
    }
  }
}

function orientBoss(boss: Entity, def: BossDef, t: number): void {
  const b = boss.boss!;
  if (def.surface) {
    quatFromEuler(
      0.01 * dsin(t * 0.8) + b.diePitch,
      -boss.vel.x * 0.002,
      0.015 * dsin(t * 0.6) + b.dieRoll,
      'XYZ',
      boss.rot,
    );
  } else {
    // Flying bosses pitch nose-down so the player (behind, above) sees the deck.
    const bank = def.movement === 'jink' ? -boss.vel.x * 0.005 : -boss.vel.x * 0.0035;
    quatFromEuler(
      def.pitch + boss.vel.y * 0.0012 + b.diePitch,
      0,
      bank + b.spin + b.dieRoll,
      'XYZ',
      boss.rot,
    );
  }
}

/** Places boss parts on their hull after integration. */
export function syncBossParts(sim: Sim): void {
  for (const boss of sim.bosses.items) {
    if (!boss.alive) continue;
    for (const part of boss.boss!.parts) {
      if (!part.alive) continue;
      _off.copy(part.bossPart!.offset).applyQuaternion(boss.rot);
      part.pos.copy(boss.pos).add(_off);
      part.rot.copy(boss.rot);
    }
  }
}

export function onBossPartDestroyed(sim: Sim, part: Entity): void {
  const ps = part.bossPart!;
  ps.destroyed = true;
  const boss = ps.boss;
  const b = boss.boss;
  if (!b || !boss.alive) return;
  const alive = (phase: number) => b.parts.some((p) => p.alive && p.bossPart!.phase === phase);
  if (alive(b.phase)) return;
  // Advance past any phase whose weak points are already gone.
  do b.phase++;
  while (b.phase <= 3 && !alive(b.phase));
  if (b.phase > 3) {
    b.dying = 3.2;
    for (const p of b.parts) if (p.alive) sim.world.remove(p);
    return;
  }
  b.spawnTimer = 3;
  for (const p of b.parts) if (p.alive) p.lockable = p.bossPart!.phase === b.phase;
  sim.events.emit('bossPhase', { phase: b.phase });
}

export function bossHealth(boss: Entity): number {
  const b = boss.boss!;
  let hp = 0;
  for (const p of b.parts) if (p.alive && p.bossPart!.boss === boss) hp += Math.max(0, p.hp);
  return b.totalHp > 0 ? hp / b.totalHp : 0;
}

export type { PartDef };
