import type { AudioEngine } from './engine';
import { distortionCurve } from './sfx';

/**
 * Music system (H4): a lookahead step sequencer playing procedurally
 * synthesised 80s hard-rock/synthwave loops, with crossfades between tracks.
 * These are placeholders for the contracted soundtrack (H6); the song format
 * is data so real stems can replace them later without touching game code.
 */
interface Song {
  bpm: number;
  roots: number[]; // bass root (MIDI) per bar
  kick: string;
  snare: string;
  hat: string;
  bass: string; // x = root, o = octave, . = rest
  guitar: string; // x = power-chord stab
  lead: string[]; // one bar per entry: "E5:3 D5:1 -:4"
  arp?: boolean;
}

const SONGS: Record<string, Song> = {
  title: {
    bpm: 118,
    roots: [45, 41, 43, 40],
    kick: 'x.......x.......',
    snare: '........x.......',
    hat: '..x...x...x...x.',
    bass: 'x...x...x...x.o.',
    guitar: '................',
    lead: ['A4:12 -:4', 'C5:8 A4:8', 'B4:12 -:4', 'G#4:16'],
    arp: true,
  },
  ocean: {
    bpm: 150,
    roots: [45, 41, 48, 43, 45, 41, 43, 40],
    kick: 'x...x...x.x.x...',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    bass: 'x.xox.xox.xox.xo',
    guitar: 'x..x..x...x.x...',
    lead: [
      'E5:3 E5:1 D5:2 E5:2 A5:4 G5:2 E5:2',
      'F5:4 E5:2 C5:2 D5:6 -:2',
      'E5:3 E5:1 D5:2 E5:2 G5:4 A5:2 G5:2',
      'D5:8 B4:4 -:4',
      'C6:4 B5:2 A5:2 G5:4 E5:4',
      'F5:4 A5:4 C6:6 -:2',
      'B5:4 A5:2 G5:2 D5:4 G5:4',
      'G#5:8 B5:4 E6:4',
    ],
  },
  boss: {
    bpm: 168,
    roots: [38, 34, 36, 33, 38, 34, 36, 33],
    kick: 'x.x.x.x.x.x.x.x.',
    snare: '....x.......x..x',
    hat: 'xxxxxxxxxxxxxxxx',
    bass: 'xxxxxxxxxxxxxxxx',
    guitar: 'x.x.x.x.x..x.x..',
    lead: [
      'D5:2 F5:2 A5:2 D6:2 C6:4 A5:4',
      'A#5:4 A5:2 G5:2 F5:4 D5:4',
      'E5:2 G5:2 C6:2 E6:2 D6:4 C6:4',
      'C#6:6 E6:2 A5:8',
      'D6:4 -:2 D6:2 F6:4 E6:4',
      'D6:4 A#5:4 G5:4 F5:4',
      'E5:2 G5:2 C6:4 A#5:4 G5:4',
      'A5:8 C#6:4 E6:4',
    ],
  },
};

const NOTE: Record<string, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

function parseNote(s: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(s);
  if (!m) return -1;
  return NOTE[m[1]] + (Number(m[2]) + 1) * 12;
}

