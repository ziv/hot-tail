import { Euler, Vector3 } from 'three';
import { tuning } from './tuning';
import { approach, easeInOut } from './math';
import { Btn, createEntity, EMPTY_INPUT, type Entity, type InputFrame, type Throttle } from './types';
import { clamp } from './math';
import type { JetDef } from './defs';
import type { Sim } from './sim';

/** Duration of the scripted loop manoeuvre (C5). */
export const LOOP_DURATION = 2.8;
export const FLARES_PER_LIFE = 3;

export interface LockSlot {
  e: Entity;
  id: number;
}

export interface PlayerState {
  e: Entity;
  /** Smoothed stick, drives aim and visual attitude. */
  stickX: number;
  stickY: number;
  throttle: Throttle;
  speedFactor: number;
  /** Seconds into the current barrel roll, or -1 when not rolling. */
  rollTime: number;
  rollDir: number;
  rollAngle: number;
  rollCooldown: number;
  invuln: number;
  armor: number;
  dead: boolean;
  respawnTimer: number;
  /** Unit aim vector (reticle direction). */
  aim: Vector3;
  bank: number;
  pitch: number;
  gunTimer: number;
  gunSide: number;
  missiles: number;
  locks: LockSlot[];
  lockTimer: number;
  lockHeld: number;
  volley: LockSlot[];
  volleyTimer: number;
  volleySide: number;
  /** Double-flick roll gesture state. */
  flickSide: number;
  flickPending: number;
  flickReleaseTime: number;
  flickPressTime: number;
  lastStickX: number;
  maxArmor: number;
  flares: number;
  /** Seconds into a scripted loop, or -1. */
  loopTime: number;
  loopAngle: number;
}

export function createPlayer(jet: JetDef): PlayerState {
  const e = createEntity('player', jet.model, 'player');
  e.alive = true;
  e.radius = tuning.player.radius;
  return {
    e,
    stickX: 0,
    stickY: 0,
    throttle: 'cruise',
    speedFactor: 1,
    rollTime: -1,
    rollDir: 1,
    rollAngle: 0,
    rollCooldown: 0,
    invuln: 0,
    armor: jet.armor,
    maxArmor: jet.armor,
    flares: FLARES_PER_LIFE,
    loopTime: -1,
    loopAngle: 0,
    dead: false,
    respawnTimer: 0,
    aim: new Vector3(0, 0, -1),
    bank: 0,
    pitch: 0,
    gunTimer: 0,
    gunSide: 1,
    missiles: tuning.missile.ammo,
    locks: [],
    lockTimer: 0,
    lockHeld: 0,
    volley: [],
    volleyTimer: 0,
    volleySide: 1,
    flickSide: 0,
    flickPending: 0,
    flickReleaseTime: -10,
    flickPressTime: -10,
    lastStickX: 0,
  };
}

const _euler = new Euler(0, 0, 0, 'YXZ');

