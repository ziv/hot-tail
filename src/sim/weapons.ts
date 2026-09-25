import { Vector3 } from 'three';
import { tuning } from './tuning';
import { clamp, lookQuaternion, rotateToward } from './math';
import { Btn, type Entity, type InputFrame } from './types';
import type { LockSlot } from './player';
import type { Sim } from './sim';

const _to = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();
const _rel = new Vector3();
const _relVel = new Vector3();
const _omega = new Vector3();
const _acc = new Vector3();
const _tv = new Vector3();

/** Vulcan cannon (D1), lock-on sweep (D2) and missile volleys (D3). */
export function updatePlayerWeapons(sim: Sim, input: InputFrame, dt: number): void {
  const p = sim.player;
  pruneLocks(p.locks);
  if (p.dead || p.loopTime >= 0 || sim.state === 'gameover' || sim.state === 'refuel') {
    releaseLocks(p.locks);
    p.lockHeld = 0;
    return;
  }

  // Vulcan: a fixed-rate stream from alternating gun ports along the aim vector.
  const firing =
    (input.buttons & Btn.Fire) !== 0 || (sim.options.autoFire && findLockTarget(sim, 0.9, true) !== null);
  if (firing) {
    p.gunTimer -= dt;
    const interval = 1 / tuning.vulcan.rate;
    while (p.gunTimer <= 0) {
      fireBullet(sim);
      p.gunTimer += interval;
    }
  } else if (p.gunTimer > 0) {
    p.gunTimer = Math.max(0, p.gunTimer - dt);
  }

  // Lock-on: hold to sweep the reticle over targets, release to fire a volley.
  const lockDown = (input.buttons & Btn.Lock) !== 0;
  const lockWasDown = (sim.prevButtons & Btn.Lock) !== 0;
  if (lockDown) {
    p.lockHeld += dt;
    p.lockTimer -= dt;
    const ammo = sim.cheats.infiniteMissiles ? 99 : p.missiles - p.volley.length;
    if (p.lockTimer <= 0 && p.locks.length < sim.jet.maxLocks && p.locks.length < ammo) {
      const t = findLockTarget(sim, 1);
      if (t) {
        t.locks++;
        p.locks.push({ e: t, id: t.id });
        // Difficulty scales lock time around the tuned (normal) interval.
        p.lockTimer = tuning.lock.interval * (sim.diff.lockInterval / 0.09);
        sim.events.emit('lockOn', { target: t, count: p.locks.length });
      }
    }
  } else if (lockWasDown) {
    if (p.locks.length > 0) {
      for (const l of p.locks) p.volley.push(l);
      p.locks.length = 0;
    } else if (p.lockHeld < 0.25 && (p.missiles > 0 || sim.cheats.infiniteMissiles)) {
      // Quick tap: a single missile at whatever is closest to the reticle.
      const t = findLockTarget(sim, 1.8);
      if (t) t.locks++;
      p.volley.push({ e: t ?? p.e, id: t ? t.id : -1 });
    }
    p.lockHeld = 0;
    p.lockTimer = 0;
  }

  if (p.volleyTimer > 0) p.volleyTimer -= dt;
  while (p.volley.length > 0 && p.volleyTimer <= 0) {
    const slot = p.volley.shift()!;
    if (slot.id >= 0 && slot.e.alive && slot.e.id === slot.id) slot.e.locks = Math.max(0, slot.e.locks - 1);
    if (p.missiles <= 0 && !sim.cheats.infiniteMissiles) {
      p.volley.length = 0;
      break;
    }
    const target = slot.id >= 0 && slot.e.alive && slot.e.id === slot.id ? slot.e : null;
    launchMissile(sim, target);
    p.volleyTimer += tuning.missile.volleyGap;
  }
  if (p.volley.length === 0 && p.volleyTimer < 0) p.volleyTimer = 0;
}

function pruneLocks(locks: LockSlot[]): void {
  for (let i = locks.length - 1; i >= 0; i--) {
    const l = locks[i];
    if (!l.e.alive || l.e.id !== l.id || !l.e.lockable) locks.splice(i, 1);
  }
}

function releaseLocks(locks: LockSlot[]): void {
  for (const l of locks) if (l.e.alive && l.e.id === l.id) l.e.locks = Math.max(0, l.e.locks - 1);
  locks.length = 0;
}

