import { Euler, Vector3 } from 'three';
import { approach, clamp } from './math';
import { fireAt, spawnEnemy } from './enemies';
import type { FireSpec } from './defs';
import type { BossPartState, Entity } from './types';
import type { Sim } from './sim';

/**
 * Boss framework (F10) + Boss 1, the flying fortress (F11). A boss is a hull
 * entity plus part entities (weak points) that ride on it. Parts are armoured
 * until their phase is active; destroying every part of a phase advances it.
 */
interface PartDef {
  role: BossPartState['role'];
  model: string;
  offset: [number, number, number];
  hp: number;
  radius: number;
  phase: number;
}

const FORTRESS_PARTS: PartDef[] = [
  { role: 'turret', model: 'bossTurret', offset: [-150, 12, 12], hp: 30, radius: 15, phase: 1 },
  { role: 'turret', model: 'bossTurret', offset: [-78, 15, 2], hp: 30, radius: 15, phase: 1 },
  { role: 'turret', model: 'bossTurret', offset: [78, 15, 2], hp: 30, radius: 15, phase: 1 },
  { role: 'turret', model: 'bossTurret', offset: [150, 12, 12], hp: 30, radius: 15, phase: 1 },
  { role: 'engine', model: 'bossEngine', offset: [-46, -4, 46], hp: 55, radius: 17, phase: 2 },
  { role: 'engine', model: 'bossEngine', offset: [46, -4, 46], hp: 55, radius: 17, phase: 2 },
  { role: 'core', model: 'bossCore', offset: [0, 12, 40], hp: 110, radius: 17, phase: 3 },
];

const TURRET_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 3, spreadDeg: 5, speed: 700 };
const TURRET_LEAD: FireSpec = { pattern: 'leading', interval: 0, speed: 820 };
const ENGINE_MISSILE: FireSpec = { pattern: 'homing', interval: 0 };
const CORE_RING: FireSpec = { pattern: 'ring', interval: 0, count: 12, spreadDeg: 13, speed: 620 };
const CORE_SPREAD: FireSpec = { pattern: 'spread', interval: 0, count: 5, spreadDeg: 8, speed: 760 };

const _off = new Vector3();
const _euler = new Euler();

export function spawnBoss(sim: Sim, id: string): Entity {
  if (id !== 'fortress') throw new Error(`Unknown boss "${id}"`);
  const boss = sim.spawn('boss', 'fortress', 'player');
  boss.pos.set(0, 60, -3000);
  boss.prev.copy(boss.pos);
  boss.radius = 120;
  boss.hp = boss.maxHp = 1;
  const parts: Entity[] = [];
  let totalHp = 0;
  FORTRESS_PARTS.forEach((d, i) => {
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
    });
    state.boss = boss;
    state.offset.set(...d.offset);
    state.phase = d.phase;
    state.role = d.role;
    state.fireTimer = 1.5 + i * 0.35;
    state.destroyed = false;
    totalHp += d.hp;
    parts.push(p);
  });
  boss.boss = {
    name: 'SKY FORTRESS "LEVIATHAN"',
    phase: 1,
    parts,
    totalHp,
    entering: true,
    dying: 0,
    spawnTimer: 5,
  };
  syncBossParts(sim);
  for (const p of parts) p.prev.copy(p.pos);
  sim.events.emit('bossSpawn', { name: boss.boss.name });
  return boss;
}

export function updateBosses(sim: Sim, dt: number): void {
  for (const boss of sim.bosses.items) {
    if (!boss.alive) continue;
    const b = boss.boss!;
    const t = boss.age;

    if (b.dying > 0) {
      b.dying -= dt;
      boss.vel.y -= 40 * dt;
      boss.vel.z = Math.max(-120, boss.vel.z - 60 * dt);
      _euler.setFromQuaternion(boss.rot);
      _euler.z += 0.35 * dt;
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

    const holdZ = b.phase === 3 ? -430 : -580;
    const tx = 100 * Math.sin(t * 0.33) * (b.phase === 3 ? 1.4 : 1);
    const ty = 10 + 20 * Math.sin(t * 0.52);
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
    // Pitched nose-down so the player (behind and above) sees the deck and weak points.
    _euler.set(-0.32 + boss.vel.y * 0.0012, 0, -boss.vel.x * 0.0035);
    boss.rot.setFromEuler(_euler);

    if (b.entering || sim.player.dead || sim.state !== 'playing') continue;

    for (const part of b.parts) {
      if (!part.alive) continue;
      const ps = part.bossPart!;
      if (ps.phase !== b.phase) continue;
      ps.fireTimer -= dt;
      if (ps.fireTimer > 0) continue;
      switch (ps.role) {
        case 'turret':
          fireAt(sim, part.pos, sim.rng.chance(0.5) ? TURRET_SPREAD : TURRET_LEAD);
          ps.fireTimer = sim.rng.range(1.6, 2.6);
          break;
        case 'engine':
          fireAt(sim, part.pos, ENGINE_MISSILE);
          ps.fireTimer = sim.rng.range(3.2, 4.2);
          break;
        case 'core':
          fireAt(sim, part.pos, sim.rng.chance(0.55) ? CORE_RING : CORE_SPREAD);
          ps.fireTimer = sim.rng.range(1.2, 1.8);
          break;
      }
      sim.events.emit('enemyFire', { enemy: part });
    }

    // Phase 2: the fortress launches drone escorts.
    if (b.phase === 2) {
      b.spawnTimer -= dt;
      if (b.spawnTimer <= 0) {
        b.spawnTimer = 7;
        for (let i = 0; i < 3; i++) {
          spawnEnemy(sim, {
            enemy: 'drone',
            behaviour: 'formation',
            from: 'front',
            x: boss.pos.x + (i - 1) * 60,
            y: boss.pos.y - 20,
            z: boss.pos.z - 30,
            params: { member: i, ampX: 70, freq: 1.8, speed: 0.9 },
          });
        }
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
  for (const p of b.parts) if (p.alive) p.lockable = p.bossPart!.phase === b.phase;
  sim.events.emit('bossPhase', { phase: b.phase });
}

export function bossHealth(boss: Entity): number {
  const b = boss.boss!;
  let hp = 0;
  for (const p of b.parts) if (p.alive && p.bossPart!.boss === boss) hp += Math.max(0, p.hp);
  return b.totalHp > 0 ? hp / b.totalHp : 0;
}
