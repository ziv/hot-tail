import { GameLoop } from '@/core/loop';
import { Sim } from '@/sim/sim';
import { STAGES, onStageReload } from '@/sim/stages';
import { botInput } from '@/sim/bot';
import { quantizeInput, ReplayRecorder, type Replay } from '@/sim/replay';
import { EMPTY_INPUT, type BonusTally, type InputFrame, type StageStats } from '@/sim/types';
import { GameView } from '@/render/view';
import { GameAudio } from '@/audio/gameAudio';
import { InputManager } from '@/input/input';
import { Hud } from '@/ui/hud';
import { UI, type MenuItem, type Screen } from '@/ui/ui';
import { controlsHtml, TIPS } from '@/ui/content';
import type { QualityLevel } from '@/render/quality';
import { loadHighScore, loadSettings, saveHighScore, saveSettings, type Settings } from './settings';

export type AppState = 'boot' | 'title' | 'playing' | 'paused' | 'results' | 'gameover' | 'ending';
export type GameMode = 'arcade' | 'practice';

export interface AppElements {
  canvas: HTMLCanvasElement;
  hud: HTMLCanvasElement;
  ui: HTMLElement;
  touch: HTMLElement;
}

export interface AppOptions {
  autotest: boolean;
  debug: boolean;
  quality: QualityLevel;
}

