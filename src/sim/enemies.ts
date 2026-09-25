import { Quaternion, Vector3 } from 'three';
import { tuning } from './tuning';
import { approach, clamp, lookQuaternion, moveToward } from './math';
import { enemyDef, type FireSpec, type Formation, type From, type SpawnSpec, type WaveEvent } from './defs';
import type { Entity, EnemyState } from './types';
import type { Sim } from './sim';

export const FRONT_Z = -2700;
export const BEHIND_Z = 640;
export const SIDE_X = 1350;

const _face = new Vector3();
const _acc = new Vector3();
const _right = new Vector3();
const _dir = new Vector3();
const _u = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _to = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

/** Expands a wave event into per-member spawn specs with entry delays (E8). */
export function expandWave(sim: Sim, ev: WaveEvent): { delay: number; spec: SpawnSpec }[] {
  const def = enemyDef(ev.enemy);
  const rng = sim.rng;
  const n = ev.count ?? 1;
  const formation: Formation = ev.formation ?? (n > 1 ? 'line' : 'single');
  const behaviourDefault = def.behaviour;
  let from: From = ev.from ?? (behaviourDefault === 'pursuit' ? 'behind' : 'front');
  // Seeded per-run mirroring (F17) flips the whole wave left/right.
  if (sim.mirror) from = from === 'left' ? 'right' : from === 'right' ? 'left' : from;
  const surface = def.layer === 'surface';
  const behaviour =
    ev.behaviour ?? (!surface && (from === 'left' || from === 'right') ? 'strafe' : behaviourDefault);
  const spacing = ev.spacing ?? 60;
  const params = { ...def.params, ...ev.params };

  let bx = ev.x !== undefined ? (sim.mirror ? -ev.x : ev.x) : rng.range(-70, 70);
  let by = ev.y ?? rng.range(-25, 25);
  let bz = surface ? (params.z ?? FRONT_Z) : FRONT_Z;
  switch (surface ? 'front' : from) {
    case 'behind':
      bz = BEHIND_Z;
      break;
    case 'left':
      bx = -SIDE_X;
      bz = params.z ?? -1000;
      break;
    case 'right':
      bx = SIDE_X;
      bz = params.z ?? -1000;
      break;
    case 'above':
      by = 650;
      bz = -1800;
      break;
    default:
      break;
  }

  const out: { delay: number; spec: SpawnSpec }[] = [];
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    switch (formation) {
      case 'line':
        ox = (i - mid) * spacing;
        break;
      case 'column':
        oz = -i * spacing * 1.6;
        break;
      case 'v':
        ox = (i - mid) * spacing;
        oz = -Math.abs(i - mid) * spacing * 0.9;
        break;
      case 'circle': {
        const a = (i / n) * Math.PI * 2;
        const r = params.radius ?? spacing;
        ox = Math.cos(a) * r;
        oy = Math.sin(a) * r * 0.7;
        break;
      }
      case 'scatter':
        ox = rng.range(-1, 1) * spacing * 1.5;
        oy = rng.range(-1, 1) * spacing * 0.6;
        oz = rng.range(-1, 1) * spacing * 2;
        break;
      default:
        break;
    }
    if (from === 'left' || from === 'right') {
      // Side entries travel along x, so the formation's depth axis becomes x.
      const side = from === 'left' ? -1 : 1;
      const tmp = ox;
      ox = -oz * side;
      oz = tmp;
    }
    out.push({
      delay: (ev.stagger ?? 0) * i,
      spec: {
        enemy: ev.enemy,
        behaviour,
        from,
        x: bx + ox,
        y: by + oy,
        z: bz + oz,
        params: { ...params, member: i, count: n, angle: (i / n) * Math.PI * 2 },
        path: ev.path,
      },
    });
  }
  return out;
}

