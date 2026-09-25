import { Vector3, type PerspectiveCamera } from 'three';
import type { Sim } from '@/sim/sim';
import type { Entity } from '@/sim/types';
import { bossHealth } from '@/sim/boss';
import { tuning } from '@/sim/tuning';

/**
 * In-canvas HUD (G3) plus threat indicators (D6, E9) and score pop-ups (D8).
 * Style rules: cyan/white for player info, the reserved warm colour only for
 * threats, and every warning also carries text or a shape (never colour alone).
 */
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const CYAN = '#7fe9ff';
const WHITE = '#ffffff';
const WARM = '#ffb020';
const RED = '#ff4a3a';
const DIM = 'rgba(127, 233, 255, 0.35)';

interface Popup {
  x: number;
  y: number;
  z: number;
  text: string;
  age: number;
  big: boolean;
}

interface Banner {
  text: string;
  sub: string;
  age: number;
  duration: number;
}

const _v = new Vector3();
const _w = new Vector3();

export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private popups: Popup[] = [];
  private banner: Banner | null = null;
  private message: { text: string; age: number } | null = null;
  private offs: (() => void)[] = [];
  private time = 0;
  private displayScore = 0;
  visible = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  bind(sim: Sim): void {
    this.unbind();
    this.popups = [];
    this.banner = null;
    this.displayScore = sim.score.score;
    this.offs.push(
      sim.events.on('kill', (e) => {
        if (e.target.kind === 'emissile') return;
        this.popups.push({
          x: e.x,
          y: e.y,
          z: e.z,
          text: e.multiplier > 1 ? `${e.score.toLocaleString()} ×${e.multiplier}` : e.score.toLocaleString(),
          age: 0,
          big: e.size === 'large' || e.size === 'huge',
        });
        if (this.popups.length > 24) this.popups.shift();
      }),
      sim.events.on(
        'banner',
        (e) => (this.banner = { text: e.text, sub: e.sub, age: 0, duration: e.duration }),
      ),
      sim.events.on('extraLife', () => (this.message = { text: 'EXTRA LIFE', age: 0 })),
      sim.events.on(
        'bossPhase',
        (e) => (this.message = { text: e.phase === 3 ? 'CORE EXPOSED' : 'ARMOR BREACHED', age: 0 }),
      ),
      sim.events.on('playerRespawn', () => (this.message = { text: 'READY', age: 0 })),
    );
  }

  unbind(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private project(p: Vector3, cam: PerspectiveCamera): { x: number; y: number; behind: boolean } {
    _v.copy(p).project(cam);
    _w.copy(p).applyMatrix4(cam.matrixWorldInverse);
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, behind: _w.z > 0 };
  }

  draw(sim: Sim, cam: PerspectiveCamera, alpha: number, dt: number, playerPos: Vector3): void {
    this.time += dt;
    this.clear();
    if (!this.visible) return;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.lineJoin = 'round';
    const p = sim.player;

    this.drawTargets(sim, cam, alpha);
    if (!p.dead) this.drawReticle(sim, cam, playerPos);
    this.drawThreats(sim, cam, alpha);
    this.drawPopups(sim, cam, dt);
    this.drawStatus(sim, dt);
    this.drawBoss(sim);
    this.drawBanner(dt);
  }

  private drawReticle(sim: Sim, cam: PerspectiveCamera, playerPos: Vector3): void {
    const c = this.ctx;
    const p = sim.player;
    _w.copy(playerPos).addScaledVector(p.aim, 900);
    const r = this.project(_w, cam);
    const locking = (sim.input.buttons & 2) !== 0;
    const size = Math.max(14, Math.min(this.w, this.h) * 0.028);
    c.strokeStyle = CYAN;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(r.x, r.y, size, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      c.moveTo(r.x + dx * size * 0.45, r.y + dy * size * 0.45);
      c.lineTo(r.x + dx * size * 1.5, r.y + dy * size * 1.5);
    }
    c.stroke();
    if (locking && p.missiles > 0) {
      // Lock sweep box
      const s = size * 2.6;
      c.save();
      c.translate(r.x, r.y);
      c.rotate(this.time * 2);
      c.strokeStyle = WHITE;
      c.setLineDash([s * 0.4, s * 0.6]);
      c.strokeRect(-s, -s, s * 2, s * 2);
      c.restore();
      c.setLineDash([]);
    }
  }

  private drawTargets(sim: Sim, cam: PerspectiveCamera, alpha: number): void {
    const c = this.ctx;
    const locked = new Set<Entity>();
    for (const l of sim.player.locks) if (l.e.alive && l.e.id === l.id) locked.add(l.e);
    for (const l of sim.player.volley) if (l.id >= 0 && l.e.alive && l.e.id === l.id) locked.add(l.e);
    for (const e of sim.targets.items) {
      if (!e.alive || !e.lockable || e.pos.z > -60) continue;
      _v.lerpVectors(e.prev, e.pos, alpha);
      const s = this.project(_v, cam);
      if (s.behind || s.x < -20 || s.x > this.w + 20 || s.y < -20 || s.y > this.h + 20) continue;
      const dist = -e.pos.z;
      const size = Math.max(9, Math.min(40, 5000 / dist));
      if (locked.has(e)) {
        // Locked: rotating filled diamond with a label — same language for every target.
        c.save();
        c.translate(s.x, s.y);
        c.rotate(Math.PI / 4 + Math.sin(this.time * 8) * 0.1);
        c.strokeStyle = WHITE;
        c.lineWidth = 2.5;
        c.strokeRect(-size, -size, size * 2, size * 2);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(-size, -size, size * 2, size * 2);
        c.restore();
        c.fillStyle = WHITE;
        c.font = `700 11px ${FONT}`;
        c.textAlign = 'center';
        c.fillText('LOCK', s.x, s.y - size * 1.45 - 3);
      } else if (dist < tuning.lock.rangeMax) {
        // Lockable: thin corner brackets.
        c.strokeStyle = DIM;
        c.lineWidth = 1.5;
        const k = size * 0.45;
        c.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          c.moveTo(s.x + sx * size, s.y + sy * (size - k));
          c.lineTo(s.x + sx * size, s.y + sy * size);
          c.lineTo(s.x + sx * (size - k), s.y + sy * size);
        }
        c.stroke();
      }
    }
  }

  private drawThreats(sim: Sim, cam: PerspectiveCamera, alpha: number): void {
    const c = this.ctx;
    const flash = Math.floor(this.time * 6) % 2 === 0;
    // Incoming missiles (D6)
    if (sim.threats > 0 && !sim.player.dead) {
      c.textAlign = 'center';
      const y = this.h * 0.2;
      c.fillStyle = flash ? RED : WARM;
      c.strokeStyle = c.fillStyle;
      c.lineWidth = 2;
      c.font = `italic 800 ${Math.round(Math.min(34, this.w * 0.06))}px ${FONT}`;
      const tw = c.measureText('MISSILE WARNING').width;
      c.strokeRect(this.w / 2 - tw / 2 - 14, y - 30, tw + 28, 42);
      c.fillText('MISSILE WARNING', this.w / 2, y);
      for (const m of sim.missiles.items) {
        if (!m.alive || m.kind !== 'emissile' || !m.missile!.tracking) continue;
        _v.lerpVectors(m.prev, m.pos, alpha);
        this.edgeArrow(_v, cam, WARM, m.pos.z > 0 ? 'BEHIND' : '');
      }
    }
    // Enemies behind (E9) and off-screen ahead
    for (const e of sim.enemies.items) {
      if (!e.alive) continue;
      _v.lerpVectors(e.prev, e.pos, alpha);
      if (e.pos.z > 20) {
        this.edgeArrow(_v, cam, WARM, 'BANDIT');
      } else if (e.pos.z < -300 && e.pos.z > -1800) {
        const s = this.project(_v, cam);
        if (s.x < 0 || s.x > this.w || s.y < 0 || s.y > this.h) this.edgeArrow(_v, cam, DIM, '');
      }
    }
  }

  /** Arrow at the screen edge pointing toward an off-screen or rear position. */
  private edgeArrow(pos: Vector3, cam: PerspectiveCamera, color: string, label: string): void {
    const c = this.ctx;
    const s = this.project(pos, cam);
    let dx = s.x - this.w / 2;
    let dy = s.y - this.h / 2;
    if (s.behind) {
      dx = -dx;
      dy = Math.abs(dy) + this.h; // behind: push to the bottom edge
    }
    const inside = !s.behind && s.x > 0 && s.x < this.w && s.y > 0 && s.y < this.h;
    if (inside) return;
    const margin = 36;
    const hw = this.w / 2 - margin;
    const hh = this.h / 2 - margin;
    const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
    const x = this.w / 2 + dx * k;
    const y = this.h / 2 + dy * k;
    const a = Math.atan2(dy, dx);
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(14, 0);
    c.lineTo(-8, -10);
    c.lineTo(-3, 0);
    c.lineTo(-8, 10);
    c.closePath();
    c.fill();
    c.restore();
    if (label) {
      c.fillStyle = color;
      c.font = `800 11px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(label, x, y - 16);
    }
  }

  private drawPopups(sim: Sim, cam: PerspectiveCamera, dt: number): void {
    const c = this.ctx;
    c.textAlign = 'center';
    for (const p of this.popups) {
      p.age += dt;
      p.z += (sim.speed - sim.cruiseSpeed * 0.2) * dt * 0.5;
      p.y += 30 * dt;
    }
    this.popups = this.popups.filter((p) => p.age < 1.1);
    for (const p of this.popups) {
      _v.set(p.x, p.y, p.z);
      const s = this.project(_v, cam);
      if (s.behind) continue;
      c.globalAlpha = Math.max(0, 1 - p.age / 1.1);
      c.font = `italic 800 ${p.big ? 22 : 15}px ${FONT}`;
      c.fillStyle = WHITE;
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 3;
      c.strokeText(p.text, s.x, s.y);
      c.fillText(p.text, s.x, s.y);
    }
    c.globalAlpha = 1;
  }

  private drawStatus(sim: Sim, dt: number): void {
    const c = this.ctx;
    const p = sim.player;
    const pad = Math.max(14, Math.min(this.w, this.h) * 0.025);
    const small = this.w < 700;
    const safeTop = pad + 4;
    this.displayScore += (sim.score.score - this.displayScore) * Math.min(1, dt * 12);
    if (Math.abs(sim.score.score - this.displayScore) < 1) this.displayScore = sim.score.score;

    // Score + combo
    c.textAlign = 'left';
    c.fillStyle = WHITE;
    c.font = `italic 800 ${small ? 22 : 30}px ${FONT}`;
    c.fillText(Math.round(this.displayScore).toString().padStart(8, '0'), pad, safeTop + (small ? 20 : 26));
    if (sim.score.chain > 0 && sim.score.comboTimer > 0) {
      const m = sim.score.multiplier;
      c.font = `italic 800 ${small ? 15 : 18}px ${FONT}`;
      c.fillStyle = CYAN;
      c.fillText(`×${m} CHAIN`, pad, safeTop + (small ? 42 : 52));
      c.fillStyle = DIM;
      c.fillRect(pad, safeTop + (small ? 48 : 58), 90, 3);
      c.fillStyle = CYAN;
      c.fillRect(pad, safeTop + (small ? 48 : 58), 90 * (sim.score.comboTimer / tuning.score.comboWindow), 3);
    }

    // Stage + progress
    const d = sim.director;
    if (d) {
      c.textAlign = 'right';
      c.font = `700 ${small ? 11 : 13}px ${FONT}`;
      c.fillStyle = CYAN;
      c.fillText(`STAGE ${d.stage.index} · ${d.stage.name}`, this.w - pad, safeTop + 12);
      if (!d.bossStage) {
        const w = small ? 90 : 140;
        c.fillStyle = DIM;
        c.fillRect(this.w - pad - w, safeTop + 20, w, 3);
        c.fillStyle = CYAN;
        c.fillRect(this.w - pad - w, safeTop + 20, w * Math.min(1, d.time / d.duration), 3);
      }
    }

    const bottom = this.h - pad - (this.touchSafe ? 120 : 0);
    // Lives + armour (bottom-left)
    c.textAlign = 'left';
    for (let i = 0; i < Math.min(sim.score.lives, 8); i++) {
      const x = pad + i * 18;
      c.fillStyle = WHITE;
      c.beginPath();
      c.moveTo(x + 7, bottom - 44);
      c.lineTo(x + 14, bottom - 30);
      c.lineTo(x, bottom - 30);
      c.closePath();
      c.fill();
    }
    c.font = `700 11px ${FONT}`;
    c.fillStyle = CYAN;
    c.fillText('ARMOR', pad, bottom - 14);
    for (let i = 0; i < tuning.player.armor; i++) {
      const on = i < p.armor;
      c.fillStyle = on ? (p.armor <= 1 ? WARM : CYAN) : 'rgba(255,255,255,0.15)';
      c.fillRect(pad + 48 + i * 16, bottom - 22, 12, 9);
    }
    // Throttle bar
    const tw = small ? 90 : 120;
    const f = (p.speedFactor - tuning.throttle.brake) / (tuning.throttle.boost - tuning.throttle.brake);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(pad, bottom - 4, tw, 5);
    c.fillStyle = p.throttle === 'boost' ? WHITE : CYAN;
    c.fillRect(pad, bottom - 4, tw * f, 5);
    c.font = `800 11px ${FONT}`;
    c.fillText(
      p.throttle === 'boost'
        ? 'AFTERBURNER'
        : p.throttle === 'brake'
          ? 'AIR BRAKE'
          : `${Math.round(sim.speed * 3.6)} KM/H`,
      pad + tw + 8,
      bottom + 1,
    );

    // Missiles + lock slots (bottom-right)
    c.textAlign = 'right';
    c.fillStyle = p.missiles < 10 ? WARM : WHITE;
    c.font = `italic 800 ${small ? 20 : 26}px ${FONT}`;
    c.fillText(`${sim.cheats.infiniteMissiles ? '∞' : p.missiles}`, this.w - pad, bottom);
    c.font = `700 11px ${FONT}`;
    c.fillStyle = CYAN;
    c.fillText('MSL', this.w - pad, bottom - (small ? 22 : 28));
    for (let i = 0; i < tuning.lock.maxLocks; i++) {
      const x = this.w - pad - (small ? 50 : 64) - i * 14;
      const y = bottom - 8;
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.strokeStyle = CYAN;
      c.lineWidth = 1.5;
      if (i < p.locks.length + p.volley.length) {
        c.fillStyle = WHITE;
        c.fillRect(-4, -4, 8, 8);
      }
      c.strokeRect(-4, -4, 8, 8);
      c.restore();
    }
    if (p.rollCooldown > 0) {
      c.fillStyle = DIM;
      c.fillRect(this.w - pad - 60, bottom + 6, 60 * (1 - p.rollCooldown / tuning.roll.cooldown), 3);
    }

    // Transient message
    if (this.message) {
      this.message.age += dt;
      if (this.message.age > 2) this.message = null;
      else if (Math.floor(this.message.age * 5) % 2 === 0 || this.message.age > 0.8) {
        c.textAlign = 'center';
        c.fillStyle = WHITE;
        c.font = `italic 800 22px ${FONT}`;
        c.fillText(this.message.text, this.w / 2, this.h * 0.68);
      }
    }
  }

  /** Extra bottom margin when touch controls are shown. */
  touchSafe = false;

  private drawBoss(sim: Sim): void {
    const boss = sim.bosses.items.find((b) => b.alive);
    if (!boss) return;
    const c = this.ctx;
    const frac = bossHealth(boss);
    const w = Math.min(this.w * 0.6, 520);
    const x = (this.w - w) / 2;
    const y = Math.max(54, this.h * 0.08);
    c.textAlign = 'center';
    c.font = `800 12px ${FONT}`;
    c.fillStyle = WARM;
    c.fillText(`${boss.boss!.name}  —  PHASE ${Math.min(3, boss.boss!.phase)}`, this.w / 2, y - 8);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x, y, w, 8);
    c.fillStyle = WARM;
    c.fillRect(x, y, w * frac, 8);
    c.strokeStyle = WARM;
    c.lineWidth = 1;
    c.strokeRect(x - 0.5, y - 0.5, w + 1, 9);
  }

  private drawBanner(dt: number): void {
    const b = this.banner;
    if (!b) return;
    b.age += dt;
    if (b.age > b.duration) {
      this.banner = null;
      return;
    }
    const c = this.ctx;
    const inT = Math.min(1, b.age / 0.3);
    const outT = Math.min(1, Math.max(0, (b.duration - b.age) / 0.4));
    const a = Math.min(inT, outT);
    const warn = b.text === 'WARNING' || b.text === 'CAUTION';
    c.globalAlpha = a;
    const y = this.h * 0.36;
    c.fillStyle = 'rgba(0, 10, 20, 0.45)';
    c.fillRect(0, y - 52, this.w, 84);
    c.textAlign = 'center';
    const size = Math.round(Math.min(64, this.w * 0.1));
    c.font = `italic 900 ${size}px ${FONT}`;
    c.fillStyle = warn ? (Math.floor(b.age * 5) % 2 ? WARM : RED) : WHITE;
    c.fillText(b.text, this.w / 2 + (1 - inT) * 80, y);
    if (b.sub) {
      c.font = `700 ${Math.round(Math.min(18, this.w * 0.035))}px ${FONT}`;
      c.fillStyle = warn ? WARM : CYAN;
      c.fillText(b.sub, this.w / 2 - (1 - inT) * 80, y + 24);
    }
    c.globalAlpha = 1;
  }
}
