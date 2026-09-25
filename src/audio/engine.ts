/**
 * Audio engine (H1): one AudioContext created/resumed on the first user
 * gesture (required by iOS Safari), a master compressor and music/SFX buses.
 */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  private musicDuck!: GainNode;
  noise!: AudioBuffer;
  readonly volumes: Volumes = { master: 0.8, music: 0.55, sfx: 0.8 };
  private readyCallbacks: (() => void)[] = [];

  constructor() {
    const unlock = () => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchend', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  onReady(fn: () => void): void {
    if (this.ready) fn();
    else this.readyCallbacks.push(fn);
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      // H9 mix: glue compressor → brick-wall limiter so stacked explosions never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      comp.connect(limiter).connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.musicDuck = ctx.createGain();
      this.musicDuck.connect(this.master);
      this.music = ctx.createGain();
      this.music.connect(this.musicDuck);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.noise = makeNoise(ctx);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.flushReady());
    } else this.flushReady();
  }

  private flushReady(): void {
    const cbs = this.readyCallbacks;
    this.readyCallbacks = [];
    for (const fn of cbs) fn();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  /** Briefly lowers music under loud events (ducking). */
  duck(amount: number, hold: number): void {
    if (!this.ctx) return;
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amount, t + 0.03);
    g.setTargetAtTime(1, t + hold, 0.25);
  }

  /** Sets a sustained music attenuation (e.g. pause menu). */
  setMusicDim(dim: boolean): void {
    if (!this.ctx) return;
    this.musicDuck.gain.setTargetAtTime(dim ? 0.35 : 1, this.ctx.currentTime, 0.15);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    d[i] = (seed / 4294967296) * 2 - 1;
  }
  return buf;
}
