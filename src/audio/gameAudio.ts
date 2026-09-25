import type { Sim } from '@/sim/sim';
import { AudioEngine } from './engine';
import { Sfx } from './sfx';
import { Music } from './music';

/** Connects simulation events to SFX and music cues. */
export class GameAudio {
  readonly engine = new AudioEngine();
  readonly sfx = new Sfx(this.engine);
  readonly music = new Music(this.engine);
  private offs: (() => void)[] = [];

  bind(sim: Sim): void {
    this.unbind();
    const ev = sim.events;
    const s = this.sfx;
    const dist = (x: number, z: number) => Math.hypot(x, z);
    this.offs.push(
      ev.on('vulcan', () => s.vulcan()),
      ev.on('lockOn', (e) => s.lockTone(e.count)),
      ev.on('missileFire', (e) => s.missileLaunch(e.missile.pos.x, !e.fromPlayer)),
      ev.on('enemyFire', (e) => s.enemyFire(e.enemy.pos.x, dist(e.enemy.pos.x, e.enemy.pos.z))),
      ev.on('hit', (e) => s.hit(e.armored, e.x)),
      ev.on('kill', (e) => s.explosion(e.size, e.x, dist(e.x, e.z))),
      ev.on('explosion', (e) => s.explosion(e.size, e.x, dist(e.x, e.z))),
      ev.on('playerHit', () => s.playerHit()),
      ev.on('playerDeath', () => s.explosion('large', 0, 0)),
      ev.on('bossDefeated', () => s.explosion('huge', 0, 300)),
      ev.on('roll', (e) => s.roll(e.dir)),
      ev.on('extraLife', () => s.extraLife()),
      ev.on('music', (e) => this.music.play(e.track)),
      ev.on('stageClear', () => {
        this.music.stop(1.5);
        s.jingle([69, 72, 76, 81, 79, 81, 84, 88], 0.11);
      }),
      ev.on('gameOver', () => {
        this.music.stop(2);
        s.jingle([76, 74, 72, 71, 69, 64, 57], 0.18, 'triangle');
      }),
    );
  }

  unbind(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  /** Per-frame continuous sounds: engine loop and missile alarm. */
  frame(sim: Sim | null, playing: boolean, dt: number): void {
    const live = playing && !!sim && !sim.player.dead;
    this.sfx.engine(live, sim?.player.speedFactor ?? 1);
    this.sfx.alarm(live && (sim?.threats ?? 0) > 0, dt);
  }
}
