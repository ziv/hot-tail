/**
 * Fixed-timestep main loop (B1): the simulation ticks at a fixed rate from an
 * accumulator; rendering runs once per animation frame with an interpolation
 * factor between the previous and current simulation states.
 */
export interface LoopHooks {
  tick(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

export class GameLoop {
  /** When true the simulation does not advance, but rendering continues. */
  paused = false;
  /** Scales simulation speed (debug slow-mo). */
  timeScale = 1;
  /** Render/tick cap in frames per second (0 = display rate) for mobile thermals (K6). */
  maxFps = 0;
  private acc = 0;
  private last = -1;
  private raf = 0;
  private readonly maxSteps = 5;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.raf) return;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    // Skipped frames fold into the next frame's dt, so simulation time is exact.
    if (this.maxFps > 0 && this.last >= 0 && now - this.last < 1000 / this.maxFps - 2) return;
    let frameDt = this.last < 0 ? TICK_DT : (now - this.last) / 1000;
    this.last = now;
    // Clamp long stalls (tab switches, breakpoints) so we don't spiral.
    if (frameDt > 0.25) frameDt = 0.25;

    if (!this.paused) {
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= TICK_DT && steps < this.maxSteps) {
        this.hooks.tick(TICK_DT);
        this.acc -= TICK_DT;
        steps++;
      }
      if (steps === this.maxSteps) this.acc = 0;
    }
    this.hooks.render(this.paused ? 1 : this.acc / TICK_DT, frameDt);
  };
}
