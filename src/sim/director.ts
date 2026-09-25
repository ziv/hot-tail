import { approach } from './math';
import { dismissEnemies, expandWave, spawnEnemy } from './enemies';
import { spawnBoss } from './boss';
import type { SpawnSpec, StageDef, StageEvent } from './defs';
import type { Sim } from './sim';

/**
 * Stage director (F1): plays a stage's data timeline — waves, banners, speed
 * changes, music cues and the boss — and decides when the stage is cleared.
 */
export class Director {
  time = 0;
  private index = 0;
  private pending: { at: number; spec: SpawnSpec }[] = [];
  private readonly events: StageEvent[];
  readonly bossStage: boolean;
  bossDone = false;
  private clearTimer = -1;
  private overtime = 0;
  private dismissed = false;
  private speedTarget = 1;

  constructor(readonly stage: StageDef) {
    this.events = [...stage.events].sort((a, b) => a.t - b.t);
    this.bossStage = this.events.some((e) => e.type === 'boss');
  }

  get duration(): number {
    return this.stage.duration;
  }

  update(sim: Sim, dt: number): void {
    this.time += dt;
    while (this.index < this.events.length && this.events[this.index].t <= this.time) {
      this.apply(sim, this.events[this.index]);
      this.index++;
    }
    if (this.pending.length > 0) {
      let w = 0;
      for (let i = 0; i < this.pending.length; i++) {
        const p = this.pending[i];
        if (p.at <= this.time) spawnEnemy(sim, p.spec);
        else this.pending[w++] = p;
      }
      this.pending.length = w;
    }
    sim.cruiseScale += (this.speedTarget - sim.cruiseScale) * approach(0.8, dt);
    this.checkClear(sim, dt);
  }

  private checkClear(sim: Sim, dt: number): void {
    if (this.bossStage) {
      if (!this.bossDone) return;
    } else {
      const scriptDone =
        this.time >= this.stage.duration && this.index >= this.events.length && this.pending.length === 0;
      if (!scriptDone) return;
      let alive = 0;
      for (const e of sim.enemies.items) if (e.alive) alive++;
      if (alive > 0) {
        this.overtime += dt;
        if (this.overtime > 6 && !this.dismissed) {
          dismissEnemies(sim);
          this.dismissed = true;
        }
        return;
      }
    }
    if (this.clearTimer < 0) this.clearTimer = this.bossStage ? 3.5 : 1.5;
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) sim.clearStage();
  }

  private apply(sim: Sim, ev: StageEvent): void {
    switch (ev.type) {
      case 'wave':
        for (const m of expandWave(sim, ev)) this.pending.push({ at: this.time + m.delay, spec: m.spec });
        break;
      case 'banner':
        sim.events.emit('banner', { text: ev.text, sub: ev.sub ?? '', duration: ev.duration ?? 3 });
        break;
      case 'speed':
        this.speedTarget = ev.value;
        break;
      case 'music':
        sim.events.emit('music', { track: ev.track });
        break;
      case 'boss':
        spawnBoss(sim, ev.id);
        break;
    }
  }

  onBossDefeated(): void {
    this.bossDone = true;
  }

  /** Debug timeline scrubber (F2): restart the stage script at time t. */
  jumpTo(sim: Sim, t: number): void {
    sim.clearWorld();
    this.pending = [];
    this.index = 0;
    this.bossDone = false;
    this.clearTimer = -1;
    this.overtime = 0;
    this.dismissed = false;
    this.speedTarget = 1;
    let music: string | null = null;
    let boss: string | null = null;
    while (this.index < this.events.length && this.events[this.index].t < t) {
      const ev = this.events[this.index];
      if (ev.type === 'speed') this.speedTarget = ev.value;
      else if (ev.type === 'music') music = ev.track;
      else if (ev.type === 'boss') boss = ev.id;
      this.index++;
    }
    this.time = t;
    sim.cruiseScale = this.speedTarget;
    sim.dist = t * sim.cruise;
    sim.prevDist = sim.dist;
    sim.rail.sample(sim.dist, sim.railNow);
    sim.rail.sample(sim.dist, sim.railPrev);
    sim.state = 'playing';
    if (music) sim.events.emit('music', { track: music });
    if (boss) spawnBoss(sim, boss);
  }
}
