import { Rng } from '@/core/rng';
import type { Sim } from '@/sim/sim';
import { CloudLayer } from './terrain';
import type { LightingPreset } from './environment';

/**
 * Fly-through cloud layer (F6): big soft puffs at the player's altitude that
 * stream past the camera while a stage's `clouds` event is on, cutting
 * visibility so the radar matters.
 */
const COUNT = 80;

export class CloudDeck {
  readonly layer = new CloudLayer(COUNT, 20);
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly size = new Float32Array(COUNT);
  private readonly shade = new Float32Array(COUNT);
  private readonly rng = new Rng(31);
  private opacity = 0;
  private target = 0;
  private off: (() => void) | null = null;

  constructor() {
    for (let i = 0; i < COUNT; i++) this.respawn(i, this.rng.range(-1600, 80));
    this.layer.mesh.renderOrder = 8;
  }

  private respawn(i: number, z: number): void {
    this.pos[i * 3] = this.rng.range(-520, 520);
    this.pos[i * 3 + 1] = this.rng.range(-110, 130);
    this.pos[i * 3 + 2] = z;
    this.size[i] = this.rng.range(110, 260);
    this.shade[i] = this.rng.next();
  }

  bind(sim: Sim): void {
    this.off?.();
    this.off = sim.events.on('clouds', (e) => (this.target = e.on ? 1 : 0));
  }

  reset(): void {
    this.opacity = this.target = 0;
  }

  applyPreset(p: LightingPreset): void {
    this.layer.applyPreset(p);
  }

  update(dt: number, speed: number, px: number, py: number): void {
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 1.2);
    this.layer.mesh.visible = this.opacity > 0.01;
    if (!this.layer.mesh.visible) return;
    this.layer.opacity = this.opacity;
    this.layer.begin();
    for (let i = 0; i < COUNT; i++) {
      let z = this.pos[i * 3 + 2] + speed * dt;
      if (z > 90) {
        this.respawn(i, -1600);
        z = -1600;
      }
      this.pos[i * 3 + 2] = z;
      this.layer.add(
        this.pos[i * 3] + px * 0.3,
        this.pos[i * 3 + 1] + py * 0.3,
        z,
        this.size[i],
        this.shade[i],
      );
    }
    this.layer.end();
  }
}
