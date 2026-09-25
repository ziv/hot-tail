import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SpatialHash, segmentSphere, sweptSpheres } from '@/sim/collision';

describe('segmentSphere', () => {
  it('hits a sphere in the path', () => {
    const t = segmentSphere(-10, 0, 0, 10, 0, 0, 2);
    expect(t).toBeCloseTo(0.4);
  });

  it('misses a sphere off to the side', () => {
    expect(segmentSphere(-10, 5, 0, 10, 5, 0, 2)).toBe(-1);
  });

  it('reports t=0 when starting inside', () => {
    expect(segmentSphere(0.5, 0, 0, 10, 0, 0, 2)).toBe(0);
  });

  it('does not hit when the segment stops short', () => {
    expect(segmentSphere(-10, 0, 0, -5, 0, 0, 2)).toBe(-1);
  });
});

describe('sweptSpheres', () => {
  it('catches a fast bullet crossing a moving target between ticks', () => {
    // Bullet moves 50 units per tick along -z; target moves toward it.
    const bPrev = new Vector3(0, 0, 0);
    const bPos = new Vector3(0, 0, -50);
    const tPrev = new Vector3(0, 0, -40);
    const tPos = new Vector3(0, 0, -30);
    expect(sweptSpheres(bPrev, bPos, tPrev, tPos, 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('SpatialHash', () => {
  it('returns nearby items once, and not distant ones', () => {
    const hash = new SpatialHash<{ pos: Vector3; radius: number; stamp?: number }>(100);
    const near = { pos: new Vector3(10, 0, 10), radius: 150 }; // spans several cells
    const far = { pos: new Vector3(5000, 0, 0), radius: 10 };
    hash.insert(near);
    hash.insert(far);
    const res = hash.queryBox(-50, -50, -50, 250, 50, 250);
    expect(res).toEqual([near]);
    hash.clear();
    expect(hash.queryBox(-50, -50, -50, 50, 50, 50)).toEqual([]);
  });
});
