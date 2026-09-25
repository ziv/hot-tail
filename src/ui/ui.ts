import type { NavAction } from '@/input/input';

/**
 * UI framework (G1): HTML overlay screens on a stack with keyboard/gamepad
 * focus navigation. Buttons are real <button>s so menus stay accessible.
 */
export interface MenuItem {
  label: string;
  action?: () => void;
  /** For settings rows: current value text and left/right adjusters. */
  value?: () => string;
  adjust?: (dir: -1 | 1) => void;
  hint?: string;
}

export interface ScreenOptions {
  title?: string;
  subtitle?: string;
  body?: string | HTMLElement;
  items?: MenuItem[];
  onBack?: () => void;
  className?: string;
  /** Logo instead of a plain title. */
  logo?: boolean;
  footer?: string;
}

export class Screen {
  readonly el: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  focus = 0;

  constructor(
    readonly opts: ScreenOptions,
    private readonly sounds: { move(): void; select(): void },
  ) {
    const el = document.createElement('section');
    el.className = `screen ${opts.className ?? ''}`;
    el.setAttribute('role', 'dialog');
    if (opts.logo) {
      el.insertAdjacentHTML(
        'beforeend',
        `<h1 class="logo" aria-label="Hot Tail"><span class="logo-hot">HOT</span><span class="logo-tail">TAIL</span></h1>`,
      );
    } else if (opts.title) {
      const h = document.createElement('h2');
      h.className = 'screen-title';
      h.textContent = opts.title;
      el.append(h);
    }
    if (opts.subtitle) {
      const p = document.createElement('p');
      p.className = 'screen-sub';
      p.textContent = opts.subtitle;
      el.append(p);
    }
    if (opts.body) {
      const body = document.createElement('div');
      body.className = 'screen-body';
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else body.append(opts.body);
      el.append(body);
    }
    if (opts.items?.length) {
      const menu = document.createElement('div');
      menu.className = 'menu';
      opts.items.forEach((item, i) => {
        const b = document.createElement('button');
        b.className = 'menu-item';
        b.type = 'button';
        this.renderItem(b, item);
        b.addEventListener('click', () => this.activate(i));
        b.addEventListener('mouseenter', () => this.setFocus(i, false));
        this.buttons.push(b);
        menu.append(b);
      });
      el.append(menu);
    }
    if (opts.footer) {
      const f = document.createElement('p');
      f.className = 'screen-footer';
      f.innerHTML = opts.footer;
      el.append(f);
    }
    this.el = el;
  }

  private renderItem(b: HTMLButtonElement, item: MenuItem): void {
    if (item.value) {
      b.innerHTML = `<span>${item.label}</span><span class="menu-value">‹ ${item.value()} ›</span>`;
    } else b.textContent = item.label;
  }

  refresh(): void {
    this.opts.items?.forEach((item, i) => this.renderItem(this.buttons[i], item));
  }

  setFocus(i: number, sound = true): void {
    if (this.buttons.length === 0) return;
    const n = this.buttons.length;
    const next = ((i % n) + n) % n;
    if (next !== this.focus && sound) this.sounds.move();
    this.focus = next;
    this.buttons.forEach((b, k) => b.classList.toggle('focused', k === next));
    this.buttons[next].focus({ preventScroll: true });
  }

  private activate(i: number): void {
    const item = this.opts.items?.[i];
    if (!item) return;
    this.setFocus(i, false);
    if (item.adjust && !item.action) {
      item.adjust(1);
      this.refresh();
      this.sounds.move();
      return;
    }
    this.sounds.select();
    item.action?.();
  }

  nav(a: NavAction): void {
    const items = this.opts.items ?? [];
    switch (a) {
      case 'up':
        this.setFocus(this.focus - 1);
        break;
      case 'down':
        this.setFocus(this.focus + 1);
        break;
      case 'left':
      case 'right': {
        const item = items[this.focus];
        if (item?.adjust) {
          item.adjust(a === 'left' ? -1 : 1);
          this.refresh();
          this.sounds.move();
        }
        break;
      }
      case 'confirm':
        this.activate(this.focus);
        break;
      case 'back':
        if (this.opts.onBack) {
          this.sounds.select();
          this.opts.onBack();
        }
        break;
    }
  }
}

export class UI {
  private readonly stack: Screen[] = [];

  constructor(
    private readonly root: HTMLElement,
    readonly sounds: { move(): void; select(): void },
  ) {}

  get top(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get open(): boolean {
    return this.stack.length > 0;
  }

  screen(opts: ScreenOptions): Screen {
    return new Screen(opts, this.sounds);
  }

  push(s: Screen): Screen {
    this.top?.el.classList.add('hidden');
    this.stack.push(s);
    this.root.append(s.el);
    requestAnimationFrame(() => s.el.classList.add('in'));
    s.setFocus(0, false);
    return s;
  }

  pop(): void {
    const s = this.stack.pop();
    s?.el.remove();
    const top = this.top;
    if (top) {
      top.el.classList.remove('hidden');
      top.setFocus(top.focus, false);
    }
  }

  replace(s: Screen): Screen {
    this.clear();
    return this.push(s);
  }

  clear(): void {
    while (this.stack.length) this.stack.pop()!.el.remove();
  }

  nav(a: NavAction): void {
    this.top?.nav(a);
  }
}