/** Best lockable target inside the aim cone (scaled by coneScale), or null. */
export function findLockTarget(sim: Sim, coneScale: number, airOnly = false): Entity | null {
  const p = sim.player;
  const pos = p.e.pos;
  const lk = tuning.lock;
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const t of sim.targets.items) {
    if (!t.alive || !t.lockable || (airOnly && t.layer === 'surface')) continue;
    const maxLocks = t.kind === 'bossPart' ? 3 : 1;
    if (t.locks >= maxLocks) continue;
    _to.subVectors(t.pos, pos);
    const dist = _to.length();
    if (dist < lk.rangeMin || dist > lk.rangeMax) continue;
    const cos = _to.dot(p.aim) / dist;
    if (cos <= 0) continue;
    const angle = Math.acos(clamp(cos, -1, 1));
    // Near targets get a little extra slack so close passes are still lockable.
    const cone = (lk.cone + lk.coneNear / dist) * coneScale;
    if (angle > cone) continue;
    // Prefer air threats over ground targets when both are under the reticle.
    const score = angle / cone + (dist / lk.rangeMax) * 0.3 + (t.layer === 'surface' ? 0.35 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function fireBullet(sim: Sim): void {
  const p = sim.player;
  const v = tuning.vulcan;
  const b = sim.spawn('bullet', 'bullet', 'player');
  p.gunSide = -p.gunSide;
  _right.set(1, 0, 0).applyQuaternion(p.e.rot);
  b.pos
    .copy(p.e.pos)
    .addScaledVector(p.aim, 10)
    .addScaledVector(_right, p.gunSide * 3.2);
  b.prev.copy(b.pos);
  _dir.copy(p.aim);
  _dir.x += sim.rng.range(-v.spread, v.spread);
  _dir.y += sim.rng.range(-v.spread, v.spread);
  _dir.normalize();
  b.vel.copy(_dir).multiplyScalar(v.speed);
  b.radius = 1.5;
  b.life = v.life;
  b.shot ??= { damage: 1, fromPlayer: true };
  b.shot.damage = v.damage;
  lookQuaternion(_dir, 0, b.rot);
  b.prevRot.copy(b.rot);
  sim.score.stats.shotsFired++;
  sim.events.emit('vulcan', { x: b.pos.x, y: b.pos.y, z: b.pos.z });
}

function launchMissile(sim: Sim, target: Entity | null): void {
  const p = sim.player;
  const mt = tuning.missile;
  const m = sim.spawn('missile', 'missile', 'player');
  p.volleySide = -p.volleySide;
  m.pos.copy(p.e.pos);
  m.pos.x += p.volleySide * 6;
  m.pos.y -= 3;
  m.prev.copy(m.pos);
  // Fan the volley outwards so the missiles visibly spread before homing.
  _dir.copy(p.aim);
  _dir.x += p.volleySide * 0.35;
  _dir.y -= 0.12;
  _dir.normalize();
  m.vel.copy(_dir).multiplyScalar(mt.speed0);
  m.radius = 3;
  m.life = mt.life;
  m.missile ??= { targetId: -1, target: null, speed: 0, fromPlayer: true, damage: 0, tracking: true };
  m.missile.target = target;
  m.missile.targetId = target ? target.id : -1;
  m.missile.speed = mt.speed0;
  m.missile.fromPlayer = true;
  m.missile.damage = mt.damage;
  m.missile.tracking = true;
  lookQuaternion(_dir, 0, m.rot);
  m.prevRot.copy(m.rot);
  if (!sim.cheats.infiniteMissiles) p.missiles--;
  sim.score.stats.missilesFired++;
  sim.events.emit('missileFire', { missile: m, fromPlayer: true });
}

/**
 * Missile guidance. Player missiles use proportional navigation (a = N·Vc·Ω×R̂)
 * with a turn-rate cap; enemy missiles use rate-limited pursuit and give up once
 * they overshoot, so rolls and afterburner can shake them.
 */
export function updateMissile(sim: Sim, m: Entity, dt: number): void {
  const ms = m.missile!;
  if (ms.target && (!ms.target.alive || ms.target.id !== ms.targetId)) ms.target = null;

  _dir.copy(m.vel).normalize();
  if (ms.fromPlayer) {
    const mt = tuning.missile;
    ms.speed = Math.min(mt.speedMax, ms.speed + mt.accel * dt);
    const t = ms.target;
    if (t && m.age > 0.08) {
      _rel.subVectors(t.pos, m.pos);
      const dist = _rel.length();
      sim.frameVelocity(t, _tv);
      _relVel.subVectors(_tv, m.vel);
      if (dist < 160) {
        // Terminal phase: pure pursuit is more reliable at close range.
        rotateToward(_dir, _rel.divideScalar(dist), mt.turnRate * 1.8 * dt);
      } else {
        _omega.crossVectors(_rel, _relVel).divideScalar(dist * dist);
        _rel.divideScalar(dist);
        const closing = -_rel.dot(_relVel);
        if (closing > 0) {
          _acc.crossVectors(_omega, _rel).multiplyScalar(mt.navGain * closing);
          _to.copy(m.vel).addScaledVector(_acc, dt).normalize();
          rotateToward(_dir, _to, mt.turnRate * dt);
        } else {
          rotateToward(_dir, _rel, mt.turnRate * dt);
        }
      }
    }
    m.vel.copy(_dir).multiplyScalar(ms.speed);
  } else {
    const et = tuning.enemy;
    const pe = sim.player.e;
    const turn = et.missileTurnRate * sim.diff.enemyMissileTurn * dt;
    if (ms.tracking && !sim.player.dead) {
      _rel.subVectors(pe.pos, m.pos);
      const dist = _rel.length();
      _rel.divideScalar(dist);
      if (_rel.dot(_dir) < 0.2 && dist < 400) ms.tracking = false;
      else rotateToward(_dir, _rel, turn);
    } else {
      ms.tracking = false;
      // Decoyed by a flare: chase it instead.
      if (ms.target) rotateToward(_dir, _rel.subVectors(ms.target.pos, m.pos).normalize(), turn * 2);
    }
    m.vel.copy(_dir).multiplyScalar(ms.speed);
  }
  lookQuaternion(_dir, 0, m.rot);
}
