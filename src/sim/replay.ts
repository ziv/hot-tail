import type { InputFrame } from './types';
import type { SimOptions } from './sim';

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

// ---------------------------------------------------------------- run replays

/**
 * Bump whenever simulation behaviour changes: a run replay only validates
 * against the exact sim that recorded it (J4).
 */
export const SIM_VERSION = 5;

export interface RunMark {
  tick: number;
  kind: 'stage' | 'refuel';
  stage?: number;
}

/** A whole run segment (from start or last continue): what the server re-simulates. */
export interface RunReplay {
  simVersion: number;
  seed: number;
  options: SimOptions;
  startStage: number;
  marks: RunMark[];
  frames: Int8Array;
  ticks: number;
}

export class RunRecorder {
  private readonly rec: ReplayRecorder;
  readonly marks: RunMark[] = [];
  private count = 0;

  constructor(
    readonly seed: number,
    readonly options: SimOptions,
    readonly startStage: number,
  ) {
    this.rec = new ReplayRecorder(seed, startStage);
  }

  get ticks(): number {
    return this.count;
  }

  record(input: InputFrame): void {
    this.rec.record(input);
    this.count++;
  }

  /** Records a flow event applied before the next recorded tick. */
  mark(kind: RunMark['kind'], stage?: number): void {
    this.marks.push({ tick: this.count, kind, stage });
  }

  finish(): RunReplay {
    const r = this.rec.finish();
    return {
      simVersion: SIM_VERSION,
      seed: this.seed,
      options: { ...this.options },
      startStage: this.startStage,
      marks: this.marks.map((m) => ({ ...m })),
      frames: r.frames,
      ticks: r.ticks,
    };
  }
}

/** Run-length encodes 3-byte frames as [count, x, y, buttons] quads (inputs repeat a lot). */
export function rleEncode(frames: Int8Array): Uint8Array {
  const out: number[] = [];
  const n = frames.length / 3;
  let i = 0;
  while (i < n) {
    const x = frames[i * 3];
    const y = frames[i * 3 + 1];
    const b = frames[i * 3 + 2];
    let run = 1;
    while (
      i + run < n &&
      run < 255 &&
      frames[(i + run) * 3] === x &&
      frames[(i + run) * 3 + 1] === y &&
      frames[(i + run) * 3 + 2] === b
    )
      run++;
    out.push(run, x & 0xff, y & 0xff, b & 0xff);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(data: Uint8Array): Int8Array {
  let total = 0;
  for (let i = 0; i < data.length; i += 4) total += data[i];
  const out = new Int8Array(total * 3);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < data[i]; k++) {
      out[o++] = (data[i + 1] << 24) >> 24;
      out[o++] = (data[i + 2] << 24) >> 24;
      out[o++] = (data[i + 3] << 24) >> 24;
    }
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeRun(r: RunReplay): string {
  return JSON.stringify({
    v: r.simVersion,
    seed: r.seed,
    options: r.options,
    start: r.startStage,
    marks: r.marks,
    frames: toBase64(rleEncode(r.frames)),
  });
}

export function decodeRun(text: string): RunReplay {
  const j = JSON.parse(text) as {
    v: number;
    seed: number;
    options: SimOptions;
    start: number;
    marks: RunMark[];
    frames: string;
  };
  const frames = rleDecode(fromBase64(j.frames));
  return {
    simVersion: j.v,
    seed: j.seed >>> 0,
    options: j.options,
    startStage: j.start,
    marks: j.marks ?? [],
    frames,
    ticks: frames.length / 3,
  };
}