export function spawnEnemy(sim: Sim, spec: SpawnSpec): Entity {
  const def = enemyDef(spec.enemy);
  const surface = def.layer === 'surface';
  const e = sim.spawn(
    'enemy',
    def.model,
    surface ? 'ground' : spec.behaviour === 'spline' ? 'player' : 'air',
  );
  e.layer = surface ? 'surface' : 'air';
  // Surface targets sit on the ground/sea: world altitude `height`, in frame coords.
  e.pos.set(spec.x, surface ? -sim.railNow.y + (def.height ?? 3) : spec.y, spec.z);
  e.prev.copy(e.pos);
  e.hp = e.maxHp = def.hp;
  e.radius = def.radius;
  e.lockable = true;
  e.life = 50;
  const s: EnemyState = (e.enemy ??= {
    def,
    spec,
    phase: 0,
    phaseTime: 0,
    origin: new Vector3(),
    member: 0,
    guns: [],
    bank: 0,
    lastVel: new Vector3(),
    aux: new Vector3(),
    jinkTimer: 0,
    jinkTarget: new Vector3(),
    evadeCooldown: 0,
    engaged: false,
    leaving: false,
  });
  s.def = def;
  s.spec = spec;
  s.phase = 0;
  s.phaseTime = 0;
  s.origin.set(spec.x, spec.y, spec.z);
  s.member = spec.params.member ?? 0;
  s.guns = def.fire.map((f) => ({ timer: f.delay ?? 0.5, burstLeft: 0, burstTimer: 0 }));
  s.bank = 0;
  s.aux.set(0, 0, 0);
  s.jinkTimer = 0;
  s.jinkTarget.set(spec.x, spec.y, spec.z);
  s.evadeCooldown = 0;
  s.engaged = false;
  s.leaving = false;

  const sp = def.speed;
  switch (spec.behaviour) {
    case 'pursuit':
      e.vel.set(0, 0, -sp);
      break;
    case 'strafe':
      s.aux.x = spec.from === 'left' ? 1 : -1;
      e.vel.set(s.aux.x * sp * 0.75, 0, spec.params.vz ?? 40);
      break;
    case 'spline':
      e.vel.set(0, 0, 0);
      break;
    case 'ground':
      // World-space velocity: dir 1 travels with the player (-z), -1 toward it.
      e.vel.set(spec.params.vx ?? 0, 0, -(spec.params.dir ?? 1) * sp);
      break;
    default:
      e.vel.set(0, 0, sp);
  }
  s.lastVel.copy(e.vel);
  orient(sim, e, s, 1, true);
  e.prevRot.copy(e.rot);
  sim.score.stats.spawned++;
  return e;
}

/** Runs movement behaviours (E2), fire patterns (E3) and orientation. */
export function updateEnemies(sim: Sim, dt: number): void {
  for (const e of sim.enemies.items) {
    if (!e.alive) continue;
    const s = e.enemy!;
    s.phaseTime += dt;
    if (s.leaving) leave(e, dt);
    else {
      switch (s.spec.behaviour) {
        case 'flyby':
          flyby(sim, e, s, dt);
          break;
        case 'pursuit':
          pursuit(sim, e, s, dt);
          break;
        case 'formation':
          formation(e, s);
          break;
        case 'strafe':
          strafe(e, s);
          break;
        case 'evade':
          evade(sim, e, s, dt);
          break;
        case 'spline':
          spline(e, s, dt);
          break;
        case 'ground':
          break;
      }
    }
    if (!s.engaged && e.pos.z > -1600 && Math.abs(e.pos.x) < 600) s.engaged = true;
    updateGuns(sim, e, s, dt);
    orient(sim, e, s, dt, false);
  }
}

function flyby(sim: Sim, e: Entity, s: EnemyState, dt: number): void {
  const pr = s.spec.params;
  const pp = sim.player.e.pos;
  const speed = s.def.speed;
  if (s.phase === 0) {
    const home = pr.home ?? 0.6;
    if (e.pos.z < -900) {
      const dx = clamp((pp.x - e.pos.x) * 1.2 * home, -170, 170);
      const dy = clamp((pp.y - e.pos.y) * 1.2 * home, -100, 100);
      s.aux.x += (dx - s.aux.x) * approach(2, dt);
      s.aux.y += (dy - s.aux.y) * approach(2, dt);
    }
    const wa = pr.weave ?? 0;
    const wf = pr.weaveFreq ?? 1.4;
    e.vel.x = s.aux.x + wa * wf * Math.cos(wf * s.phaseTime + (pr.member ?? 0) * 0.6);
    e.vel.y = s.aux.y;
    e.vel.z = speed;
    const mode = pr.breakaway ?? 1;
    if (mode > 0 && e.pos.z > (pr.breakZ ?? -440)) {
      s.phase = 1;
      s.phaseTime = 0;
      s.aux.z = e.pos.x >= pp.x ? 1 : -1;
    }
  } else {
    const mode = pr.breakaway ?? 1;
    if (mode === 1) e.vel.y += 540 * dt;
    else if (mode === 2) e.vel.x += s.aux.z * 700 * dt;
    else e.vel.y -= 420 * dt;
    e.vel.z = Math.max(speed * 0.5, e.vel.z - 260 * dt);
  }
}

