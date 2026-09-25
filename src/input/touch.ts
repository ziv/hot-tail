import { Btn } from '@/sim/types';

/**
 * Touch layout (G13): a floating virtual stick on the left half and action
 * buttons on the right, positioned inside the device safe areas.
 */
export interface TouchState {
  active: boolean;
  x: number;
  y: number;
  buttons: number;
}

interface ButtonDef {
  id: string;
  label: string;
  bit: number;
}

const BUTTONS: ButtonDef[] = [
  { id: 'fire', label: 'GUN', bit: Btn.Fire },
  { id: 'lock', label: 'MSL', bit: Btn.Lock },
  { id: 'roll', label: 'ROLL', bit: Btn.Roll },
  { id: 'boost', label: 'BOOST', bit: Btn.Boost },
  { id: 'brake', label: 'BRAKE', bit: Btn.Brake },
];

export class TouchControls {
  readonly state: TouchState = { active: false, x: 0, y: 0, buttons: 0 };
  autoFire = true;
  onPause: () => void = () => undefined;
  private stickId = -1;
  private originX = 0;
  private originY = 0;
  private readonly radius = 64;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly held = new Map<number, number>();

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '';
    const zone = el('div', 'touch-stick-zone');
    this.base = el('div', 'touch-stick');
    this.knob = el('div', 'touch-knob');
    this.base.append(this.knob);
    zone.append(this.base);
    root.append(zone);

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.state.x = this.state.y = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const pad = el('div', 'touch-buttons');
    for (const b of BUTTONS) {
      const btn = el('button', `touch-btn touch-${b.id}`);
      btn.textContent = b.id === 'fire' ? 'GUN' : b.label;
      btn.setAttribute('aria-label', b.label);
      if (b.id === 'fire') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.autoFire = !this.autoFire;
          btn.classList.toggle('toggled', this.autoFire);
          btn.textContent = this.autoFire ? 'AUTO' : 'GUN';
        });
        btn.classList.toggle('toggled', this.autoFire);
        btn.textContent = 'AUTO';
      } else {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          btn.setPointerCapture(e.pointerId);
          this.held.set(e.pointerId, b.bit);
          btn.classList.add('down');
          this.recompute();
        });
        const up = (e: PointerEvent) => {
          if (!this.held.has(e.pointerId)) return;
          this.held.delete(e.pointerId);
          btn.classList.remove('down');
          this.recompute();
        };
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
      }
      pad.append(btn);
    }
    root.append(pad);

    const pause = el('button', 'touch-pause');
    pause.textContent = 'II';
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPause();
    });
    root.append(pause);
  }

  private move(cx: number, cy: number): void {
    let dx = cx - this.originX;
    let dy = cy - this.originY;
    const m = Math.hypot(dx, dy);
    if (m > this.radius) {
      dx = (dx / m) * this.radius;
      dy = (dy / m) * this.radius;
    }
    this.state.x = dx / this.radius;
    this.state.y = -dy / this.radius;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private recompute(): void {
    let b = 0;
    for (const bit of this.held.values()) b |= bit;
    this.state.buttons = b;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('visible', v);
    this.state.active = v;
    if (!v) {
      this.state.buttons = 0;
      this.state.x = this.state.y = 0;
      this.held.clear();
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
