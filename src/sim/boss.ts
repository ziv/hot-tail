import { Euler, Vector3 } from 'three';
import { approach, clamp } from './math';
import { fireAt, spawnEnemy } from './enemies';
import type { FireSpec } from './defs';
import type { BossPartState, Entity } from './types';
import type { Sim } from './sim';

/**
 * Boss framework (F10): a boss is a hull entity plus part entities (weak
 * points) riding on it. Parts are armoured until their phase is active;
 * destroying every part of a phase advances it. Bosses are data (BossDef):
 * Boss 1 "Leviathan" flying fortress (F11) and Boss 2 carrier group (F12).
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
}

const TURRET_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 3, spreadDeg: 5, speed: 700 };
const TURRET_LEAD: FireSpec = { pattern: 'leading', interval: 0, speed: 820 };
const MISSILE: FireSpec = { pattern: 'homing', interval: 0 };
const CORE_RING: FireSpec = { pattern: 'ring', interval: 0, count: 12, spreadDeg: 13, speed: 620 };
const CORE_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 5, spreadDeg: 8, speed: 760 };
const FLAK: FireSpec = { pattern: 'flak', interval: 0, speed: 900 };

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
};

const _off = new Vector3();
const _euler = new Euler();

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
  };
  syncBossParts(sim);
  for (const p of parts) p.prev.copy(p.pos);
  sim.events.emit('bossSpawn', { name: def.name });
  return boss;
}

export function updateBosses(sim: Sim, dt: number): void {
  for (const boss of sim.bosses.items) {
    if (!boss.alive) continue;
    const b = boss.boss!;
    const def = BOSSES[b.id];
    const t = boss.age;

    if (b.dying > 0) {
      b.dying -= dt;
      if (def.surface) {
        boss.vel.y -= 6 * dt; // sinking
        boss.vel.z = Math.max(-60, boss.vel.z - 40 * dt);
      } else {
        boss.vel.y -= 40 * dt;
        boss.vel.z = Math.max(-120, boss.vel.z - 60 * dt);
      }
      _euler.setFromQuaternion(boss.rot);
      _euler.z += (def.surface ? 0.08 : 0.35) * dt;
      _euler.x -= 0.08 * dt;
      boss.rot.setFromEuler(_euler);
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
    const tx = def.swayX * Math.sin(t * 0.33) * (phase === 3 ? 1.4 : 1);
    const ty = def.surface ? -sim.railNow.y + def.y : def.y + 20 * Math.sin(t * 0.52);
    const tz = holdZ + 50 * Math.sin(t * 0.21);
    if (b.entering) {
      boss.vel.z = clamp((tz - boss.pos.z) * 1.2, -300, 1100);
      boss.vel.x += (clamp((tx - boss.pos.x) * 1.2, -120, 120) - boss.vel.x) * approach(2, dt);
      boss.vel.y += (clamp((ty - boss.pos.y) * 1.2, -80, 80) - boss.vel.y) * approach(2, dt);
      if (boss.pos.z > tz - 40) b.entering = false;
    } else {
      const k = approach(1.6, dt);
      boss.vel.x += (clamp((tx - boss.pos.x) * 1.4, -140, 140) - boss.vel.x) * k;
      boss.vel.y += (clamp((ty - boss.pos.y) * 1.4, -80, 80) - boss.vel.y) * k;
      boss.vel.z += (clamp((tz - boss.pos.z) * 1.4, -200, 200) - boss.vel.z) * k;
    }
    if (def.surface) _euler.set(0.01 * Math.sin(t * 0.8), -boss.vel.x * 0.002, 0.015 * Math.sin(t * 0.6));
    // Flying bosses pitch nose-down so the player (behind, above) sees the deck.
    else _euler.set(def.pitch + boss.vel.y * 0.0012, 0, -boss.vel.x * 0.0035);
    boss.rot.setFromEuler(_euler);

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
  const remaining = b.parts.some((p) => p.alive && p.bossPart!.phase === b.phase);
  if (remaining) return;
  b.phase++;
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