/** Expands lead bars into per-step [note, lengthInSteps] (note -1 = none). */
function parseLead(bars: string[]): [number, number][] {
  const steps: [number, number][] = [];
  for (const bar of bars) {
    const start = steps.length;
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      const [n, d] = tok.split(':');
      const len = Number(d);
      steps.push([n === '-' ? -1 : parseNote(n), len]);
      for (let i = 1; i < len; i++) steps.push([-1, 0]);
    }
    while (steps.length < start + 16) steps.push([-1, 0]);
    steps.length = start + 16;
  }
  return steps;
}

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class Playback {
  readonly gain: GainNode;
  step = 0;
  nextTime: number;
  private readonly lead: [number, number][];
  private readonly shaper: WaveShaperNode;
  private readonly guitarBus: GainNode;

  constructor(
    private readonly audio: AudioEngine,
    readonly name: string,
    readonly song: Song,
  ) {
    const ctx = audio.ctx!;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(audio.music);
    this.nextTime = ctx.currentTime + 0.08;
    this.lead = parseLead(song.lead);
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = distortionCurve(60);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.16;
    this.shaper.connect(lp).connect(this.guitarBus).connect(this.gain);
  }

  get stepDur(): number {
    return 60 / this.song.bpm / 4;
  }

  schedule(until: number): void {
    const now = this.audio.ctx!.currentTime;
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.05; // resumed after a suspend
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % (this.song.roots.length * 16);
    }
  }

  private playStep(step: number, t: number): void {
    const s = this.song;
    const i = step % 16;
    const bar = Math.floor(step / 16) % s.roots.length;
    const root = s.roots[bar];
    if (s.kick[i] === 'x') this.kick(t);
    if (s.snare[i] === 'x') this.snare(t);
    if (s.hat[i] === 'x') this.hat(t, i % 4 === 2 ? 0.07 : 0.045);
    if (s.bass[i] === 'x') this.bass(t, root);
    else if (s.bass[i] === 'o') this.bass(t, root + 12);
    if (s.guitar[i] === 'x') this.guitar(t, root + 12);
    const [note, len] = this.lead[step % this.lead.length];
    if (note > 0) this.leadNote(t, note, len * this.stepDur);
    if (s.arp) {
      const minor = [0, 3, 7, 12, 15, 19, 24, 19];
      const major = [0, 4, 7, 12, 16, 19, 24, 19];
      const chord = root % 12 === 5 || root % 12 === 7 ? major : minor;
      this.arpNote(t, root + 24 + chord[i % 8]);
    }
  }

  private ctx(): AudioContext {
    return this.audio.ctx!;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const ctx = this.ctx();
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.9, 0.002, 0.22);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number): void {
    const ctx = this.ctx();
    const n = ctx.createBufferSource();
    n.buffer = this.audio.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    this.env(g, t, 0.45, 0.002, 0.16);
    n.connect(hp).connect(g).connect(this.gain);
    n.start(t, Math.random());
    n.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 190;
    const og = ctx.createGain();
    this.env(og, t, 0.3, 0.002, 0.08);
    o.connect(og).connect(this.gain);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.ctx();
    const n = ctx.createBufferSource();
    n.buffer = this.audio.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.001, 0.03);
    n.connect(hp).connect(g).connect(this.gain);
    n.start(t, Math.random());
    n.stop(t + 0.05);
  }

  private bass(t: number, note: number): void {
    const ctx = this.ctx();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + this.stepDur * 1.6);
    const g = ctx.createGain();
    this.env(g, t, 0.3, 0.004, this.stepDur * 1.7);
    o.connect(f).connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + this.stepDur * 2);
  }

  private guitar(t: number, root: number): void {
    const ctx = this.ctx();
    const g = ctx.createGain();
    this.env(g, t, 0.6, 0.004, this.stepDur * 2.4);
    g.connect(this.shaper);
    for (const [iv, det] of [
      [0, -6],
      [7, 5],
      [12, 3],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq(root + iv);
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + this.stepDur * 2.6);
    }
  }

  private leadNote(t: number, note: number, dur: number): void {
    const ctx = this.ctx();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.012);
    g.gain.setValueAtTime(0.085, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    g.connect(lp).connect(this.gain);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = ctx.createGain();
    vibG.gain.value = dur > 0.3 ? 9 : 0;
    vib.connect(vibG);
    for (const [type, det] of [
      ['square', -7],
      ['sawtooth', 7],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq(note);
      o.detune.value = det;
      vibG.connect(o.detune);
      o.connect(g);
      o.start(t);
      o.stop(t + dur);
    }
    vib.start(t);
    vib.stop(t + dur);
  }

  private arpNote(t: number, note: number): void {
    const ctx = this.ctx();
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq(note);
    const g = ctx.createGain();
    this.env(g, t, 0.07, 0.003, this.stepDur * 0.9);
    o.connect(g).connect(this.gain);
    o.start(t);
    o.stop(t + this.stepDur);
  }

  fade(to: number, time: number): void {
    const t = this.audio.ctx!.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(to, t + time);
  }

  dispose(): void {
    this.gain.disconnect();
  }
}

export class Music {
  private current: Playback | null = null;
  private fading: Playback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private wanted: string | null = null;

  constructor(private readonly audio: AudioEngine) {
    audio.onReady(() => {
      if (this.wanted) this.play(this.wanted);
    });
  }

  get track(): string | null {
    return this.wanted;
  }

  play(name: string, fade = 1): void {
    this.wanted = name;
    if (!this.audio.ready) return;
    if (this.current?.name === name) return;
    const song = SONGS[name];
    if (!song) return;
    this.release(fade);
    const pb = new Playback(this.audio, name, song);
    pb.fade(1, Math.max(0.05, fade * 0.6));
    this.current = pb;
    this.ensureTimer();
  }

  stop(fade = 1): void {
    this.wanted = null;
    this.release(fade);
  }

  private release(fade: number): void {
    const old = this.current;
    if (!old) return;
    old.fade(0, fade);
    this.fading.push(old);
    this.current = null;
    setTimeout(
      () => {
        old.dispose();
        this.fading = this.fading.filter((p) => p !== old);
      },
      fade * 1000 + 300,
    );
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const ctx = this.audio.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const until = ctx.currentTime + 0.12;
      this.current?.schedule(until);
      for (const f of this.fading) f.schedule(until);
    }, 25);
  }
}
