// Controller navigation for every screen built from DOM (title, pause menu,
// inventory, map, journal, death screen, dialogue): the d-pad or left stick
// moves focus between visible controls in reading order, left/right nudges
// sliders and selects, A presses, B backs out (as Escape would). Holding a
// direction repeats after a short delay.

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Held {
  since: number;
  last: number;
}

export class PadNavigator {
  private readonly held = new Map<string, Held>();
  private time = 0;
  /** Called for B (back / close). */
  onBack: (() => void) | null = null;

  constructor() {
    // Focus rings only while a controller is driving (see [data-input="pad"]).
    window.addEventListener('pointermove', () => {
      if (document.documentElement.dataset.input === 'pad') document.documentElement.dataset.input = 'pointer';
    });
  }

  /** Call every frame while a screen (not gameplay) has the controls. */
  update(dt: number, active: boolean): void {
    this.time += dt;
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) {
      pad = p;
      break;
    }
    if (!pad || !active) {
      this.held.clear();
      return;
    }
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const btn = (i: number) => Boolean(pad && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
    const dirs: Record<string, boolean> = {
      up: btn(12) || axisY < -0.6,
      down: btn(13) || axisY > 0.6,
      left: btn(14) || axisX < -0.6,
      right: btn(15) || axisX > 0.6,
      a: btn(0),
      b: btn(1),
    };
    for (const [name, down] of Object.entries(dirs)) {
      if (!down) {
        this.held.delete(name);
        continue;
      }
      const h = this.held.get(name);
      const repeatable = name !== 'a' && name !== 'b';
      if (!h) {
        this.held.set(name, { since: this.time, last: this.time });
        this.fire(name);
      } else if (repeatable && this.time - h.since > 0.4 && this.time - h.last > 0.11) {
        h.last = this.time;
        this.fire(name);
      }
    }
  }

  private visibleControls(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const style = getComputedStyle(el);
      if (style.pointerEvents === 'none' || style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      out.push(el);
    }
    return out;
  }

  private fire(name: string): void {
    document.documentElement.dataset.input = 'pad';
    const active = document.activeElement as HTMLElement | null;
    if (name === 'a') {
      if (active && active !== document.body) active.click();
      else this.move(1);
      return;
    }
    if (name === 'b') {
      this.onBack?.();
      return;
    }
    // Sliders and selects take left/right as value changes.
    if ((name === 'left' || name === 'right') && active instanceof HTMLInputElement && active.type === 'range') {
      if (name === 'left') active.stepDown();
      else active.stepUp();
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if ((name === 'left' || name === 'right') && active instanceof HTMLSelectElement) {
      const n = active.options.length;
      active.selectedIndex = (active.selectedIndex + (name === 'left' ? n - 1 : 1)) % n;
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    this.moveSpatial(name as 'up' | 'down' | 'left' | 'right');
  }

  /** Move focus to the nearest control in a direction (grids feel natural). */
  private moveSpatial(dir: 'up' | 'down' | 'left' | 'right'): void {
    const controls = this.visibleControls();
    if (controls.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    if (!current || !controls.includes(current)) {
      controls[0].focus({ preventScroll: false });
      return;
    }
    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of controls) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - fx;
      const dy = y - fy;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      if (along <= 4) continue;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) best.focus({ preventScroll: false });
    else this.move(dir === 'up' || dir === 'left' ? -1 : 1);
  }

  /** Reading-order fallback when nothing lies in that direction. */
  private move(step: number): void {
    const controls = this.visibleControls();
    if (controls.length === 0) return;
    const i = controls.indexOf(document.activeElement as HTMLElement);
    const next = controls[(i + step + controls.length) % controls.length];
    next.focus({ preventScroll: false });
  }
}
