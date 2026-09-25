import type { AudioEngine } from './engine';

/**
 * Synthesised SFX (placeholders for H7) with simple stereo positioning and
 * per-sound voice limiting (H3). Everything is generated from oscillators and
 * a shared noise buffer, so there are no audio downloads.
 */
interface Limit {
  max: number;
  minGap: number;
  active: number;
  last: number;
}

export class Sfx {
  private readonly limits = new Map<string, Limit>();
  private engineNodes: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    nGain: GainNode;
    nFilter: BiquadFilterNode;
  } | null = null;
  private alarmTimer = 0;
  private alarmOn = false;

  constructor(private readonly audio: AudioEngine) {}

  private get ctx(): AudioContext | null {
    return this.audio.ready ? this.audio.ctx : null;
  }

  private allow(name: string, max: number, minGap: number, duration: number): boolean {
    const ctx = this.ctx!;
    let l = this.limits.get(name);
    if (!l) this.limits.set(name, (l = { max, minGap, active: 0, last: -1 }));
    const now = ctx.currentTime;
    if (l.active >= l.max || now - l.last < l.minGap) return false;
    l.active++;
    l.last = now;
    setTimeout(() => l!.active--, duration * 1000);
    return true;
  }

  /** Output chain with stereo pan and distance attenuation. */
  private out(x = 0, dist = 0, gain = 1): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain / (1 + dist / 700);
    if (x !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, x / 260));
      g.connect(p).connect(this.audio.sfx);
    } else g.connect(this.audio.sfx);
    return g;
  }

  private noiseSrc(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.audio.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private env(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  vulcan(): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow('vulcan', 3, 0.035, 0.08)) return;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.35, 0.002, 0.05);
    n.connect(f)
      .connect(g)
      .connect(this.out(0, 0, 0.7));
    n.start(t);
    n.stop(t + 0.07);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.04);
    const og = ctx.createGain();
    this.env(og.gain, t, 0.12, 0.002, 0.04);
    o.connect(og).connect(this.out(0, 0, 0.6));
    o.start(t);
    o.stop(t + 0.06);
  }

  lockTone(count: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 900 + count * 140;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.12, 0.004, 0.07);
    o.connect(g).connect(this.out(0, 0, 0.5));
    o.start(t);
    o.stop(t + 0.1);
  }

  missileLaunch(x: number, enemy: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow(enemy ? 'emissile' : 'missile', 4, 0.03, 0.7)) return;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(enemy ? 600 : 3000, t);
    f.frequency.exponentialRampToValueAtTime(enemy ? 2400 : 500, t + 0.6);
    const g = ctx.createGain();
    this.env(g.gain, t, enemy ? 0.4 : 0.5, 0.02, 0.6);
    n.connect(f)
      .connect(g)
      .connect(this.out(x, 0, 0.8));
    n.start(t);
    n.stop(t + 0.7);
  }

  explosion(size: 'small' | 'medium' | 'large' | 'huge', x: number, dist: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow('explosion', 6, 0.03, 1.2)) return;
    const t = ctx.currentTime;
    const s = size === 'small' ? 0.6 : size === 'medium' ? 1 : size === 'large' ? 1.5 : 2.4;
    const n = this.noiseSrc();
    n.playbackRate.value = 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.4 * s + 0.3);
    const g = ctx.createGain();
    this.env(g.gain, t, Math.min(1, 0.5 * s), 0.005, 0.35 * s + 0.3);
    n.connect(f)
      .connect(g)
      .connect(this.out(x, dist, 0.9));
    n.start(t);
    n.stop(t + 0.5 * s + 0.5);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.35 * s);
    const og = ctx.createGain();
    this.env(og.gain, t, Math.min(1, 0.6 * s), 0.005, 0.3 * s);
    o.connect(og).connect(this.out(x, dist, 1));
    o.start(t);
    o.stop(t + 0.4 * s + 0.1);
    if (s >= 1.5) this.audio.duck(0.5, 0.25 * s);
  }

  hit(armored: boolean, x: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow('hit', 4, 0.04, 0.1)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = armored ? 'triangle' : 'square';
    o.frequency.setValueAtTime(armored ? 2600 : 700, t);
    o.frequency.exponentialRampToValueAtTime(armored ? 1800 : 250, t + 0.06);
    const g = ctx.createGain();
    this.env(g.gain, t, armored ? 0.12 : 0.1, 0.002, 0.07);
    o.connect(g).connect(this.out(x, 0, 0.6));
    o.start(t);
    o.stop(t + 0.1);
  }

  enemyFire(x: number, dist: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.allow('efire', 4, 0.05, 0.15)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.12);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.12, 0.003, 0.11);
    o.connect(g).connect(this.out(x, dist, 0.5));
    o.start(t);
    o.stop(t + 0.15);
  }

  playerHit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(55, t + 0.3);
    const ws = ctx.createWaveShaper();
    ws.curve = distortionCurve(40);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.5, 0.005, 0.35);
    o.connect(ws)
      .connect(g)
      .connect(this.out(0, 0, 0.8));
    o.start(t);
    o.stop(t + 0.4);
  }

  roll(dir: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.4, 0.15, 0.45);
    n.connect(f)
      .connect(g)
      .connect(this.out(dir * 150, 0, 0.8));
    n.start(t);
    n.stop(t + 0.7);
  }

  flare(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const n = this.noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      this.env(g.gain, t + i * 0.07, 0.35, 0.003, 0.18);
      n.connect(f)
        .connect(g)
        .connect(this.out((i - 1) * 80, 0, 0.7));
      n.start(t + i * 0.07);
      n.stop(t + i * 0.07 + 0.25);
    }
  }

  jingle(notes: number[], step = 0.09, type: OscillatorType = 'square'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    notes.forEach((n, i) => {
      const t = t0 + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
      const g = ctx.createGain();
      this.env(g.gain, t, 0.12, 0.005, step * 1.6);
      o.connect(g).connect(this.out(0, 0, 0.7));
      o.start(t);
      o.stop(t + step * 2);
    });
  }

  uiMove(): void {
    this.jingle([84], 0.04, 'triangle');
  }

  uiSelect(): void {
    this.jingle([79, 86], 0.05, 'square');
  }

  extraLife(): void {
    this.jingle([72, 76, 79, 84, 88], 0.07);
  }

  /** Incoming-missile alarm: call every frame with the threat state. */
  alarm(active: boolean, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!active) {
      this.alarmOn = false;
      return;
    }
    if (!this.alarmOn) this.alarmTimer = 0;
    this.alarmOn = true;
    this.alarmTimer -= dt;
    if (this.alarmTimer > 0) return;
    this.alarmTimer = 0.32;
    const t = ctx.currentTime;
    for (const [i, f] of [
      [0, 1320],
      [1, 990],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g.gain, t + i * 0.08, 0.09, 0.003, 0.06);
      o.connect(g).connect(this.out(0, 0, 0.6));
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.1);
    }
  }

  /** Jet engine loop (H2): pitch and brightness follow the throttle. */
  engine(on: boolean, speedFactor: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.engineNodes) {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc2.detune.value = 14;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const n = this.noiseSrc();
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = 900;
      nFilter.Q.value = 0.6;
      const nGain = ctx.createGain();
      nGain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.audio.sfx);
      n.connect(nFilter).connect(nGain).connect(this.audio.sfx);
      osc1.start();
      osc2.start();
      n.start();
      this.engineNodes = { osc1, osc2, filter, gain, nGain, nFilter };
    }
    const e = this.engineNodes;
    if (!e) return;
    const t = ctx.currentTime;
    const boost = Math.max(0, (speedFactor - 1) / 0.6);
    const f = 48 * (0.75 + 0.45 * speedFactor);
    e.osc1.frequency.setTargetAtTime(f, t, 0.1);
    e.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.1);
    e.filter.frequency.setTargetAtTime(380 + 1400 * boost + 200 * speedFactor, t, 0.1);
    e.gain.gain.setTargetAtTime(on ? 0.07 + 0.05 * boost : 0, t, 0.15);
    e.nFilter.frequency.setTargetAtTime(700 + 2200 * boost, t, 0.1);
    e.nGain.gain.setTargetAtTime(on ? 0.1 + 0.16 * boost : 0, t, 0.15);
  }
}

function distortionCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return c;
}

export { distortionCurve };