function pursuit(sim: Sim, e: Entity, s: EnemyState, dt: number): void {
  const pr = s.spec.params;
  const pp = sim.player.e.pos;
  const speed = s.def.speed;
  const holdZ = pr.holdZ ?? 170;
  const holdTime = pr.holdTime ?? 4.5;
  if (s.phase < 3) {
    const side = s.member % 2 === 0 ? 1 : -1;
    const offX = pr.offsetX ?? side * (35 + 25 * Math.floor(s.member / 2));
    const tx = clamp((pp.x + offX - e.pos.x) * 2, -220, 220);
    const ty = clamp((pp.y + (pr.offsetY ?? 18) - e.pos.y) * 2, -150, 150);
    e.vel.x += (tx - e.vel.x) * approach(3, dt);
    e.vel.y += (ty - e.vel.y) * approach(3, dt);
  }
  switch (s.phase) {
    case 0:
      e.vel.z = moveToward(e.vel.z, -speed, 400 * dt);
      if (e.pos.z < holdZ + 30) setPhase(s, 1);
      break;
    case 1: {
      const desired = clamp((holdZ - e.pos.z) * 1.6, -140, 140);
      e.vel.z = moveToward(e.vel.z, desired, 90 * dt);
      // Air-brake pushes the frame back past the chaser: it overshoots.
      if (e.pos.z < -30) setPhase(s, 3);
      else if (s.phaseTime > holdTime) setPhase(s, 2);
      break;
    }
    case 2:
      e.vel.z = moveToward(e.vel.z, -320, 320 * dt);
      if (e.pos.z < -260) setPhase(s, 3);
      break;
    default:
      e.vel.z = moveToward(e.vel.z, -110, 200 * dt);
      e.vel.x = moveToward(e.vel.x, 60 * Math.sin(s.phaseTime * 1.3 + s.member), 200 * dt);
      e.vel.y = moveToward(e.vel.y, 20, 100 * dt);
  }
}

function formation(e: Entity, s: EnemyState): void {
  const pr = s.spec.params;
  const t = s.phaseTime;
  e.vel.z = s.def.speed * (pr.speed ?? 1);
  const spin = pr.spin ?? 0;
  if (spin !== 0) {
    const r = pr.radius ?? 60;
    const a = (pr.angle ?? 0) + spin * t;
    e.vel.x = -r * spin * Math.sin(a);
    e.vel.y = r * spin * Math.cos(a) * 0.7;
  } else {
    const ax = pr.ampX ?? 60;
    const ay = pr.ampY ?? 18;
    const f = pr.freq ?? 1.5;
    const ph = (pr.member ?? 0) * (pr.phaseStep ?? 0.55);
    e.vel.x = ax * f * Math.cos(f * t + ph) + (pr.driftX ?? 0);
    e.vel.y = ay * f * 0.7 * Math.cos(f * 0.7 * t + ph) + (pr.driftY ?? 0);
  }
}

function strafe(e: Entity, s: EnemyState): void {
  const pr = s.spec.params;
  const t = s.phaseTime;
  e.vel.x = s.aux.x * s.def.speed * 0.75;
  e.vel.z = pr.vz ?? 40;
  const ay = pr.ampY ?? 25;
  e.vel.y = ay * 1.5 * Math.cos(1.5 * t + (pr.member ?? 0) * 0.5);
}

