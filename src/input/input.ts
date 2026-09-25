import { Btn, type InputFrame } from '@/sim/types';
import { tuning } from '@/sim/tuning';
import type { Sim } from '@/sim/sim';
import { TouchControls } from './touch';

/**
 * Unified input (B6): an action map over keyboard, mouse (pointer lock),
 * gamepad and touch, producing one InputFrame per tick plus menu navigation.
 */
export type Action =
  'up' | 'down' | 'left' | 'right' | 'fire' | 'lock' | 'roll' | 'boost' | 'brake' | 'flare' | 'pause';

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Climb',
  down: 'Dive',
  left: 'Left',
  right: 'Right',
  fire: 'Vulcan',
  lock: 'Lock / missiles',
  roll: 'Barrel roll',
  boost: 'Boost',
  brake: 'Air-brake',
  flare: 'Flares',
  pause: 'Pause',
};
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Space', 'KeyJ'],
  lock: ['KeyK', 'KeyX'],
  roll: ['KeyL', 'KeyC'],
  boost: ['ShiftLeft', 'ShiftRight', 'KeyE'],
  brake: ['KeyQ', 'KeyZ'],
  flare: ['KeyR', 'KeyV'],
  pause: ['Escape', 'KeyP'],
};

const NAV_KEYS: Record<string, NavAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

// Standard gamepad mapping indices.
const GP = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Start: 9,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
};

export interface InputSettings {
  invertY: boolean;
  autoFire: boolean;
  mouseSensitivity: number;
  /** Accessibility: press once to start/stop instead of holding (K7). */
  lockToggle: boolean;
  boostToggle: boolean;
}

export type InputSource = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

export class InputManager {
  readonly bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  readonly settings: InputSettings = {
    invertY: false,
    autoFire: false,
    mouseSensitivity: 1,
    lockToggle: false,
    boostToggle: false,
  };
  private rawPrev = 0;
  private toggled = 0;
  /** When set, the next key press is captured for rebinding instead of played. */
  captureNext: ((code: string) => void) | null = null;
  private readonly keys = new Set<string>();
  private readonly nav: NavAction[] = [];
  private pausePressed = false;
  private mouseButtons = 0;
  /** Time of the last touch: browsers replay taps as mouse events right after. */
  private lastTouchAt = -Infinity;
  private cursorX = 0;
  private cursorY = 0;
  private mouseActive = false;
  private padPrev: boolean[] = [];
  private padNavCooldown = 0;
  lastSource: InputSource = 'keyboard';
  readonly touch: TouchControls;
  /** When true, mouse steering and pointer lock are allowed (in-game). */
  gameplayActive = false;