/**
 * Scene/state manager (B5) and composition root: owns the loop, the current
 * simulation (attract-mode demo on the title, or a real run) and all
 * presentation systems, and drives the game flow between screens.
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
  readonly settings: Settings;
  mode: GameMode = 'arcade';
  stageIndex = 0;
  attract = true;
  seed = 1;
  hiScore = loadHighScore();
  lastReplay: Replay | null = null;
  fps = 60;
  readonly errors: string[] = [];
  private recorder: ReplayRecorder | null = null;
  private readonly raw: InputFrame = { x: 0, y: 0, buttons: 0 };
  private readonly q: InputFrame = { x: 0, y: 0, buttons: 0 };
  private timers: { t: number; fn: () => void }[] = [];
  private simOffs: (() => void)[] = [];

  constructor(
    readonly els: AppElements,
    readonly opts: AppOptions,
  ) {
    this.settings = loadSettings(opts.quality);
    this.input = new InputManager(els.canvas, els.touch);
    this.ui = new UI(els.ui, {
      move: () => this.audio.sfx.uiMove(),
      select: () => this.audio.sfx.uiSelect(),
    });
    this.hud = new Hud(els.hud);
    this.loop = new GameLoop({ tick: (dt) => this.tick(dt), render: (a, dt) => this.render(a, dt) });
    this.applyAudioSettings();
    this.input.settings.invertY = this.settings.invertY;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.engine.suspend();
      } else this.audio.engine.resume();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.state !== 'boot') toggleFullscreen();
    });
    onStageReload((i) => {
      // Hot-reload (A8): restart the edited stage at the current time.
      if (!this.attract && this.stageIndex === i && this.state === 'playing') {
        const t = this.sim.director?.time ?? 0;
        this.sim.loadStage(STAGES[i]);
        this.view.setStage(this.sim, STAGES[i]);
        this.sim.director?.jumpTo(this.sim, t);
      }
    });
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
    // building meshes/textures and pre-compiling shaders with progress.
    const tasks: [string, number, () => void][] = [
      ['renderer', 3, () => (this.view = new GameView(this.els.canvas, this.settings.quality))],
      ['world', 1, () => this.newSim(1, true)],
      ['shaders', 3, () => this.view.renderer.compile(this.view.scene, this.view.rig.camera)],
    ];
    const total = tasks.reduce((s, t) => s + t[1], 0);
    let done = 0;
    for (const [, weight, run] of tasks) {
      run();
      done += weight;
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      await nextFrame();
    }
    this.view.flashes = this.settings.flashes;
    this.view.rig.shakeScale = this.settings.shake ? 1 : 0;
    this.resize();
    this.loop.start();
    if (this.opts.autotest) this.startGame('arcade', 0);
    else this.showTitle();
  }

  private resize(): void {
    this.view?.resize();
    this.hud.resize();
  }

  // ------------------------------------------------------------- sim setup
  private newSim(seed: number, attract: boolean): void {
    for (const off of this.simOffs) off();
    this.simOffs = [];
    this.seed = seed;
    this.attract = attract;
    this.sim = new Sim(seed);
    if (attract) this.sim.cheats.invincible = true;
    this.view.bind(this.sim);
    this.audio.bind(this.sim);
    this.hud.bind(this.sim);
    const ev = this.sim.events;
    this.simOffs.push(
      ev.on('stageClear', (e) => {
        if (this.attract) this.after(3, () => this.restartAttract());
        else this.after(2.4, () => this.showResults(e.stats, e.bonus));
      }),
      ev.on('gameOver', () => {
        if (this.attract) this.after(2, () => this.restartAttract());
        else this.after(2.6, () => this.showGameOver());
      }),
    );
    if (attract) this.loadStage(0);
  }

  private loadStage(i: number): void {
    this.stageIndex = i;
    const def = STAGES[i];
    this.sim.loadStage(def);
    this.view.setStage(this.sim, def);
    if (!this.attract) {
      this.lastReplay = this.recorder?.finish() ?? this.lastReplay;
      this.recorder = new ReplayRecorder(this.seed, i);
    }
  }

  private restartAttract(): void {
    if (!this.attract) return;
    this.newSim((Math.random() * 1e9) >>> 0, true);
    this.audio.music.play('title');
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  // ----------------------------------------------------------- game flow
  startGame(mode: GameMode, stage: number): void {
    this.timers = [];
    this.mode = mode;
    const seed = this.opts.autotest ? 1 : (Math.random() * 1e9) >>> 0;
    this.newSim(seed, false);
    this.loadStage(stage);
    this.ui.clear();
    this.state = 'playing';
    this.loop.paused = false;
    this.input.setGameplayActive(!this.opts.autotest);
    this.hud.visible = true;
    this.hud.touchSafe = this.input.lastSource === 'touch';
    this.showFirstRunTips();
  }

  private showFirstRunTips(): void {
    if (this.settings.seenTips || this.opts.autotest) return;
    this.settings.seenTips = true;
    saveSettings(this.settings);
    const touch = this.input.lastSource === 'touch';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = touch
      ? '<b>Left thumb</b> steer · <b>MSL</b> hold to lock, release to fire · <b>ROLL</b> dodges missiles'
      : '<b>WASD/Arrows</b> steer · <b>Space</b> guns · <b>K</b> hold to lock, release to fire · <b>L</b> roll · <b>Shift/Q</b> boost/brake';
    document.body.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    }, 7000);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop.paused = true;
    this.input.setGameplayActive(false);
    this.audio.engine.setMusicDim(true);
    this.ui.replace(
      this.ui.screen({
        title: 'PAUSED',
        className: 'pause',
        onBack: () => this.resume(),
        items: [
          { label: 'RESUME', action: () => this.resume() },
          { label: 'RESTART STAGE', action: () => this.startGame(this.mode, this.stageIndex) },
          { label: 'HOW TO PLAY', action: () => this.showControls() },
          { label: 'SETTINGS', action: () => this.showSettings() },
          { label: 'QUIT TO TITLE', action: () => this.showTitle() },
        ],
      }),
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

  private showTitle(): void {
    this.timers = [];
    this.state = 'title';
    this.loop.paused = false;
    this.input.setGameplayActive(false);
    this.audio.engine.setMusicDim(false);
    this.hud.visible = false;
    this.hud.clear();
    if (!this.attract) this.newSim((Math.random() * 1e9) >>> 0, true);
    this.audio.music.play('title');
    this.ui.replace(
      this.ui.screen({
        logo: true,
        className: 'title',
        subtitle: 'ARCADE JET COMBAT',
        items: [
          { label: 'START', action: () => this.startGame('arcade', 0) },
          { label: 'PRACTICE', action: () => this.showStageSelect() },
          { label: 'HOW TO PLAY', action: () => this.showControls() },
          { label: 'SETTINGS', action: () => this.showSettings() },
        ],
        footer: `HI-SCORE ${this.hiScore.toLocaleString()} · <span class="dim">v${__APP_VERSION__} vertical slice</span>`,
      }),
    );
  }

  private showStageSelect(): void {
    this.ui.push(
      this.ui.screen({
        title: 'PRACTICE',
        subtitle: 'Pick a stage',
        onBack: () => this.ui.pop(),
        items: [
          ...STAGES.map<MenuItem>((s, i) => ({
            label: `STAGE ${s.index} — ${s.name}`,
            action: () => this.startGame('practice', i),
          })),
          { label: 'BACK', action: () => this.ui.pop() },
        ],
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

  private showSettings(): void {
    const s = this.settings;
    const levels: QualityLevel[] = ['low', 'medium', 'high'];
    const vol = (key: 'master' | 'music' | 'sfx', label: string): MenuItem => ({
      label,
      value: () => `${Math.round(s[key] * 10)}`,
      adjust: (d) => {
        s[key] = Math.max(0, Math.min(1, Math.round((s[key] + d * 0.1) * 10) / 10));
        this.applyAudioSettings();
        saveSettings(s);
      },
    });
    const toggle = (key: 'invertY' | 'shake' | 'flashes', label: string): MenuItem => ({
      label,
      value: () => (s[key] ? 'ON' : 'OFF'),
      adjust: () => {
        s[key] = !s[key];
        this.input.settings.invertY = s.invertY;
        this.view.rig.shakeScale = s.shake ? 1 : 0;
        this.view.flashes = s.flashes;
        saveSettings(s);
      },
    });
    const screen: Screen = this.ui.push(
      this.ui.screen({
        title: 'SETTINGS',
        onBack: () => this.ui.pop(),
        items: [
          {
            label: 'GRAPHICS',
            value: () => s.quality.toUpperCase(),
            adjust: (d) => {
              s.quality = levels[(levels.indexOf(s.quality) + d + 3) % 3];
              this.view.applyQuality(s.quality);
              saveSettings(s);
            },
          },
          vol('master', 'MASTER VOLUME'),
          vol('music', 'MUSIC'),
          vol('sfx', 'SOUND EFFECTS'),
          toggle('invertY', 'INVERT Y'),
          toggle('shake', 'SCREEN SHAKE'),
          toggle('flashes', 'SCREEN FLASHES'),
          { label: 'FULLSCREEN', action: () => toggleFullscreen() },
          { label: 'BACK', action: () => this.ui.pop() },
        ],
      }),
    );
    screen.refresh();
  }

  private applyAudioSettings(): void {
    const v = this.audio.engine.volumes;
    v.master = this.settings.master;
    v.music = this.settings.music;
    v.sfx = this.settings.sfx;
    this.audio.engine.applyVolumes();
  }

  private showResults(stats: StageStats, bonus: BonusTally): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.state = 'results';
    this.input.setGameplayActive(false);
    const last = this.stageIndex >= STAGES.length - 1;
    const next = () => {
      if (this.mode === 'practice') this.showTitle();
      else if (last) this.showEnding();
      else {
        this.ui.clear();
        this.loadStage(this.stageIndex + 1);
        this.state = 'playing';
        this.input.setGameplayActive(true);
      }
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
    this.ui.replace(
      this.ui.screen({
        title: 'STAGE CLEAR',
        subtitle: `STAGE ${STAGES[this.stageIndex].index} — ${STAGES[this.stageIndex].name}`,
        className: 'results',
        body,
        items: [
          {
            label: this.mode === 'practice' ? 'BACK TO TITLE' : last ? 'CONTINUE' : 'NEXT STAGE',
            action: next,
          },
        ],
      }),
    );
    // Count-up animation for the bonus tally.
    body.querySelectorAll<HTMLElement>('.tally-row').forEach((row, i) => {
      const target = Number(row.dataset.pts);
      const el = row.querySelector<HTMLElement>('.pts')!;
      const start = performance.now() + i * 350;
      const step = (now: number) => {
        const t = Math.max(0, Math.min(1, (now - start) / 500));
        el.textContent = `+${Math.round(target * t).toLocaleString()}`;
        if (t < 1) requestAnimationFrame(step);
        else if (t === 1 && now - start < 520) this.audio.sfx.uiMove();
      };
      requestAnimationFrame(step);
    });
  }

  private recordHighScore(): boolean {
    const score = this.sim.score.score;
    if (score > this.hiScore) {
      this.hiScore = score;
      saveHighScore(score);
      return true;
    }
    return false;
  }

  private showGameOver(): void {
    this.state = 'gameover';
    this.input.setGameplayActive(false);
    const best = this.recordHighScore();
    this.ui.replace(
      this.ui.screen({
        title: 'GAME OVER',
        subtitle: `SCORE ${this.sim.score.score.toLocaleString()}${best ? ' — NEW HI-SCORE!' : ''}`,
        className: 'gameover',
        items: [
          { label: 'CONTINUE (SCORE RESETS)', action: () => this.startGame(this.mode, this.stageIndex) },
          { label: 'QUIT TO TITLE', action: () => this.showTitle() },
        ],
      }),
    );
  }

  private showEnding(): void {
    this.state = 'ending';
    const best = this.recordHighScore();
    this.audio.music.play('title');
    this.ui.replace(
      this.ui.screen({
        title: 'MISSION COMPLETE',
        subtitle: `FINAL SCORE ${this.sim.score.score.toLocaleString()}${best ? ' — NEW HI-SCORE!' : ''}`,
        className: 'ending',
        body: '<p>The Leviathan is down and the sea lanes are open.<br/>Thanks for flying the <b>Hot Tail</b> vertical slice.</p>',
        items: [{ label: 'BACK TO TITLE', action: () => this.showTitle() }],
      }),
    );
  }

  // ------------------------------------------------------------- the loop
  private tick(_dt: number): void {
    const sim = this.sim;
    let input: InputFrame;
    if (this.attract || this.opts.autotest) input = botInput(sim, this.raw);
    else if (this.state === 'playing') input = this.input.sample(sim, this.raw);
    else input = EMPTY_INPUT;
    quantizeInput(input, this.q);
    this.recorder?.record(this.q);
    sim.step(this.q);
  }

  private render(alpha: number, frameDt: number): void {
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
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
      while ((nav = this.input.consumeNav())) if (this.ui.open) this.ui.nav(nav);
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
    this.audio.frame(this.sim, this.state === 'playing' || this.state === 'results', frameDt);
  }
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