export function updatePlayer(sim: Sim, input: InputFrame, dt: number): void {
  const p = sim.player;
  const e = p.e;
  const f = tuning.flight;
  e.prev.copy(e.pos);
  e.prevRot.copy(e.rot);

  if (p.dead) {
    p.respawnTimer -= dt;
    p.speedFactor += (1 - p.speedFactor) * approach(tuning.throttle.rate, dt);
    if (p.respawnTimer <= 0 && sim.state !== 'gameover') respawn(sim);
    return;
  }

  if (p.invuln > 0) p.invuln -= dt;
  if (p.rollCooldown > 0) p.rollCooldown -= dt;

  // Scripted loop (C5): controls are locked while the jet pitches through 360°.
  if (p.loopTime >= 0) {
    p.loopTime += dt;
    if (p.loopTime >= LOOP_DURATION) {
      p.loopTime = -1;
      p.loopAngle = 0;
    } else p.loopAngle = Math.PI * 2 * easeInOut(p.loopTime / LOOP_DURATION);
    input = EMPTY_INPUT;
  }

  // Flares (D7)
  if ((input.buttons & Btn.Flare) !== 0 && (sim.prevButtons & Btn.Flare) === 0) sim.dropFlares();

  // Throttle (C3).
  const boost = (input.buttons & Btn.Boost) !== 0;
  const brake = (input.buttons & Btn.Brake) !== 0;
  const throttle: Throttle = boost && !brake ? 'boost' : brake && !boost ? 'brake' : 'cruise';
  if (throttle !== p.throttle) {
    p.throttle = throttle;
    sim.events.emit('throttle', { state: throttle });
  }
  const target =
    throttle === 'boost' ? tuning.throttle.boost : throttle === 'brake' ? tuning.throttle.brake : 1;
  p.speedFactor += (target - p.speedFactor) * approach(tuning.throttle.rate, dt);

  // Barrel roll (C4): dedicated button, or a double flick on the stick.
  updateRollGesture(sim, input);
  const rollPressed = (input.buttons & Btn.Roll) !== 0 && (sim.prevButtons & Btn.Roll) === 0;
  if (rollPressed) {
    const dir = Math.abs(input.x) > 0.2 ? Math.sign(input.x) : p.bank <= 0 ? 1 : -1;
    startRoll(sim, dir);
  }
  const r = tuning.roll;
  let rollPush = 0;
  if (p.rollTime >= 0) {
    p.rollTime += dt;
    const t = p.rollTime / r.duration;
    if (t >= 1) {
      p.rollTime = -1;
      p.rollAngle = 0;
    } else {
      p.rollAngle = -p.rollDir * Math.PI * 2 * easeInOut(t);
      rollPush = p.rollDir * r.lateralBoost * (1 - t);
    }
  }

  // Movement inside the rail envelope (C1).
  const sk = approach(f.stickSmoothing, dt);
  p.stickX += (input.x - p.stickX) * sk;
  p.stickY += (input.y - p.stickY) * sk;
  const handling = sim.jet.handling;
  const rk = approach(f.response * handling, dt);
  e.vel.x += (input.x * f.maxLatSpeed * handling - e.vel.x) * rk;
  e.vel.y += (input.y * f.maxVertSpeed * handling - e.vel.y) * rk;
  e.pos.x += (e.vel.x + rollPush) * dt;
  e.pos.y += e.vel.y * dt;
  if (e.pos.x > f.envelopeX) {
    e.pos.x = f.envelopeX;
    if (e.vel.x > 0) e.vel.x = 0;
  } else if (e.pos.x < -f.envelopeX) {
    e.pos.x = -f.envelopeX;
    if (e.vel.x < 0) e.vel.x = 0;
  }
  if (e.pos.y > f.envelopeY) {
    e.pos.y = f.envelopeY;
    if (e.vel.y > 0) e.vel.y = 0;
  } else if (e.pos.y < -f.envelopeY) {
    e.pos.y = -f.envelopeY;
    if (e.vel.y < 0) e.vel.y = 0;
  }

  // Aim leads the stick so the reticle can sweep faster than the jet moves.
  p.aim.set(p.stickX * f.aimYaw, p.stickY * f.aimPitch, -1).normalize();
  if (sim.options.aimAssist) applyAimAssist(sim);
  p.bank = -p.stickX * f.bankMax;
  p.pitch = p.stickY * f.pitchVisual;
  _euler.set(p.pitch + p.loopAngle, -p.stickX * 0.16, p.bank + p.rollAngle);
  e.rot.setFromEuler(_euler);
}

function updateRollGesture(sim: Sim, input: InputFrame): void {
  const p = sim.player;
  const r = tuning.roll;
  const x = input.x;
  const ax = Math.abs(x);
  const lastAx = Math.abs(p.lastStickX);
  const t = sim.time;
  if (ax >= r.flickThreshold && lastAx < r.flickThreshold) {
    const side = Math.sign(x);
    if (side === p.flickSide && t - p.flickReleaseTime <= r.doubleFlickWindow) {
      startRoll(sim, side);
      p.flickSide = 0;
      p.flickPending = 0;
    } else {
      p.flickPending = side;
      p.flickPressTime = t;
    }
  } else if (ax < r.centerThreshold && lastAx >= r.centerThreshold && p.flickPending !== 0) {
    // Only a short tap counts as the first half of a double flick.
    if (t - p.flickPressTime <= r.doubleFlickWindow) {
      p.flickSide = p.flickPending;
      p.flickReleaseTime = t;
    }
    p.flickPending = 0;
  }
  p.lastStickX = x;
}