  constructor(canvas: HTMLCanvasElement, touchRoot: HTMLElement) {
    this.touch = new TouchControls(touchRoot);
    this.touch.onPause = () => (this.pausePressed = true);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      // A tap's emulated mousedown must not switch to mouse or take pointer lock
      // (locked, every touch would land on the canvas instead of the buttons).
      if (!this.gameplayActive || performance.now() - this.lastTouchAt < 1000) return;
      this.mouseButtons |= 1 << e.button;
      this.lastSource = 'mouse';
      this.mouseActive = true;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => undefined);
    });
    window.addEventListener('mouseup', (e) => (this.mouseButtons &= ~(1 << e.button)));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.gameplayActive) return;
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        const k = (0.0032 * this.settings.mouseSensitivity * 900) / Math.max(400, window.innerHeight);
        this.cursorX = clamp(this.cursorX + e.movementX * k, -1, 1);
        this.cursorY = clamp(this.cursorY - e.movementY * k, -1, 1);
        this.mouseActive = true;
      }
    });
    window.addEventListener(
      'touchstart',
      () => {
        this.lastTouchAt = performance.now();
        this.lastSource = 'touch';
        if (document.pointerLockElement) document.exitPointerLock();
        this.touch.setVisible(this.gameplayActive);
      },
      { passive: true },
    );
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (this.captureNext) {
      e.preventDefault();
      const fn = this.captureNext;
      this.captureNext = null;
      fn(e.code);
      return;
    }
    this.keys.add(e.code);
    this.lastSource = 'keyboard';
    const nav = NAV_KEYS[e.code];
    if (nav) this.nav.push(nav);
    if (this.bindings.pause.includes(e.code)) this.pausePressed = true;
    // Menus are driven by the nav queue; stop Enter/Space also "clicking" the
    // focused button natively (which would activate it twice).
    if (e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow')) e.preventDefault();
    if (this.isSteeringKey(e.code)) this.mouseActive = false;
  };

  private isSteeringKey(code: string): boolean {
    return (['up', 'down', 'left', 'right'] as const).some((a) => this.bindings[a].includes(code));
  }

  private held(action: Action): boolean {
    for (const code of this.bindings[action]) if (this.keys.has(code)) return true;
    return false;
  }

  rebind(action: Action, codes: string[]): void {
    this.bindings[action] = codes;
  }

  setGameplayActive(active: boolean): void {
    this.gameplayActive = active;
    this.toggled = 0;
    this.touch.setVisible(active && this.lastSource === 'touch');
    if (!active && document.pointerLockElement) document.exitPointerLock();
    if (!active) this.mouseActive = false;
  }

  /** True once per press of the pause action from any device. */
  consumePause(): boolean {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }

  consumeNav(): NavAction | null {
    return this.nav.shift() ?? null;
  }

  /** Polls the gamepad; call once per render frame. */
  pollGamepad(dt: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;
    const b = pad.buttons.map((x) => x.pressed);
    const pressed = (i: number) => b[i] && !this.padPrev[i];
    if (b.some(Boolean) || Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > 0.4) this.lastSource = 'gamepad';
    if (pressed(GP.Start)) this.pausePressed = true;
    if (pressed(GP.A)) this.nav.push('confirm');
    if (pressed(GP.B)) this.nav.push('back');
    this.padNavCooldown -= dt;
    const ay = pad.axes[1] ?? 0;
    const ax = pad.axes[0] ?? 0;
    const dir: NavAction | null = pressed(GP.Up)
      ? 'up'
      : pressed(GP.Down)
        ? 'down'
        : pressed(GP.Left)
          ? 'left'
          : pressed(GP.Right)
            ? 'right'
            : null;
    if (dir) this.nav.push(dir);
    else if (this.padNavCooldown <= 0 && Math.max(Math.abs(ax), Math.abs(ay)) > 0.6) {
      this.nav.push(Math.abs(ay) > Math.abs(ax) ? (ay < 0 ? 'up' : 'down') : ax < 0 ? 'left' : 'right');
      this.padNavCooldown = 0.25;
    }
    this.padPrev = b;
  }

  /** Builds the input frame for the next simulation tick. */
  sample(sim: Sim, out: InputFrame): InputFrame {
    let x = 0;
    let y = 0;
    let buttons = 0;

    // Keyboard
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y += 1;
    if (this.held('down')) y -= 1;
    if (this.held('fire')) buttons |= Btn.Fire;
    if (this.held('lock')) buttons |= Btn.Lock;
    if (this.held('roll')) buttons |= Btn.Roll;
    if (this.held('boost')) buttons |= Btn.Boost;
    if (this.held('brake')) buttons |= Btn.Brake;
    if (this.held('flare')) buttons |= Btn.Flare;

    // Mouse: the jet chases a virtual cursor inside the flight envelope.
    if (this.mouseActive && x === 0 && y === 0) {
      const pe = sim.player.e.pos;
      x = clamp((this.cursorX * tuning.flight.envelopeX - pe.x) / 35, -1, 1);
      y = clamp((this.cursorY * tuning.flight.envelopeY - pe.y) / 25, -1, 1);
    }
    if (this.mouseButtons & 1) buttons |= Btn.Fire;
    if (this.mouseButtons & 4) buttons |= Btn.Lock;
    if (this.mouseButtons & 2) buttons |= Btn.Lock;

    // Gamepad
    const pad = (navigator.getGamepads?.() ?? []).find((p) => p && p.connected);
    if (pad) {
      const [sx, sy] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.16);
      x += sx;
      y -= sy;
      const bp = (i: number) => pad.buttons[i]?.pressed ?? false;
      const bv = (i: number) => pad.buttons[i]?.value ?? 0;
      if (bp(GP.A)) buttons |= Btn.Fire;
      if (bp(GP.X) || bp(GP.RB)) buttons |= Btn.Lock;
      if (bp(GP.B) || bp(GP.LB)) buttons |= Btn.Roll;
      if (bv(GP.RT) > 0.35) buttons |= Btn.Boost;
      if (bv(GP.LT) > 0.35) buttons |= Btn.Brake;
      if (bp(GP.Y)) buttons |= Btn.Flare;
    }

    // Touch
    const t = this.touch.state;
    if (t.active) {
      x += t.x;
      y += t.y;
      buttons |= t.buttons;
    }

    // Hold-vs-toggle (K7): rising edges flip a latched state.
    const toggleMask =
      (this.settings.lockToggle ? Btn.Lock : 0) | (this.settings.boostToggle ? Btn.Boost : 0);
    if (toggleMask) {
      const rising = buttons & ~this.rawPrev & toggleMask;
      this.toggled ^= rising;
      this.rawPrev = buttons;
      buttons = (buttons & ~toggleMask) | (this.toggled & toggleMask);
    } else this.rawPrev = buttons;

    if (this.settings.invertY) y = -y;
    if (this.settings.autoFire || (t.active && this.touch.autoFire)) buttons |= Btn.Fire;
    out.x = clamp(x, -1, 1);
    out.y = clamp(y, -1, 1);
    out.buttons = buttons;
    return out;
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function deadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}
