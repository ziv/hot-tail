import { GameLoop } from '@/core/loop';
import { hashSeed } from '@/core/rng';
import { Sim } from '@/sim/sim';
import { EXTRA_STAGES, REFUEL_AFTER, STAGES, onStageReload } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { quantizeInput, ReplayPlayer, ReplayRecorder } from '@/sim/replay';
import { JET_ORDER, JETS, type Difficulty, type JetId, type StageDef } from '@/sim/defs';
import { EMPTY_INPUT, type BonusTally, type InputFrame, type StageStats } from '@/sim/types';
import { GameView, type VisualStyle } from '@/render/view';
import { defaultQuality, type QualityLevel } from '@/render/quality';
import { GameAudio } from '@/audio/gameAudio';
import { ACTION_LABELS, DEFAULT_BINDINGS, InputManager, type Action, type NavAction } from '@/input/input';
import { Hud, setHudPalette, type HudPalette } from '@/ui/hud';
import { UI, type MenuItem, type Screen } from '@/ui/ui';
import { controlsHtml, TIPS } from '@/ui/content';
import { Leaderboard } from '@/net/leaderboard';
import { Analytics } from '@/net/analytics';
import { cleanName, NAME_MAX, weekStart, type LbMode, type LbPeriod } from '../../shared/leaderboard';
import { decodeFrames, encodeFrames, loadSave, writeSave, type GameMode, type SaveData } from './save';

export type AppState = 'boot' | 'title' | 'playing' | 'paused' | 'results' | 'refuel' | 'gameover' | 'ending';

export interface AppElements {
  canvas: HTMLCanvasElement;
  hud: HTMLCanvasElement;
  ui: HTMLElement;
  touch: HTMLElement;
}

export interface AppOptions {
  autotest: boolean;
  debug: boolean;
  /** Forced quality from the URL (overrides settings/benchmark). */
  quality: QualityLevel | null;
}

const MODE_LABEL: Record<GameMode, string> = {
  arcade: 'ARCADE',
  scoreAttack: 'SCORE ATTACK',
  practice: 'PRACTICE',
};

/**
 * Scene/state manager (B5) and composition root: owns the loop, the current
 * simulation (attract demo on the title, or a real run) and all presentation
 * systems, and drives the game flow between screens.
 */
export class App {
  state: AppState = 'boot';
  sim!: Sim;
  view!: GameView;
  readonly audio = new GameAudio();
  readonly input: InputManager;
  readonly ui: UI;
  readonly hud: Hud;
  readonly loop: GameLoop;
  readonly save: SaveData;
  readonly leaderboard = new Leaderboard();
  readonly analytics = new Analytics();
  mode: GameMode = 'arcade';
  jet: JetId = 'kestrel';
  stageIndex = 0;
  /** Practice can run stages outside the campaign list. */
  private stageDef: StageDef = STAGES[0];
  attract = true;
  seed = 1;
  fps = 60;
  readonly errors: string[] = [];
  private recorder: ReplayRecorder | null = null;
  private attractReplay: ReplayPlayer | null = null;
  private readonly raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  private readonly q: InputFrame = { x: 0, y: 0, buttons: 0 };
  private timers: { t: number; fn: () => void }[] = [];
  private simOffs: (() => void)[] = [];
  private bench: number[] | null = null;
  private typing = false;

