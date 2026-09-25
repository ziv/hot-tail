import { PerspectiveCamera, Vector3 } from 'three';
import { approach } from '@/sim/math';
import type { Sim } from '@/sim/sim';

/**
 * Chase camera (B14): follows the jet inside the envelope with lag, rolls a
 * little with the bank, kicks FOV on afterburner and shakes on trauma.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(70, 1, 1, 12000);
  private readonly pos = new Vector3(0, 15, 58);
  private readonly look = new Vector3(0, 6, -260);
  private readonly tmp = new Vector3();
  private trauma = 0;
  private roll = 0;
  private fov = 70;
  private yaw = 0;
  /** User setting: 0 disables screen shake (accessibility). */
  shakeScale = 1;

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(sim: Sim, player: Vector3, dt: number, time: number, aspect: number): void {
    const p = sim.player;
    const k = approach(9, dt);
    this.tmp.set(player.x * 0.78, player.y * 0.72 + 13, 58);
    this.pos.lerp(this.tmp, k);
    this.tmp.set(player.x * 0.85, player.y * 0.8 + 6, -260);
    this.look.lerp(this.tmp, k);

    // Look slightly into rail turns.
    const dd = sim.dist - sim.prevDist;
    const slope = dd > 0 ? (sim.railNow.x - sim.railPrev.x) / dd : 0;
    this.yaw += (slope * 0.35 - this.yaw) * approach(2, dt);

    this.roll += (p.bank * 0.09 - this.roll) * approach(5, dt);
    const power = (p.speedFactor - 1) / 0.6;
    const targetFov = 68 + Math.max(0, power) * 13 + Math.min(0, power) * 6;
    this.fov += (targetFov - this.fov) * approach(4, dt);

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    this.tmp.copy(this.look);
    this.tmp.x += this.yaw * 260;
    cam.lookAt(this.tmp);

    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * this.shakeScale;
      cam.position.x += s * 5 * Math.sin(time * 53.1);
      cam.position.y += s * 4 * Math.sin(time * 61.7 + 1.3);
      cam.rotateZ(s * 0.05 * Math.sin(time * 47.3 + 2.1));
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }

    // Keep horizontal coverage on portrait screens by widening vertical FOV.
    let fov = this.fov;
    if (aspect < 1.3) {
      const h = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 1.3);
      fov = Math.min(105, (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI);
    }
    if (Math.abs(cam.fov - fov) > 0.01 || cam.aspect !== aspect) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }
}