function evade(sim: Sim, e: Entity, s: EnemyState, dt: number): void {
  const pr = s.spec.params;
  const pp = sim.player.e.pos;
  const rng = sim.rng;
  const holdZ = pr.holdZ ?? -760;
  const holdTime = pr.holdTime ?? 11;
  if (s.phase === 0) {
    e.vel.z = s.def.speed;
    e.vel.x = moveToward(e.vel.x, clamp((pp.x - e.pos.x) * 0.8, -150, 150), 200 * dt);
    e.vel.y = moveToward(e.vel.y, clamp((pp.y + 30 - e.pos.y) * 0.8, -90, 90), 200 * dt);
    if (e.pos.z > holdZ - 250) setPhase(s, 1);
    return;
  }
  if (s.phase === 1) {
    s.jinkTimer -= dt;
    if (s.jinkTimer <= 0) {
      s.jinkTarget.set(pp.x + rng.range(-230, 230), pp.y + rng.range(-50, 90), holdZ + rng.range(-160, 160));
      s.jinkTimer = rng.range(0.9, 1.6);
    }
    const a = 560 * dt;
    e.vel.x = moveToward(e.vel.x, clamp((s.jinkTarget.x - e.pos.x) * 1.8, -300, 300), a);
    e.vel.y = moveToward(e.vel.y, clamp((s.jinkTarget.y - e.pos.y) * 1.8, -160, 160), a);
    e.vel.z = moveToward(e.vel.z, clamp((s.jinkTarget.z - e.pos.z) * 1.8, -420, 420), a);
    // Break away hard when the player lines up a shot or a lock.
    s.evadeCooldown -= dt;
    if ((pr.dodge ?? 1) > 0 && s.evadeCooldown <= 0) {
      _to.subVectors(e.pos, pp).normalize();
      const aimed = _to.dot(sim.player.aim) > 0.99;
      if (aimed || e.locks > 0) {
        const side = e.pos.x >= pp.x ? 1 : -1;
        e.vel.x += side * 400;
        e.vel.y += rng.sign() * 150;
        s.evadeCooldown = 1.7;
        s.jinkTimer = 0.6;
      }
    }
    if (s.phaseTime > holdTime) setPhase(s, 2);
    return;
  }
  e.vel.z = moveToward(e.vel.z, -780, 500 * dt);
  e.vel.y += 80 * dt;
}

function spline(e: Entity, s: EnemyState, dt: number): void {
  const path = s.spec.path;
  if (!path || path.length < 2) return;
  const dur = s.spec.params.duration ?? 6;
  const u = (s.phaseTime + dt) / dur;
  if (u >= 1) return; // keep last velocity
  catmull(path, u, _dir);
  _dir.add(s.origin);
  e.vel.subVectors(_dir, e.pos).divideScalar(dt);
}

function leave(e: Entity, dt: number): void {
  e.vel.z = moveToward(e.vel.z, -900, 700 * dt);
  e.vel.y += 160 * dt;
}

function setPhase(s: EnemyState, phase: number): void {
  s.phase = phase;
  s.phaseTime = 0;
}

function canFire(sim: Sim, e: Entity, s: EnemyState): boolean {
  if (s.leaving || sim.player.dead || sim.state !== 'playing') return false;
  const z = e.pos.z;
  if (e.layer === 'surface') return z < -300 && z > -2300;
  switch (s.spec.behaviour) {
    case 'pursuit':
      return s.phase === 1;
    case 'strafe':
      return z < -380 && Math.abs(e.pos.x) < 700;
    case 'evade':
      return z < -380 && z > -2000;
    default:
      return z < -380 && z > -2200;
  }
}

function updateGuns(sim: Sim, e: Entity, s: EnemyState, dt: number): void {
  if (!canFire(sim, e, s)) return;
  const fire = s.def.fire;
  for (let i = 0; i < fire.length; i++) {
    const spec = fire[i];
    const g = s.guns[i];
    if (!g) continue;
    g.timer -= dt * tuning.enemy.fireRateScale * sim.fireRateScale;
    if (g.timer <= 0) {
      g.timer += spec.interval * sim.rng.range(0.85, 1.15);
      if (spec.chance === undefined || sim.rng.chance(spec.chance)) {
        g.burstLeft = spec.burst ?? 1;
        g.burstTimer = 0;
      }
    }
    if (g.burstLeft > 0) {
      g.burstTimer -= dt;
      if (g.burstTimer <= 0) {
        fireAt(sim, e.pos, spec);
        if (spec.pattern !== 'homing') sim.events.emit('enemyFire', { enemy: e });
        g.burstLeft--;
        g.burstTimer = spec.burstGap ?? 0.1;
      }
    }
  }
}