  constructor(
    readonly els: AppElements,
    readonly opts: AppOptions,
  ) {
    this.save = loadSave();
    this.jet = this.save.progress.jet;
    this.input = new InputManager(els.canvas, els.touch);
    this.ui = new UI(els.ui, {
      move: () => this.audio.sfx.uiMove(),
      select: () => this.audio.sfx.uiSelect(),
    });
    this.hud = new Hud(els.hud);
    this.loop = new GameLoop({ tick: () => this.tick(), render: (a, dt) => this.render(a, dt) });
    this.applySettings();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.engine.suspend();
      } else this.audio.engine.resume();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.state !== 'boot' && !this.input.captureNext && !this.typing)
        toggleFullscreen();
    });
    onStageReload((i) => {
      // Hot-reload (A8): restart the edited stage at the current time.
      if (!this.attract && this.stageIndex === i && this.state === 'playing') {
        const t = this.sim.director?.time ?? 0;
        this.stageDef = STAGES[i];
        this.sim.loadStage(this.stageDef);
        this.view.setStage(this.sim, this.stageDef);
        this.sim.director?.jumpTo(this.sim, t);
      }
    });
  }

  get settings(): SaveData['settings'] {
    return this.save.settings;
  }

  private persist(): void {
    writeSave(this.save);
  }

  // ------------------------------------------------------------------ boot
  async boot(): Promise<void> {
    const screen = this.ui.push(
      this.ui.screen({
        logo: true,
        className: 'loading',
        body: `<div class="progress"><div class="progress-bar"></div></div><p class="tip"></p>`,
      }),
    );
    const bar = screen.el.querySelector<HTMLElement>('.progress-bar')!;
    const tip = screen.el.querySelector<HTMLElement>('.tip')!;
    tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

    // Asset manifest (B4): everything is procedural, so "loading" means
    // building meshes/textures, baking sprites and pre-compiling shaders.
    const tasks: [number, () => void][] = [
      [3, () => (this.view = new GameView(this.els.canvas, this.initialQuality()))],
      [1, () => this.newAttract()],
      [2, () => this.settings.style === 'retro' && this.view.setStyle('retro')],
      [3, () => this.view.renderer.compile(this.view.scene, this.view.rig.camera)],
    ];
    const total = tasks.reduce((s, t) => s + t[0], 0);
    let done = 0;
    for (const [weight, run] of tasks) {
      run();
      done += weight;
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      await nextFrame();
    }
    this.applyViewSettings();
    this.resize();
    this.loop.start();
    // Quality auto-benchmark (B15) on first launch.
    if (
      !this.opts.quality &&
      this.settings.quality === 'auto' &&
      !this.save.benchmark &&
      !this.opts.autotest
    ) {
      this.view.applyQuality('high');
      this.bench = [];
    }
    if (this.opts.autotest) this.startGame('arcade', 0);
    else this.showTitle();
  }

  private initialQuality(): QualityLevel {
    if (this.opts.quality) return this.opts.quality;
    if (this.settings.quality !== 'auto') return this.settings.quality;
    return this.save.benchmark?.quality ?? defaultQuality();
  }

  private finishBenchmark(): void {
    const frames = this.bench!.sort((a, b) => a - b);
    this.bench = null;
    const p90 = frames[Math.floor(frames.length * 0.9)] * 1000;
    const quality: QualityLevel = p90 < 14 ? 'high' : p90 < 24 ? 'medium' : 'low';
    this.save.benchmark = { quality, p90: Math.round(p90 * 10) / 10 };
    this.persist();
    this.view.applyQuality(quality);
  }

  private resize(): void {
    this.view?.resize();
    this.hud.resize();
  }

  private applySettings(): void {
    const s = this.settings;
    const v = this.audio.engine.volumes;
    v.master = s.master;
    v.music = s.music;
    v.sfx = s.sfx;
    this.audio.engine.applyVolumes();
    this.audio.voice = s.voice;
    Object.assign(this.input.settings, {
      invertY: s.invertY,
      mouseSensitivity: s.mouseSensitivity,
      lockToggle: s.lockToggle,
      boostToggle: s.boostToggle,
    });
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      this.input.rebind(a, s.bindings[a] ?? [...DEFAULT_BINDINGS[a]]);
    }
    setHudPalette(s.palette);
    this.hud.subtitles = s.subtitles;
    this.hud.scale = s.hudScale;
    this.analytics.enabled = s.analytics;
    this.applyViewSettings();
  }

  private applyViewSettings(): void {
    if (!this.view) return;
    this.view.flashes = this.settings.flashes;
    this.view.rig.shakeScale = this.settings.shake ? 1 : 0;
  }

  // ------------------------------------------------------------- sim setup
  private newSim(seed: number, attract: boolean, options: ConstructorParameters<typeof Sim>[1] = {}): void {
    for (const off of this.simOffs) off();
    this.simOffs = [];
    this.seed = seed;
    this.attract = attract;
    this.sim = new Sim(seed, options);
    if (attract) this.sim.cheats.invincible = true;
    this.view.bind(this.sim);
    this.audio.bind(this.sim);
    this.hud.bind(this.sim);
    const ev = this.sim.events;
    this.simOffs.push(
      ev.on('stageClear', (e) => {
        if (this.attract) return this.after(3, () => this.newAttract());
        this.analytics.track('stage_clear', this.stageDef.index);
        this.captureAttractReplay();
        this.after(2.4, () => this.showResults(e.stats, e.bonus));
      }),
      ev.on('gameOver', () => {
        if (this.attract) return this.after(2, () => this.newAttract());
        this.analytics.track('game_over', this.stageDef.index);
        this.after(2.6, () => this.showGameOver());
      }),
      ev.on('playerDeath', () => {
        if (!this.attract) this.analytics.track('death', this.stageDef.index);
      }),
      ev.on('refuelDone', () => this.after(1, () => this.nextStage())),
    );
  }

  private loadStage(def: StageDef, index: number): void {
    this.stageIndex = index;
    this.stageDef = def;
    // Record the first stage of a fresh run: it can become the attract demo.
    const fresh = this.sim.tick === 0;
    this.sim.loadStage(def);
    this.view.setStage(this.sim, def);
    this.recorder = !this.attract && index === 0 && fresh ? new ReplayRecorder(this.seed, 0) : null;
    if (!this.attract) {
      this.analytics.track('stage_start', def.index);
      if (this.mode !== 'practice' && index > this.save.progress.furthestStage) {
        this.save.progress.furthestStage = index;
        this.persist();
      }
    }
  }

  /** Attract mode (G2): alternates the best recorded stage-1 run with the autopilot. */
  private newAttract(): void {
    const rec = this.save.attract;
    if (rec && !this.attractReplay) {
      this.newSim(rec.seed, true, { jet: rec.jet, difficulty: rec.difficulty });
      const frames = decodeFrames(rec.data);
      this.attractReplay = new ReplayPlayer({ seed: rec.seed, stage: 0, frames, ticks: frames.length / 3 });
    } else {
      this.attractReplay = null;
      this.newSim((Math.random() * 1e9) >>> 0, true, { jet: JET_ORDER[Math.floor(Math.random() * 3)] });
    }
    this.loadStage(STAGES[0], 0);
  }

  private captureAttractReplay(): void {
    if (!this.recorder || this.stageIndex !== 0) return;
    const rep = this.recorder.finish();
    this.recorder = null;
    const score = this.sim.score.score;
    if (this.save.attract && this.save.attract.score >= score) return;
    if (this.sim.options.aimAssist || this.sim.options.autoFire) return; // demo shows unassisted play
    this.save.attract = {
      seed: this.seed,
      jet: this.sim.options.jet,
      difficulty: this.sim.options.difficulty,
      data: encodeFrames(rep.frames),
      score,
    };
    this.persist();
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  // ----------------------------------------------------------- game flow
  startGame(mode: GameMode, stage: number, def?: StageDef): void {
    this.timers = [];
    this.mode = mode;
    // Score Attack flies the weekly seed so everyone gets the same variants.
    const seed = this.opts.autotest
      ? 1
      : mode === 'scoreAttack'
        ? hashSeed(`week-${weekStart(Date.now())}`)
        : (Math.random() * 1e9) >>> 0;
    this.attractReplay = null;
    this.newSim(seed, false, {
      jet: this.jet,
      difficulty: this.settings.difficulty,
      aimAssist: this.settings.aimAssist,
      autoFire: this.settings.autoFire,
    });
    this.loadStage(def ?? STAGES[stage], stage);
    this.ui.clear();
    this.state = 'playing';
    this.loop.paused = false;
    this.input.setGameplayActive(!this.opts.autotest);
    this.hud.visible = true;
    this.hud.touchSafe = this.input.lastSource === 'touch';
    this.audio.engine.setMusicDim(false);
    this.showFirstRunTips();
  }

  private showFirstRunTips(): void {
    if (this.settings.seenTips || this.opts.autotest) return;
    this.settings.seenTips = true;
    this.persist();
    const touch = this.input.lastSource === 'touch';
    this.toast(
      touch
        ? '<b>Left thumb</b> steer · <b>MSL</b> hold to lock, release to fire · <b>ROLL</b> dodges · <b>FLARE</b> decoys'
        : '<b>WASD/Arrows</b> steer · <b>Space</b> guns · <b>K</b> hold to lock, release to fire · <b>L</b> roll · <b>R</b> flares · <b>Shift/Q</b> boost/brake',
      7000,
      true,
    );
  }

  private nextStage(): void {
    const next = this.stageIndex + 1;
    if (next >= STAGES.length) return this.showEnding();
    this.ui.clear();
    this.loadStage(STAGES[next], next);
    this.state = 'playing';
    this.input.setGameplayActive(true);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop.paused = true;
    this.input.setGameplayActive(false);
    this.audio.engine.setMusicDim(true);
    const items: MenuItem[] = [{ label: 'RESUME', action: () => this.resume() }];
    if (this.mode !== 'scoreAttack')
      items.push({
        label: 'RESTART STAGE',
        action: () => this.startGame(this.mode, this.stageIndex, this.stageDef),
      });
    items.push(
      { label: 'HOW TO PLAY', action: () => this.showControls() },
      { label: 'SETTINGS', action: () => this.showSettings() },
      { label: 'QUIT TO TITLE', action: () => this.showTitle() },
    );
    this.ui.replace(
      this.ui.screen({ title: 'PAUSED', className: 'pause', onBack: () => this.resume(), items }),
    );
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ui.clear();
    this.state = 'playing';
    this.loop.paused = false;
    this.input.setGameplayActive(true);
    this.audio.engine.setMusicDim(false);
  }

  showTitle(): void {
    this.timers = [];
    this.state = 'title';
    this.loop.paused = false;
    this.input.setGameplayActive(false);
    this.audio.engine.setMusicDim(false);
    this.hud.visible = false;
    this.hud.clear();
    if (!this.attract) this.newAttract();
    this.audio.music.play('title');
    const best = Math.max(this.save.progress.bests.arcade, this.save.progress.bests.scoreAttack);
    this.ui.replace(
      this.ui.screen({
        logo: true,
        className: 'title',
        subtitle: 'ARCADE JET COMBAT',
        items: [
          { label: 'ARCADE', action: () => this.showJetSelect('arcade', 0) },
          { label: 'SCORE ATTACK', action: () => this.showJetSelect('scoreAttack', 0) },
          { label: 'PRACTICE', action: () => this.showStageSelect() },
          { label: 'LEADERBOARD', action: () => this.showLeaderboard('arcade', 'all') },
          { label: 'HOW TO PLAY', action: () => this.showControls() },
          { label: 'SETTINGS', action: () => this.showSettings() },
        ],
        footer: `BEST ${best.toLocaleString()} · <span class="dim">v${__APP_VERSION__} alpha</span>`,
      }),
    );
  }

  /** Jet selection (C7). */
  private showJetSelect(mode: GameMode, stage: number, def?: StageDef): void {
    const body = document.createElement('div');
    body.className = 'jet-select';
    const render = () => {
      const j = JETS[this.jet];
      const bar = (v: number, max: number) =>
        `<span class="stat-bar"><span style="width:${Math.round((v / max) * 100)}%"></span></span>`;
      body.innerHTML = `
        <div class="jet-name">‹ ${j.name} ›</div>
        <p class="jet-desc">${j.desc}</p>
        <div class="jet-stats">
          <span>SPEED</span>${bar(j.speed, 1.15)}
          <span>HANDLING</span>${bar(j.handling, 1.25)}
          <span>ARMOR</span>${bar(j.armor, 5)}
          <span>LOCKS</span>${bar(j.maxLocks, 8)}
        </div>`;
    };
    const cycle = (d: number) => {
      this.jet = JET_ORDER[(JET_ORDER.indexOf(this.jet) + d + JET_ORDER.length) % JET_ORDER.length];
      this.save.progress.jet = this.jet;
      this.persist();
      this.sim.player.e.model = JETS[this.jet].model; // preview on the attract jet
      render();
      this.audio.sfx.uiMove();
    };
    render();
    const diff = this.settings.difficulty.toUpperCase();
    this.ui.push(
      this.ui.screen({
        title: MODE_LABEL[mode],
        subtitle:
          mode === 'scoreAttack' ? `WEEKLY SEED · NO CONTINUES · ${diff}` : `SELECT YOUR JET · ${diff}`,
        body,
        onBack: () => this.ui.pop(),
        onNav: (a) => {
          if (a === 'left' || a === 'right') {
            cycle(a === 'left' ? -1 : 1);
            return true;
          }
          return false;
        },
        items: [
          { label: 'TAKE OFF', action: () => this.startGame(mode, stage, def) },
          { label: 'CHANGE JET', action: () => cycle(1) },
          { label: 'BACK', action: () => this.ui.pop() },
        ],
      }),
    );
  }

  private showStageSelect(): void {
    const unlocked = this.opts.debug ? STAGES.length - 1 : this.save.progress.furthestStage;
    const items: MenuItem[] = STAGES.map((s, i) => ({
      label: i <= unlocked ? `STAGE ${s.index} — ${s.name}` : `STAGE ${s.index} — LOCKED`,
      action: () => (i <= unlocked ? this.showJetSelect('practice', i) : this.audio.sfx.uiMove()),
    }));
    for (const s of EXTRA_STAGES)
      items.push({
        label: `PREVIEW: STAGE ${s.index} — ${s.name}`,
        action: () => this.showJetSelect('practice', 0, s),
      });
    items.push({ label: 'BACK', action: () => this.ui.pop() });
    this.ui.push(
      this.ui.screen({
        title: 'PRACTICE',
        subtitle: 'Reach a stage in Arcade to unlock it here',
        className: 'scroll',
        onBack: () => this.ui.pop(),
        items,
      }),
    );
  }

  private showControls(): void {
    this.ui.push(
      this.ui.screen({
        title: 'HOW TO PLAY',
        className: 'controls',
        body: controlsHtml(),
        onBack: () => this.ui.pop(),
        items: [{ label: 'BACK', action: () => this.ui.pop() }],
      }),
    );
  }

  // --------------------------------------------------------------- settings
  private showSettings(): void {
    this.ui.push(
      this.ui.screen({
        title: 'SETTINGS',
        onBack: () => this.ui.pop(),
        items: [
          { label: 'GRAPHICS', action: () => this.showGraphicsSettings() },
          { label: 'AUDIO', action: () => this.showAudioSettings() },
          { label: 'CONTROLS', action: () => this.showControlSettings() },
          { label: 'ACCESSIBILITY', action: () => this.showAccessibilitySettings() },
          { label: 'GAMEPLAY', action: () => this.showGameplaySettings() },
          { label: 'FULLSCREEN', action: () => toggleFullscreen() },
          { label: 'BACK', action: () => this.ui.pop() },
        ],
      }),
    );
  }

  private settingsScreen(title: string, items: MenuItem[]): void {
    const screen: Screen = this.ui.push(
      this.ui.screen({
        title,
        className: 'settings',
        onBack: () => this.ui.pop(),
        items: [...items, { label: 'BACK', action: () => this.ui.pop() }],
      }),
    );
    screen.refresh();
  }

  private choice<T extends string>(
    label: string,
    get: () => T,
    options: T[],
    set: (v: T) => void,
    names?: Partial<Record<T, string>>,
  ): MenuItem {
    return {
      label,
      value: () => names?.[get()] ?? get().toUpperCase(),
      adjust: (d) => {
        set(options[(options.indexOf(get()) + d + options.length) % options.length]);
        this.applySettings();
        this.persist();
      },
    };
  }

  private toggle(label: string, key: keyof SaveData['settings']): MenuItem {
    const s = this.settings as unknown as Record<string, unknown>;
    return {
      label,
      value: () => (s[key] ? 'ON' : 'OFF'),
      adjust: () => {
        s[key] = !s[key];
        this.applySettings();
        this.persist();
      },
    };
  }

  private slider(
    label: string,
    key: 'master' | 'music' | 'sfx' | 'mouseSensitivity',
    min = 0,
    max = 1,
    step = 0.1,
  ): MenuItem {
    const s = this.settings;
    return {
      label,
      value: () => (key === 'mouseSensitivity' ? s[key].toFixed(1) : `${Math.round(s[key] * 10)}`),
      adjust: (d) => {
        s[key] = Math.max(min, Math.min(max, Math.round((s[key] + d * step) * 100) / 100));
        this.applySettings();
        this.persist();
      },
    };
  }

  private showGraphicsSettings(): void {
    const s = this.settings;
    this.settingsScreen('GRAPHICS', [
      this.choice<QualityLevel | 'auto'>(
        'QUALITY',
        () => s.quality,
        ['auto', 'low', 'medium', 'high'],
        (v) => {
          s.quality = v;
          if (v === 'auto') {
            this.save.benchmark = null;
            this.view.applyQuality('high');
            this.bench = [];
          } else this.view.applyQuality(v);
        },
      ),
      this.choice<VisualStyle>(
        'STYLE',
        () => s.style,
        ['modern', 'retro'],
        (v) => {
          s.style = v;
          this.view.setStyle(v);
        },
        { modern: 'MODERN 3D', retro: 'RETRO SPRITES' },
      ),
    ]);
  }

  private showAudioSettings(): void {
    this.settingsScreen('AUDIO', [
      this.slider('MASTER VOLUME', 'master'),
      this.slider('MUSIC', 'music'),
      this.slider('SOUND EFFECTS', 'sfx'),
      this.toggle('VOICE CALLOUTS', 'voice'),
    ]);
  }

  private showControlSettings(): void {
    this.settingsScreen('CONTROLS', [
      this.toggle('INVERT Y', 'invertY'),
      this.slider('MOUSE SENSITIVITY', 'mouseSensitivity', 0.3, 2.5, 0.1),
      this.toggle('LOCK: TOGGLE MODE', 'lockToggle'),
      this.toggle('AFTERBURNER: TOGGLE', 'boostToggle'),
      this.toggle('AIM ASSIST', 'aimAssist'),
      this.toggle('AUTO-FIRE', 'autoFire'),
      { label: 'REBIND KEYS', action: () => this.showRebind() },
    ]);
  }

  /** Keyboard rebinding (B6/G7). */
  private showRebind(): void {
    const actions = Object.keys(ACTION_LABELS) as Action[];
    const fmt = (codes: string[]) => codes.map((c) => c.replace(/^Key|^Digit/, '')).join(' / ');
    const screen: Screen = this.ui.push(
      this.ui.screen({
        title: 'REBIND KEYS',
        subtitle: 'Select an action, then press a key (Esc cancels)',
        className: 'settings scroll',
        onBack: () => this.ui.pop(),
        items: [
          ...actions.map<MenuItem>((a) => ({
            label: ACTION_LABELS[a].toUpperCase(),
            value: () => fmt(this.input.bindings[a]),
            action: () => {
              const prev = this.input.bindings[a];
              this.input.bindings[a] = ['…'];
              screen.refresh();
              this.input.captureNext = (code) => {
                if (code === 'Escape') this.input.bindings[a] = prev;
                else {
                  // New primary key; keep the previous primary as the alternate.
                  const alt = prev.find((c) => c !== code);
                  this.settings.bindings[a] = alt ? [code, alt] : [code];
                  this.applySettings();
                  this.persist();
                }
                screen.refresh();
              };
            },
          })),
          {
            label: 'RESET TO DEFAULTS',
            action: () => {
              this.settings.bindings = {};
              this.applySettings();
              this.persist();
              screen.refresh();
            },
          },
          { label: 'BACK', action: () => this.ui.pop() },
        ],
      }),
    );
    screen.refresh();
  }

  private showAccessibilitySettings(): void {
    const s = this.settings;
    this.settingsScreen('ACCESSIBILITY', [
      this.choice<HudPalette>(
        'HUD COLOURS',
        () => s.palette,
        ['default', 'deutan', 'tritan'],
        (v) => (s.palette = v),
        {
          default: 'STANDARD',
          deutan: 'RED-GREEN SAFE',
          tritan: 'BLUE-YELLOW SAFE',
        },
      ),
      this.choice<string>(
        'HUD SCALE',
        () => String(s.hudScale),
        ['0.85', '1', '1.2', '1.4'],
        (v) => (s.hudScale = Number(v)),
        { '0.85': 'SMALL', '1': 'NORMAL', '1.2': 'LARGE', '1.4': 'X-LARGE' },
      ),
      this.toggle('SUBTITLES', 'subtitles'),
      this.toggle('SCREEN SHAKE', 'shake'),
      this.toggle('SCREEN FLASHES', 'flashes'),
      this.toggle('LOCK: TOGGLE MODE', 'lockToggle'),
      this.toggle('AIM ASSIST', 'aimAssist'),
    ]);
  }

  private showGameplaySettings(): void {
    const s = this.settings;
    this.settingsScreen('GAMEPLAY', [
      this.choice<Difficulty>(
        'DIFFICULTY',
        () => s.difficulty,
        ['easy', 'normal', 'hard'],
        (v) => (s.difficulty = v),
      ),
      this.toggle('ANONYMOUS STATS', 'analytics'),
      {
        label: 'CALLSIGN',
        value: () => this.save.profile.name,
        action: () => this.showNameEntry('CALLSIGN', null, () => this.ui.pop()),
      },
    ]);
  }

  // ---------------------------------------------------------- end of stage
  private showResults(stats: StageStats, bonus: BonusTally): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.state = 'results';
    this.input.setGameplayActive(false);
    const def = this.stageDef;
    const last = this.stageIndex >= STAGES.length - 1 || this.mode === 'practice';
    const refuel = !last && REFUEL_AFTER.has(this.stageIndex);
    const next = () => {
      if (this.mode === 'practice') return this.showTitle();
      if (this.stageIndex >= STAGES.length - 1) return this.showEnding();
      if (refuel) {
        // Tanker rendezvous (F15) between stages 5 and 6.
        this.ui.clear();
        this.state = 'refuel';
        this.sim.startRefuel();
        return;
      }
      this.nextStage();
    };
    const rows: [string, string, number][] = [
      ['HIT RATE', `${Math.round(bonus.hitRate * 100)}%`, bonus.hitRateBonus],
      ['ENEMIES DOWNED', `${stats.kills} / ${stats.spawned}`, bonus.killBonus],
      [
        bonus.noDamage ? 'NO DAMAGE!' : 'DAMAGE TAKEN',
        bonus.noDamage ? '' : `${stats.damageTaken}`,
        bonus.damageBonus,
      ],
    ];
    const body = document.createElement('div');
    body.className = 'tally';
    for (const [label, detail, pts] of [
      ...rows,
      ['STAGE BONUS', '', bonus.total] as [string, string, number],
    ]) {
      const row = document.createElement('div');
      row.className = `tally-row${label === 'STAGE BONUS' ? ' total' : ''}`;
      row.innerHTML = `<span>${label}</span><span class="detail">${detail}</span><span class="pts">+0</span>`;
      row.dataset.pts = String(pts);
      body.append(row);
    }
    const scoreRow = document.createElement('div');
    scoreRow.className = 'tally-score';
    scoreRow.textContent = `SCORE ${this.sim.score.score.toLocaleString()}`;
    body.append(scoreRow);
    const label =
      this.mode === 'practice'
        ? 'BACK TO TITLE'
        : last
          ? 'CONTINUE'
          : refuel
            ? 'RENDEZVOUS WITH TANKER'
            : 'NEXT STAGE';
    this.ui.replace(
      this.ui.screen({
        title: 'STAGE CLEAR',
        subtitle: `STAGE ${def.index} — ${def.name}`,
        className: 'results',
        body,
        items: [{ label, action: next }],
      }),
    );
    body.querySelectorAll<HTMLElement>('.tally-row').forEach((row, i) => {
      const target = Number(row.dataset.pts);
      const el = row.querySelector<HTMLElement>('.pts')!;
      const start = performance.now() + i * 350;
      const step = (now: number) => {
        const t = Math.max(0, Math.min(1, (now - start) / 500));
        el.textContent = `+${Math.round(target * t).toLocaleString()}`;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  private recordBest(): boolean {
    const score = this.sim.score.score;
    const bests = this.save.progress.bests;
    if (score > bests[this.mode]) {
      bests[this.mode] = score;
      this.persist();
      return true;
    }
    return false;
  }

  /** High-score name entry (G8) → leaderboard submission, then `then()`. */
  private async submitRun(then: () => void): Promise<void> {
    if (this.mode === 'practice' || this.opts.autotest) return then();
    const mode = this.mode as LbMode;
    const score = this.sim.score.score;
    if (score <= 0) return then();
    if (!this.leaderboard.configured && !(await this.leaderboard.qualifies(mode, score))) return then();
    this.showNameEntry('NEW HIGH SCORE', score, async () => {
      this.ui.pop();
      const res = await this.leaderboard.submit({
        playerId: this.save.profile.playerId,
        name: this.save.profile.name,
        score,
        mode,
        stage: this.stageDef.index,
        jet: this.sim.options.jet,
        difficulty: this.sim.options.difficulty,
        seed: this.seed,
        version: __APP_VERSION__,
      });
      this.toast(
        res.rank
          ? `Ranked #${res.rank}${res.online ? '' : ' (local)'} · this week #${res.weeklyRank}`
          : 'Score saved',
      );
      then();
    });
  }

  private showNameEntry(title: string, score: number | null, done: () => void): void {
    let name = this.save.profile.name.slice(0, NAME_MAX).split('');
    let cursor = Math.min(name.length, NAME_MAX - 1);
    const letters = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-';
    const body = document.createElement('div');
    body.className = 'name-entry';
    const render = () => {
      const slots = Array.from(
        { length: NAME_MAX },
        (_, i) =>
          `<span class="${i === cursor ? 'cur' : ''}">${escapeHtml(name[i]?.trim() ? name[i] : '·')}</span>`,
      ).join('');
      body.innerHTML = `<div class="slots">${slots}</div><p class="dim">Type, or use ↑↓ to pick letters and ←→ to move</p>`;
    };
    const stop = () => {
      this.typing = false;
      window.removeEventListener('keydown', onKey, true);
    };
    const commit = () => {
      this.save.profile.name = cleanName(name.join(''));
      this.persist();
      stop();
      done();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /[a-z0-9.-]/i.test(e.key)) {
        name[cursor] = e.key.toUpperCase();
        cursor = Math.min(NAME_MAX - 1, cursor + 1);
      } else if (e.key === 'Backspace') {
        if (!name[cursor]?.trim() && cursor > 0) cursor--;
        name[cursor] = ' ';
      } else return;
      e.preventDefault();
      e.stopPropagation();
      render();
    };
    this.typing = true;
    window.addEventListener('keydown', onKey, true);
    render();
    this.ui.push(
      this.ui.screen({
        title,
        subtitle: score !== null ? `SCORE ${score.toLocaleString()}` : 'YOUR NAME ON THE LEADERBOARD',
        body,
        onClose: stop,
        onNav: (a: NavAction) => {
          const idx = letters.indexOf(name[cursor] ?? ' ');
          if (a === 'up' || a === 'down') {
            name = Array.from({ length: Math.max(name.length, cursor + 1) }, (_, i) => name[i] ?? ' ');
            name[cursor] = letters[(idx + (a === 'up' ? 1 : -1) + letters.length) % letters.length];
          } else if (a === 'left') cursor = Math.max(0, cursor - 1);
          else if (a === 'right') cursor = Math.min(NAME_MAX - 1, cursor + 1);
          else return false;
          render();
          return true;
        },
        items: [{ label: 'CONFIRM', action: commit }],
      }),
    );
  }

  private showGameOver(): void {
    this.state = 'gameover';
    this.input.setGameplayActive(false);
    const best = this.recordBest();
    const board = this.mode === 'scoreAttack' ? 'scoreAttack' : 'arcade';
    const offer = () =>
      this.ui.replace(
        this.ui.screen({
          title: 'GAME OVER',
          subtitle: `SCORE ${this.sim.score.score.toLocaleString()}${best ? ' — NEW BEST!' : ''}`,
          className: 'gameover',
          items: [
            ...(this.mode === 'arcade'
              ? [
                  {
                    label: 'CONTINUE (SCORE RESETS)',
                    action: () => this.startGame('arcade', this.stageIndex),
                  },
                ]
              : this.mode === 'practice'
                ? [
                    {
                      label: 'RETRY',
                      action: () => this.startGame('practice', this.stageIndex, this.stageDef),
                    },
                  ]
                : []),
            { label: 'LEADERBOARD', action: () => this.showLeaderboard(board, 'all') },
            { label: 'QUIT TO TITLE', action: () => this.showTitle() },
          ],
        }),
      );
    this.ui.clear();
    void this.submitRun(offer);
  }

  private showEnding(): void {
    this.state = 'ending';
    const best = this.recordBest();
    this.audio.music.play('title');
    const board = this.mode === 'scoreAttack' ? 'scoreAttack' : 'arcade';
    const show = () =>
      this.ui.replace(
        this.ui.screen({
          title: 'MISSION COMPLETE',
          subtitle: `FINAL SCORE ${this.sim.score.score.toLocaleString()}${best ? ' — NEW BEST!' : ''}`,
          className: 'ending',
          body: '<p>The Leviathan is down. Stages 7–18 — mountains, night city and the stratosphere — arrive in the beta.<br/>Thanks for flying the <b>Hot Tail</b> alpha.</p>',
          items: [
            { label: 'LEADERBOARD', action: () => this.showLeaderboard(board, 'all') },
            { label: 'BACK TO TITLE', action: () => this.showTitle() },
          ],
        }),
      );
    this.ui.clear();
    void this.submitRun(show);
  }

  /** Leaderboard (G10): all-time/weekly × mode, plus ranks around the player. */
  private showLeaderboard(mode: LbMode, period: LbPeriod): void {
    const body = document.createElement('div');
    body.className = 'board';
    body.innerHTML = '<p class="dim">Loading…</p>';
    const reopen = (m: LbMode, p: LbPeriod) => {
      this.ui.pop();
      this.showLeaderboard(m, p);
    };
    const other: LbMode = mode === 'arcade' ? 'scoreAttack' : 'arcade';
    this.ui.push(
      this.ui.screen({
        title: 'LEADERBOARD',
        subtitle: `${MODE_LABEL[mode]} · ${period === 'weekly' ? 'THIS WEEK' : 'ALL TIME'}`,
        className: 'board-screen scroll',
        body,
        onBack: () => this.ui.pop(),
        onNav: (a) => {
          if (a === 'left' || a === 'right') {
            reopen(other, period);
            return true;
          }
          return false;
        },
        items: [
          {
            label: period === 'weekly' ? 'SHOW ALL TIME' : 'SHOW THIS WEEK',
            action: () => reopen(mode, period === 'weekly' ? 'all' : 'weekly'),
          },
          { label: `SHOW ${MODE_LABEL[other]}`, action: () => reopen(other, period) },
          { label: 'BACK', action: () => this.ui.pop() },
        ],
      }),
    );
    void this.leaderboard.board(mode, period, this.save.profile.playerId).then((b) => {
      const row = (e: { rank: number; name: string; score: number; stage: number; me?: boolean }) =>
        `<tr class="${e.me ? 'me' : ''}"><td>${e.rank}</td><td>${escapeHtml(e.name)}</td><td>${e.score.toLocaleString()}</td><td>ST ${e.stage}</td></tr>`;
      const status = b.online
        ? 'ONLINE'
        : this.leaderboard.configured
          ? 'OFFLINE — showing local scores'
          : 'LOCAL SCORES';
      const around =
        b.around.length && b.around.some((e) => e.rank > 20)
          ? `<h3>AROUND YOU</h3><table>${b.around.map(row).join('')}</table>`
          : '';
      body.innerHTML =
        `<p class="board-status">${status}</p>` +
        (b.entries.length
          ? `<table>${b.entries.map(row).join('')}</table>`
          : '<p class="dim">No scores yet — be the first.</p>') +
        around;
    });
  }

  private toast(html: string, ms = 3500, rich = false): void {
    const el = document.createElement('div');
    el.className = 'toast';
    if (rich) el.innerHTML = html;
    else el.textContent = html;
    document.body.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    }, ms);
  }

  // ------------------------------------------------------------- the loop
  private tick(): void {
    const sim = this.sim;
    let input: InputFrame;
    if (this.attract)
      input =
        this.attractReplay && !this.attractReplay.done
          ? this.attractReplay.next(this.raw)
          : botInput(sim, this.raw);
    else if (this.opts.autotest) input = botInput(sim, this.raw);
    else if (this.state === 'playing') input = this.input.sample(sim, this.raw);
    else input = EMPTY_INPUT;
    quantizeInput(input, this.q);
    this.recorder?.record(this.q);
    sim.step(this.q);
  }

  private render(alpha: number, frameDt: number): void {
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    if (this.bench && frameDt > 0 && frameDt < 0.1 && !document.hidden) {
      this.bench.push(frameDt);
      if (this.bench.length >= 180) this.finishBenchmark();
    }
    this.input.pollGamepad(frameDt);

    if (this.state === 'playing' && this.input.consumePause()) {
      this.pause();
      while (this.input.consumeNav()) {
        /* drain */
      }
    } else if (this.state === 'paused' && this.input.consumePause()) {
      this.resume();
      while (this.input.consumeNav()) {
        /* drain */
      }
    } else {
      this.input.consumePause();
      let nav;
      while ((nav = this.input.consumeNav())) if (this.ui.open && !this.input.captureNext) this.ui.nav(nav);
    }

    if (!this.loop.paused && this.timers.length) {
      for (const t of this.timers) t.t -= frameDt;
      const due = this.timers.filter((t) => t.t <= 0);
      this.timers = this.timers.filter((t) => t.t > 0);
      for (const t of due) t.fn();
    }

    if (!this.view) return;
    this.view.render(this.sim, alpha, frameDt);
    if (this.hud.visible)
      this.hud.draw(this.sim, this.view.rig.camera, alpha, frameDt, this.view.interpolatedPlayer);
    const live = this.state === 'playing' || this.state === 'results' || this.state === 'refuel';
    this.audio.frame(this.sim, live, frameDt);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Yields so the progress bar can paint (falls back to a timeout in background tabs). */
function nextFrame(): Promise<void> {
  return new Promise((r) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

function toggleFullscreen(): void {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || doc.webkitFullscreenElement) void document.exitFullscreen?.();
  else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
  else el.webkitRequestFullscreen?.();
}
