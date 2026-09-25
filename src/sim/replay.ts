import type { InputFrame } from './types';

/**
 * Input recording and replay (B7). Each tick stores quantised stick axes and a
 * button mask in 3 bytes, so a 90 s stage is ~16 KB before compression.
 */
export function quantize(v: number): number {
  const q = Math.round(Math.max(-1, Math.min(1, v)) * 127);
  return q / 127;
}

export function quantizeInput(input: InputFrame, out: InputFrame): InputFrame {
  out.x = quantize(input.x);
  out.y = quantize(input.y);
  out.buttons = input.buttons & 0xff;
  return out;
}

export interface Replay {
  seed: number;
  stage: number;
  frames: Int8Array;
  ticks: number;
}

export class ReplayRecorder {
  private buf = new Int8Array(3 * 60 * 120);
  private ticks = 0;

  constructor(
    readonly seed: number,
    readonly stage: number,
  ) {}

  record(input: InputFrame): void {
    const i = this.ticks * 3;
    if (i + 3 > this.buf.length) {
      const next = new Int8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[i] = Math.round(input.x * 127);
    this.buf[i + 1] = Math.round(input.y * 127);
    this.buf[i + 2] = input.buttons & 0x7f;
    this.ticks++;
  }

  finish(): Replay {
    return {
      seed: this.seed,
      stage: this.stage,
      frames: this.buf.slice(0, this.ticks * 3),
      ticks: this.ticks,
    };
  }
}

export class ReplayPlayer {
  private tick = 0;
  constructor(readonly replay: Replay) {}

  get done(): boolean {
    return this.tick >= this.replay.ticks;
  }

  next(out: InputFrame): InputFrame {
    const f = this.replay.frames;
    const i = Math.min(this.tick, this.replay.ticks - 1) * 3;
    out.x = (f[i] ?? 0) / 127;
    out.y = (f[i + 1] ?? 0) / 127;
    out.buttons = f[i + 2] ?? 0;
    this.tick++;
    return out;
  }
}