/** Fires one trigger of a pattern from `from` at the player (E3). */
export function fireAt(sim: Sim, from: Vector3, spec: FireSpec): void {
  const pe = sim.player.e;
  const speed = (spec.speed ?? 700) * tuning.enemy.bulletSpeedScale * sim.diff.bulletSpeed;
  _dir.subVectors(pe.pos, from);
  const dist = _dir.length();
  if (dist < 140) return; // point-blank shots are unfair and unreadable
  if (spec.pattern === 'leading' || spec.pattern === 'flak') {
    const t = dist / speed;
    _dir.x += pe.vel.x * t;
    _dir.y += pe.vel.y * t;
  }
  _dir.normalize();
  switch (spec.pattern) {
    case 'spread': {
      const n = spec.count ?? 3;
      const step = ((spec.spreadDeg ?? 10) * Math.PI) / 180;
      for (let k = 0; k < n; k++) {
        _q.setFromAxisAngle(Y_AXIS, (k - (n - 1) / 2) * step);
        _u.copy(_dir).applyQuaternion(_q);
        spawnEnemyBullet(sim, from, _u, speed);
      }
      break;
    }
    case 'ring': {
      const n = spec.count ?? 10;
      const cone = ((spec.spreadDeg ?? 12) * Math.PI) / 180;
      _u.set(0, 1, 0).cross(_dir).normalize();
      _w.crossVectors(_dir, _u);
      for (let k = 0; k < n; k++) {
        const phi = (k / n) * Math.PI * 2;
        _face
          .copy(_dir)
          .multiplyScalar(Math.cos(cone))
          .addScaledVector(_u, Math.cos(phi) * Math.sin(cone))
          .addScaledVector(_w, Math.sin(phi) * Math.sin(cone));
        spawnEnemyBullet(sim, from, _face, speed);
      }
      break;
    }
    case 'homing':
      spawnEnemyMissile(sim, from, _dir);
      break;
    case 'flak':
      // Scattered heavy rounds around the predicted position.
      _dir.x += sim.rng.range(-0.035, 0.035);
      _dir.y += sim.rng.range(-0.035, 0.035);
      spawnEnemyBullet(sim, from, _dir.normalize(), speed).radius = 6;
      break;
    default:
      spawnEnemyBullet(sim, from, _dir, speed);
  }
}

export function spawnEnemyBullet(sim: Sim, from: Vector3, dir: Vector3, speed: number): Entity {
  const b = sim.spawn('ebullet', 'ebullet', 'air');
  b.pos.copy(from).addScaledVector(dir, 12);
  b.prev.copy(b.pos);
  b.vel.copy(dir).multiplyScalar(speed);
  b.radius = tuning.enemy.bulletRadius;
  b.life = 4.5;
  b.shot ??= { damage: 1, fromPlayer: false };
  return b;
}

export function spawnEnemyMissile(sim: Sim, from: Vector3, dir: Vector3): Entity {
  const m = sim.spawn('emissile', 'emissile', 'air');
  m.pos.copy(from).addScaledVector(dir, 14);
  m.prev.copy(m.pos);
  const speed = tuning.enemy.missileSpeed;
  m.vel.copy(dir).multiplyScalar(speed);
  m.radius = 5;
  m.hp = m.maxHp = 1;
  m.life = tuning.enemy.missileLife;
  m.missile ??= { targetId: -1, target: null, speed, fromPlayer: false, damage: 2, tracking: true };
  m.missile.speed = speed;
  m.missile.fromPlayer = false;
  m.missile.tracking = true;
  m.missile.target = null;
  lookQuaternion(dir, 0, m.rot);
  m.prevRot.copy(m.rot);
  sim.events.emit('missileFire', { missile: m, fromPlayer: false });
  return m;
}

/** Faces the entity along its world-space velocity and banks into turns. */
function orient(sim: Sim, e: Entity, s: EnemyState, dt: number, snap: boolean): void {
  if (e.motion === 'ground') {
    if (e.vel.lengthSq() > 1) _face.copy(e.vel);
    else _face.set(0, 0, 1);
    lookQuaternion(_face, 0, e.rot);
    return;
  }
  _face.copy(e.vel);
  _face.z -= e.motion === 'player' ? sim.speed : sim.cruiseSpeed;
  _acc.subVectors(e.vel, s.lastVel).divideScalar(Math.max(dt, 1e-3));
  s.lastVel.copy(e.vel);
  lookQuaternion(_face, 0, _q);
  _right.set(1, 0, 0).applyQuaternion(_q);
  const target = clamp(-_acc.dot(_right) * 0.0022, -1.3, 1.3);
  s.bank += (target - s.bank) * approach(snap ? 1000 : 4, dt);
  lookQuaternion(_face, s.bank, _q);
  if (snap) e.rot.copy(_q);
  else e.rot.slerp(_q, approach(6, dt));
}

function catmull(points: number[][], u: number, out: Vector3): Vector3 {
  const n = points.length;
  const f = clamp(u, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const c = (a: number, b: number, cc: number, d: number) =>
    0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
  return out.set(c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2]));
}

/** Makes every live enemy break off and leave (stage overtime). */
export function dismissEnemies(sim: Sim): void {
  for (const e of sim.enemies.items) if (e.alive && e.layer === 'air') e.enemy!.leaving = true;
}
