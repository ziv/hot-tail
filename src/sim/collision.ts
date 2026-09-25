import type { Vector3 } from 'three';

/**
 * Collision (B12): a 3D spatial hash for target bodies and swept segment/sphere
 * tests so fast projectiles never tunnel through small enemies.
 */
export interface Collidable {
  pos: Vector3;
  radius: number;
  /** Scratch stamp used to de-duplicate query results. */
  stamp?: number;
}

export class SpatialHash<T extends Collidable> {
  private readonly cells = new Map<number, T[]>();
  private readonly used: T[][] = [];
  private stampCounter = 0;
  readonly result: T[] = [];

  constructor(private readonly cellSize = 160) {}

  clear(): void {
    for (const list of this.used) list.length = 0;
    this.used.length = 0;
  }

  insert(item: T): void {
    const cs = this.cellSize;
    const r = item.radius;
    const x0 = Math.floor((item.pos.x - r) / cs);
    const x1 = Math.floor((item.pos.x + r) / cs);
    const y0 = Math.floor((item.pos.y - r) / cs);
    const y1 = Math.floor((item.pos.y + r) / cs);
    const z0 = Math.floor((item.pos.z - r) / cs);
    const z1 = Math.floor((item.pos.z + r) / cs);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const k = key(x, y, z);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          if (list.length === 0) this.used.push(list);
          list.push(item);
        }
  }

  /** Collects candidates overlapping the AABB into `result` (no duplicates). */
  queryBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): T[] {
    const cs = this.cellSize;
    const out = this.result;
    out.length = 0;
    const stamp = ++this.stampCounter;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs);
    const y1 = Math.floor(maxY / cs);
    const z0 = Math.floor(minZ / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = this.cells.get(key(x, y, z));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item.stamp === stamp) continue;
            item.stamp = stamp;
            out.push(item);
          }
        }
    return out;
  }
}

function key(x: number, y: number, z: number): number {
  return ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
}

/**
 * First intersection parameter t in [0, 1] of segment a->b with a sphere of
 * radius r centred at the origin, or -1 when they don't touch.
 */
export function segmentSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const c = ax * ax + ay * ay + az * az - r * r;
  if (c <= 0) return 0; // starts inside
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-9) return -1;
  const b = ax * dx + ay * dy + az * dz;
  if (b > 0) return -1; // moving away
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? t : -1;
}

/**
 * Swept test between two moving spheres using their previous and current
 * positions: returns t in [0, 1] or -1.
 */
export function sweptSpheres(
  aPrev: Vector3,
  aPos: Vector3,
  bPrev: Vector3,
  bPos: Vector3,
  radius: number,
): number {
  return segmentSphere(
    aPrev.x - bPrev.x,
    aPrev.y - bPrev.y,
    aPrev.z - bPrev.z,
    aPos.x - bPos.x,
    aPos.y - bPos.y,
    aPos.z - bPos.z,
    radius,
  );
}