function startRoll(sim: Sim, dir: number): void {
  const p = sim.player;
  if (p.rollCooldown > 0 || p.rollTime >= 0 || p.dead) return;
  p.rollTime = 0;
  p.rollDir = dir;
  p.rollCooldown = tuning.roll.cooldown;
  sim.events.emit('roll', { dir });
}

const _to = new Vector3();

/** Aim assist (C9): bends the aim halfway toward the best target near the reticle. */
function applyAimAssist(sim: Sim): void {
  const p = sim.player;
  let best = 0.13;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (const t of sim.targets.items) {
    if (!t.alive || !t.lockable) continue;
    _to.subVectors(t.pos, p.e.pos);
    const d = _to.length();
    if (d < 150 || d > 1900) continue;
    const ang = Math.acos(clamp(_to.dot(p.aim) / d, -1, 1));
    if (ang < best) {
      best = ang;
      bx = _to.x / d;
      by = _to.y / d;
      bz = _to.z / d;
    }
  }
  if (best < 0.13) p.aim.set(p.aim.x + bx, p.aim.y + by, p.aim.z + bz).normalize();
}

export function isPlayerImmune(sim: Sim): boolean {
  const p = sim.player;
  return (
    p.dead ||
    p.loopTime >= 0 ||
    p.invuln > 0 ||
    sim.cheats.invincible ||
    (p.rollTime >= 0 && p.rollTime < tuning.roll.immunity)
  );
}

/** Applies damage to the player (D5/C6). Returns true if damage was taken. */
export function damagePlayer(sim: Sim, amount: number): boolean {
  if (isPlayerImmune(sim)) return false;
  const p = sim.player;
  const dmg = Math.min(amount, p.armor);
  p.armor -= dmg;
  sim.score.stats.damageTaken += dmg;
  sim.hitStop = Math.max(sim.hitStop, 3);
  sim.events.emit('playerHit', { damage: dmg, armor: p.armor });
  if (p.armor <= 0) killPlayer(sim);
  return true;
}

function killPlayer(sim: Sim): void {
  const p = sim.player;
  const e = p.e;
  p.dead = true;
  p.respawnTimer = tuning.player.respawnDelay;
  p.rollTime = -1;
  p.rollAngle = 0;
  p.throttle = 'cruise';
  for (const l of p.locks) if (l.e.alive && l.e.id === l.id) l.e.locks = Math.max(0, l.e.locks - 1);
  p.locks.length = 0;
  p.volley.length = 0;
  p.loopTime = -1;
  p.loopAngle = 0;
  sim.score.lives--;
  sim.score.stats.deaths++;
  sim.score.chain = 0;
  sim.score.comboTimer = 0;
  sim.events.emit('playerDeath', { x: e.pos.x, y: e.pos.y, z: e.pos.z });
  if (sim.score.lives <= 0) {
    sim.state = 'gameover';
    sim.events.emit('gameOver', { score: sim.score.score });
  }
}

function respawn(sim: Sim): void {
  const p = sim.player;
  const e = p.e;
  p.dead = false;
  p.armor = p.maxArmor;
  p.flares = FLARES_PER_LIFE;
  p.missiles = Math.max(p.missiles, 50);
  p.invuln = tuning.player.invuln;
  p.stickX = p.stickY = 0;
  e.pos.set(0, 0, 0);
  e.prev.set(0, 0, 0);
  e.vel.set(0, 0, 0);
  e.rot.identity();
  e.prevRot.identity();
  // Be merciful: clear enemy fire around the respawn point.
  sim.clearWorld((x) => (x.kind === 'ebullet' || x.kind === 'emissile') && x.pos.z > -900);
  sim.events.emit('playerRespawn', { lives: sim.score.lives });
}
