import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { Rng } from '@/core/rng';

/** Streaks rushing past the camera; stronger on afterburner. */
export class SpeedLines {
  readonly mesh: LineSegments;
  private readonly positions: Float32Array;
  private readonly seeds: Float32Array;
  private readonly mat: LineBasicMaterial;
  private readonly rng = new Rng(9);

  constructor(private readonly count = 90) {
    this.positions = new Float32Array(count * 6);
    this.seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.respawn(i, this.rng.range(-900, 60));
    const geo = new BufferGeometry();
    const attr = new Float32BufferAttribute(this.positions, 3);
    attr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', attr);
    this.mat = new LineBasicMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  private respawn(i: number, z: number): void {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(28, 140);
    this.seeds[i * 3] = Math.cos(a) * r * 1.4;
    this.seeds[i * 3 + 1] = Math.sin(a) * r * 0.8 + 10;
    this.seeds[i * 3 + 2] = z;
  }

  update(dt: number, speed: number, cruise: number, camX: number, camY: number): void {
    const boost = Math.max(0, (speed - cruise) / (cruise * 0.6));
    this.mat.opacity = 0.12 + boost * 0.4;
    const len = 20 + speed * 0.09 + boost * 60;
    for (let i = 0; i < this.count; i++) {
      let z = this.seeds[i * 3 + 2] + speed * 2.4 * dt;
      if (z > 70) {
        this.respawn(i, -900);
        z = -900;
      }
      this.seeds[i * 3 + 2] = z;
      const x = this.seeds[i * 3] + camX;
      const y = this.seeds[i * 3 + 1] + camY;
      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x;
      this.positions[o + 4] = y;
      this.positions[o + 5] = z - len;
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
  }
}
