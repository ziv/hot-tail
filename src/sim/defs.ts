import enemyData from '../data/enemies.json';
import jetData from '../data/jets.json';
import type { KillSize, Layer } from './types';

export type BehaviourId = 'flyby' | 'pursuit' | 'formation' | 'strafe' | 'evade' | 'spline' | 'ground';
export type FirePattern = 'aimed' | 'leading' | 'spread' | 'homing' | 'ring' | 'flak';
export type Formation = 'single' | 'line' | 'column' | 'v' | 'circle' | 'scatter';
export type From = 'front' | 'behind' | 'left' | 'right' | 'above';

export interface FireSpec {
  pattern: FirePattern;
  interval: number;
  delay?: number;
  /** Shots per trigger (burst). */
  burst?: number;
  burstGap?: number;
  /** Bullets per shot for spread / ring. */
  count?: number;
  spreadDeg?: number;
  speed?: number;
  /** Probability of firing when the interval elapses. */
  chance?: number;
}

export interface EnemyDef {
  id: string;
  model: string;
  hp: number;
  radius: number;
  score: number;
  behaviour: BehaviourId;
  speed: number;
  size: KillSize;
  fire: FireSpec[];
  /** 'surface' targets sit on the ground/sea and are missile-only. */
  layer?: Layer;
  /** Height above the surface for surface targets. */
  height?: number;
  /** Default behaviour params, overridden by the wave's params. */
  params?: Record<string, number>;
}

/** One enemy to spawn, produced by expanding a wave event. */
export interface SpawnSpec {
  enemy: string;
  behaviour: BehaviourId;
  from: From;
  x: number;
  y: number;
  z: number;
  params: Record<string, number>;
  path?: number[][];
}

export interface WaveEvent {
  t: number;
  type: 'wave';
  enemy: string;
  count?: number;
  formation?: Formation;
  from?: From;
  x?: number;
  y?: number;
  spacing?: number;
  /** Seconds between members entering. */
  stagger?: number;
  behaviour?: BehaviourId;
  params?: Record<string, number>;
  /** Spline behaviour control points [x, y, z] relative to spawn, spread over `duration`. */
  path?: number[][];
  /** Seeded per-run alternatives (F17): one is picked and merged over the event. */
  variants?: Partial<Omit<WaveEvent, 't' | 'type' | 'variants'>>[];
}

export type StageEvent =
  | WaveEvent
  | { t: number; type: 'banner'; text: string; sub?: string; duration?: number }
  | { t: number; type: 'speed'; value: number }
  | { t: number; type: 'music'; track: string }
  | { t: number; type: 'boss'; id: string }
  | { t: number; type: 'loop' }
  | { t: number; type: 'clouds'; on: boolean }
  | { t: number; type: 'callout'; text: string };

export type Biome = 'ocean' | 'desert' | 'mountains' | 'city' | 'harbor' | 'stratosphere';
export type LightingId =
  | 'day'
  | 'dusk'
  | 'sunset'
  | 'desertDay'
  | 'desertDusk'
  | 'mountainDay'
  | 'mountainDusk'
  | 'storm'
  | 'cityNight'
  | 'cityDawn'
  | 'stratoLow'
  | 'stratoSpace';

export interface StageDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  biome: Biome;
  lighting: LightingId;
  /** Allow the seeded left/right mirroring of waves (F17). Default true. */
  mirror?: boolean;
  /** Enemy fire-rate multiplier smoothing the difficulty curve (E10). Default 1. */
  threat?: number;
  cruise: number;
  duration: number;
  music: string;
  /** Rail control points [distance, x, altitude]. */
  rail: [number, number, number][];
  events: StageEvent[];
}

export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(
  Object.entries(enemyData as Record<string, Omit<EnemyDef, 'id'>>).map(([id, d]) => [id, { id, ...d }]),
);

export function enemyDef(id: string): EnemyDef {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Unknown enemy type "${id}"`);
  return def;
}

export type JetId = 'kestrel' | 'dart' | 'manta';

export interface JetDef {
  id: JetId;
  name: string;
  desc: string;
  model: string;
  speed: number;
  handling: number;
  maxLocks: number;
  armor: number;
}

export const JETS: Record<JetId, JetDef> = Object.fromEntries(
  Object.entries(jetData as Record<JetId, Omit<JetDef, 'id'>>).map(([id, d]) => [id, { id, ...d }]),
) as Record<JetId, JetDef>;

export const JET_ORDER: JetId[] = ['kestrel', 'dart', 'manta'];

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyDef {
  fireRate: number;
  bulletSpeed: number;
  enemyMissileTurn: number;
  /** Seconds between successive player locks. */
  lockInterval: number;
  /** Enemy missile speed multiplier. */
  missileSpeed: number;
  /** Per-enemy-type fire-rate overrides from the balance pass (E10). */
  enemyFire: Partial<Record<string, number>>;
}

/** Difficulty changes enemy fire rate, bullet speed and lock timing — never HP. */
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: {
    fireRate: 0.6,
    bulletSpeed: 0.8,
    enemyMissileTurn: 0.65,
    lockInterval: 0.07,
    missileSpeed: 0.85,
    enemyFire: { ace: 0.7, sam: 0.7, destroyer: 0.7, chaser: 0.75, missileboat: 0.6 },
  },
  normal: {
    fireRate: 1,
    bulletSpeed: 1,
    enemyMissileTurn: 1,
    lockInterval: 0.09,
    missileSpeed: 1,
    enemyFire: {},
  },
  hard: {
    fireRate: 1.3,
    bulletSpeed: 1.12,
    enemyMissileTurn: 1.2,
    lockInterval: 0.11,
    missileSpeed: 1.08,
    enemyFire: { drone: 1.2 },
  },
};
