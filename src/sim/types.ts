import { Quaternion, Vector3 } from 'three';
import type { BaseEntity } from '../core/ecs';
import type { EnemyDef, SpawnSpec } from './defs';
import type { PartDef } from './boss';

/**
 * How an entity's position is integrated relative to the moving frame.
 *  - player: pure frame coordinates (player, player shots)
 *  - air:    frame coordinates at cruise speed; throttle changes make them drift
 *            (afterburner outruns enemy fire, air-brake lets chasers overshoot)
 *  - ground: anchored to the world; scrolls with rail distance and rail offset
 */
export type Motion = 'player' | 'air' | 'ground';

export type EntityKind =
  | 'player'
  | 'enemy'
  | 'bullet'
  | 'ebullet'
  | 'missile'
  | 'emissile'
  | 'boss'
  | 'bossPart'
  | 'flare'
  | 'support';

export interface GunState {
  timer: number;
  burstLeft: number;
  burstTimer: number;
}

export type Layer = 'air' | 'surface';

export interface EnemyState {
  def: EnemyDef;
  spec: SpawnSpec;
  /** Behaviour phase index and phase timer. */
  phase: number;
  phaseTime: number;
  /** Behaviour-local origin (formation centre / spawn point). */
  origin: Vector3;
  /** Member index inside its wave formation. */
  member: number;
  guns: GunState[];
  bank: number;
  lastVel: Vector3;
  /** Behaviour-specific scratch (steer velocity, break direction...). */
  aux: Vector3;
  jinkTimer: number;
  jinkTarget: Vector3;
  evadeCooldown: number;
  /** Has been within the player's reach; used to despawn only after passing. */
  engaged: boolean;
  leaving: boolean;
}

export interface ShotState {
  damage: number;
  fromPlayer: boolean;
}

export interface MissileState {
  targetId: number;
  target: Entity | null;
  speed: number;
  fromPlayer: boolean;
  damage: number;
  /** Enemy missiles stop tracking once they overshoot the player. */
  tracking: boolean;
}

export interface BossPartState {
  boss: Entity;
  offset: Vector3;
  phase: number;
  role: 'turret' | 'engine' | 'core';
  fireTimer: number;
  destroyed: boolean;
  def: PartDef;
}

export interface BossState {
  id: string;
  name: string;
  phase: number;
  parts: Entity[];
  totalHp: number;
  entering: boolean;
  dying: number;
  spawnTimer: number;
  /** Attitude (Euler XYZ) accumulated by spin and death spirals. */
  spin: number;
  dieRoll: number;
  diePitch: number;
  /** Jink target (stealth ace) and timer. */
  jink: { x: number; y: number; z: number; t: number };
  /** Seconds of cloak remaining (0 = visible) and time to next cloak. */
  cloak: number;
  cloakTimer: number;
}

export interface Entity extends BaseEntity {
  kind: EntityKind;
  model: string;
  motion: Motion;
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  rot: Quaternion;
  prevRot: Quaternion;
  radius: number;
  age: number;
  /** Seconds before auto-removal; 0 = unlimited. */
  life: number;
  hp: number;
  maxHp: number;
  hitFlash: number;
  lockable: boolean;
  /** Number of player locks currently on this entity. */
  locks: number;
  /** Set on removal so renderers can tell a kill from a despawn. */
  killed: boolean;
  /** Surface targets (ground/sea) are immune to the vulcan: missiles only. */
  layer: Layer;
  enemy?: EnemyState;
  shot?: ShotState;
  missile?: MissileState;
  bossPart?: BossPartState;
  boss?: BossState;
}

export function createEntity(kind: EntityKind, model: string, motion: Motion): Entity {
  return {
    id: 0,
    alive: false,
    kind,
    model,
    motion,
    pos: new Vector3(),
    prev: new Vector3(),
    vel: new Vector3(),
    rot: new Quaternion(),
    prevRot: new Quaternion(),
    radius: 1,
    age: 0,
    life: 0,
    hp: 1,
    maxHp: 1,
    hitFlash: 0,
    lockable: false,
    locks: 0,
    killed: false,
    layer: 'air',
  };
}

/** Per-tick input snapshot. Axes are quantised so replays are bit-exact. */
export interface InputFrame {
  x: number;
  y: number;
  buttons: number;
}

export const Btn = {
  Fire: 1,
  Lock: 2,
  Roll: 4,
  Boost: 8,
  Brake: 16,
  Flare: 32,
} as const;

export const EMPTY_INPUT: InputFrame = { x: 0, y: 0, buttons: 0 };

export type Throttle = 'cruise' | 'boost' | 'brake';

export type KillSize = 'small' | 'medium' | 'large' | 'huge';

export interface StageStats {
  shotsFired: number;
  shotsHit: number;
  missilesFired: number;
  kills: number;
  spawned: number;
  damageTaken: number;
  deaths: number;
}

export interface BonusTally {
  hitRate: number;
  hitRateBonus: number;
  killRate: number;
  killBonus: number;
  noDamage: boolean;
  damageBonus: number;
  total: number;
}

export interface SimEvents {
  vulcan: { x: number; y: number; z: number };
  lockOn: { target: Entity; count: number };
  missileFire: { missile: Entity; fromPlayer: boolean };
  enemyFire: { enemy: Entity };
  hit: { target: Entity; x: number; y: number; z: number; armored: boolean };
  kill: {
    target: Entity;
    x: number;
    y: number;
    z: number;
    score: number;
    multiplier: number;
    size: KillSize;
  };
  playerHit: { damage: number; armor: number };
  playerDeath: { x: number; y: number; z: number };
  playerRespawn: { lives: number };
  roll: { dir: number };
  throttle: { state: Throttle };
  banner: { text: string; sub: string; duration: number };
  music: { track: string };
  stageStart: { index: number; name: string };
  stageClear: { stats: StageStats; bonus: BonusTally };
  bossSpawn: { name: string };
  bossPhase: { phase: number };
  bossDefeated: { x: number; y: number; z: number };
  explosion: { x: number; y: number; z: number; size: KillSize };
  extraLife: { lives: number };
  gameOver: { score: number };
  flare: { x: number; y: number; z: number; decoyed: number };
  loop: { duration: number };
  refuelStart: Record<string, never>;
  refuelDone: { bonus: number };
  callout: { text: string };
  clouds: { on: boolean };
}
