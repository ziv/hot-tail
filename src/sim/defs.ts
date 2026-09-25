import enemyData from '@/data/enemies.json';
import type { KillSize } from './types';

export type BehaviourId = 'flyby' | 'pursuit' | 'formation' | 'strafe' | 'evade' | 'spline';
export type FirePattern = 'aimed' | 'leading' | 'spread' | 'homing' | 'ring';
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
}

export type StageEvent =
  | WaveEvent
  | { t: number; type: 'banner'; text: string; sub?: string; duration?: number }
  | { t: number; type: 'speed'; value: number }
  | { t: number; type: 'music'; track: string }
  | { t: number; type: 'boss'; id: string };

export interface StageDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  biome: 'ocean';
  lighting: 'day' | 'dusk' | 'sunset';
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
