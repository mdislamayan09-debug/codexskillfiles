// Device-agnostic input. Gameplay reads *actions*, never raw keys, so every
// control is rebindable and works identically on keyboard/mouse and gamepad.

export type ButtonAction =
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'attack'
  | 'aim'
  | 'dodge'
  | 'lantern'
  | 'inventory'
  | 'map'
  | 'journal'
  | 'build'
  | 'pause'
  | 'lockOn'
  | 'hotbar1'
  | 'hotbar2'
  | 'hotbar3'
  | 'hotbar4'
  | 'hotbar5'
  | 'hotbar6'
  | 'hotbar7'
  | 'hotbar8'
  | 'hotbarNext'
  | 'hotbarPrev'
  | 'rotate'
  | 'camera'
  | 'photo'
  | 'debug';

export type Device = 'keyboard' | 'gamepad';

export type Bindings = Record<ButtonAction, string[]>;

/** Binding tokens: `Key:<code>`, `Mouse:<0-4>`, `Wheel:Up|Down`, `Pad:<button index>`. */
export const DEFAULT_BINDINGS: Bindings = {
  jump: ['Key:Space', 'Pad:0'],
  sprint: ['Key:ShiftLeft', 'Pad:10'],
  crouch: ['Key:KeyC', 'Key:ControlLeft', 'Pad:11'],
  interact: ['Key:KeyE', 'Pad:2'],
  attack: ['Mouse:0', 'Pad:7'],
  aim: ['Mouse:2', 'Pad:6'],
  dodge: ['Key:AltLeft', 'Key:KeyQ', 'Pad:1'],
  lantern: ['Key:KeyF', 'Pad:12'],
  inventory: ['Key:Tab', 'Key:KeyI', 'Pad:3'],
  map: ['Key:KeyM', 'Pad:8'],
  journal: ['Key:KeyJ', 'Pad:13'],
  build: ['Key:KeyB', 'Pad:14'],
  pause: ['Key:Escape', 'Pad:9'],
  lockOn: ['Mouse:1', 'Key:KeyT', 'Pad:15'],
  hotbar1: ['Key:Digit1'],
  hotbar2: ['Key:Digit2'],
  hotbar3: ['Key:Digit3'],
  hotbar4: ['Key:Digit4'],
  hotbar5: ['Key:Digit5'],
  hotbar6: ['Key:Digit6'],
  hotbar7: ['Key:Digit7'],
  hotbar8: ['Key:Digit8'],
  hotbarNext: ['Wheel:Down', 'Pad:5'],
  hotbarPrev: ['Wheel:Up', 'Pad:4'],
  rotate: ['Key:KeyR'],
  camera: ['Key:KeyV'],
  photo: ['Key:KeyP'],
  debug: ['Key:F3', 'Key:Backquote'],
};

export interface InputSettings {
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  toggleSprint: boolean;
  toggleCrouch: boolean;
  deadzone: number;
}

export class Input {
  bindings: Bindings;
  settings: InputSettings = {
    mouseSensitivity: 1,
    padSensitivity: 1,
    invertY: false,
    toggleSprint: false,
    toggleCrouch: true,
    deadzone: 0.18,
  };
  lastDevice: Device = 'keyboard';
  /** When false (menus), gameplay actions read as idle. */
  gameplayEnabled = true;

  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly releasedThisFrame = new Set<string>();
  private readonly prevPad = new Map<string, boolean>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelUp = false;
  private wheelDown = false;
  private readonly padAxes = [0, 0, 0, 0];
  private readonly toggled = new Set<ButtonAction>();
  private listeners: Array<() => void> = [];
  private readonly typedListeners = new Set<(event: KeyboardEvent) => void>();
  /** Text characters typed this frame (for name entry etc.). */
  capture: ((token: string) => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        this.capture(`Key:${e.code}`);
        return;
      }
      for (const fn of this.typedListeners) fn(e);
      if (e.repeat) return;
      const token = `Key:${e.code}`;
      // Menus keep the browser's own keyboard navigation (Tab, Space, Enter, arrows).
      const menuKey = !this.gameplayEnabled && (e.code === 'Tab' || e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow'));
      if (this.isBoundToken(token) && e.code !== 'F5' && e.code !== 'F12' && !menuKey) e.preventDefault();
      this.press(token);
      this.lastDevice = 'keyboard';
    });
    on(window, 'keyup', (e) => this.release(`Key:${e.code}`));
    on(element, 'mousedown', (e) => {
      if (this.capture) {
        e.preventDefault();
        this.capture(`Mouse:${e.button}`);
        return;
      }
      this.press(`Mouse:${e.button}`);
      this.lastDevice = 'keyboard';
    });
    on(window, 'mouseup', (e) => this.release(`Mouse:${e.button}`));
    on(window, 'mousemove', (e) => {
      if (document.pointerLockElement === this.element) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) this.lastDevice = 'keyboard';
      }
    });
    on(
      element,
      'wheel',
      (e) => {
        if (e.deltaY < 0) this.wheelUp = true;
        else if (e.deltaY > 0) this.wheelDown = true;
      },
      { passive: true },
    );
    on(element, 'contextmenu', (e) => e.preventDefault());
    on(window, 'blur', () => this.releaseAll());
    on(document as unknown as HTMLElement, 'visibilitychange' as keyof WindowEventMap, () => {
      if (document.hidden) this.releaseAll();
    });
  }

  onKeyTyped(fn: (event: KeyboardEvent) => void): () => void {
    this.typedListeners.add(fn);
    return () => this.typedListeners.delete(fn);
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.element) {
      const result = this.element.requestPointerLock?.() as Promise<void> | undefined;
      result?.catch?.(() => undefined);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  private isBoundToken(token: string): boolean {
    for (const list of Object.values(this.bindings)) if (list.includes(token)) return true;
    return false;
  }

  private press(token: string): void {
    if (!this.down.has(token)) this.pressedThisFrame.add(token);
    this.down.add(token);
  }

  private release(token: string): void {
    if (this.down.has(token)) this.releasedThisFrame.add(token);
    this.down.delete(token);
  }

  releaseAll(): void {
    for (const token of this.down) this.releasedThisFrame.add(token);
    this.down.clear();
  }

  /** Poll gamepads; call once per frame before gameplay reads input. */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) {
      this.padAxes.fill(0);
      return;
    }
    const dz = this.settings.deadzone;
    for (let a = 0; a < 4; a += 1) {
      const v = pad.axes[a] ?? 0;
      const mag = Math.abs(v);
      this.padAxes[a] = mag < dz ? 0 : Math.sign(v) * ((mag - dz) / (1 - dz));
    }
    if (this.padAxes.some((v) => v !== 0)) this.lastDevice = 'gamepad';
    pad.buttons.forEach((button, index) => {
      const token = `Pad:${index}`;
      const pressed = button.pressed || button.value > 0.5;
      const was = this.prevPad.get(token) ?? false;
      if (pressed && !was) {
        this.press(token);
        this.lastDevice = 'gamepad';
      } else if (!pressed && was) {
        this.release(token);
      }
      this.prevPad.set(token, pressed);
    });
  }

  /** Clear per-frame edges; call at the end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelUp = false;
    this.wheelDown = false;
  }

  private tokenDown(token: string): boolean {
    if (token === 'Wheel:Up') return this.wheelUp;
    if (token === 'Wheel:Down') return this.wheelDown;
    return this.down.has(token);
  }

  private tokenPressed(token: string): boolean {
    if (token === 'Wheel:Up') return this.wheelUp;
    if (token === 'Wheel:Down') return this.wheelDown;
    return this.pressedThisFrame.has(token);
  }

  isDown(action: ButtonAction, ignoreGameplayGate = false): boolean {
    if (!this.gameplayEnabled && !ignoreGameplayGate) return false;
    if ((action === 'sprint' && this.settings.toggleSprint) || (action === 'crouch' && this.settings.toggleCrouch)) {
      if (this.bindings[action].some((t) => this.tokenPressed(t))) {
        if (this.toggled.has(action)) this.toggled.delete(action);
        else this.toggled.add(action);
      }
      return this.toggled.has(action);
    }
    return this.bindings[action].some((t) => this.tokenDown(t));
  }

  clearToggle(action: ButtonAction): void {
    this.toggled.delete(action);
  }

  wasPressed(action: ButtonAction, ignoreGameplayGate = false): boolean {
    if (!this.gameplayEnabled && !ignoreGameplayGate) return false;
    return this.bindings[action].some((t) => this.tokenPressed(t));
  }

  wasReleased(action: ButtonAction): boolean {
    return this.bindings[action].some((t) => this.releasedThisFrame.has(t));
  }

  /** Movement vector: x right, y forward, magnitude ≤ 1. */
  movement(out: { x: number; y: number }): { x: number; y: number } {
    if (!this.gameplayEnabled) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    let x = 0;
    let y = 0;
    if (this.down.has('Key:KeyA') || this.down.has('Key:ArrowLeft')) x -= 1;
    if (this.down.has('Key:KeyD') || this.down.has('Key:ArrowRight')) x += 1;
    if (this.down.has('Key:KeyW') || this.down.has('Key:ArrowUp')) y += 1;
    if (this.down.has('Key:KeyS') || this.down.has('Key:ArrowDown')) y -= 1;
    x += this.padAxes[0];
    y -= this.padAxes[1];
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Look delta in radians for this frame. */
  look(dt: number, out: { x: number; y: number }): { x: number; y: number } {
    if (!this.gameplayEnabled) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    const mouseScale = 0.0022 * this.settings.mouseSensitivity;
    const padScale = 2.6 * this.settings.padSensitivity * dt;
    const invert = this.settings.invertY ? -1 : 1;
    out.x = this.mouseDX * mouseScale + this.padAxes[2] * Math.abs(this.padAxes[2]) * padScale;
    out.y = (this.mouseDY * mouseScale + this.padAxes[3] * Math.abs(this.padAxes[3]) * padScale) * invert;
    return out;
  }

  bindingLabel(action: ButtonAction, device: Device = this.lastDevice): string {
    const list = this.bindings[action];
    const token = list.find((t) => (device === 'gamepad' ? t.startsWith('Pad:') : !t.startsWith('Pad:'))) ?? list[0];
    return tokenLabel(token ?? '');
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}

const PAD_LABELS: Record<string, string> = {
  '0': 'A',
  '1': 'B',
  '2': 'X',
  '3': 'Y',
  '4': 'LB',
  '5': 'RB',
  '6': 'LT',
  '7': 'RT',
  '8': 'View',
  '9': 'Menu',
  '10': 'LS',
  '11': 'RS',
  '12': 'D-Up',
  '13': 'D-Down',
  '14': 'D-Left',
  '15': 'D-Right',
};

export function tokenLabel(token: string): string {
  const [kind, value] = token.split(':');
  if (kind === 'Key') {
    if (value.startsWith('Key')) return value.slice(3);
    if (value.startsWith('Digit')) return value.slice(5);
    const map: Record<string, string> = {
      Space: 'Space',
      ShiftLeft: 'Shift',
      ShiftRight: 'Shift',
      ControlLeft: 'Ctrl',
      AltLeft: 'Alt',
      Escape: 'Esc',
      Tab: 'Tab',
      Backquote: '`',
      Enter: 'Enter',
    };
    return map[value] ?? value;
  }
  if (kind === 'Mouse') return ['LMB', 'MMB', 'RMB', 'Mouse 4', 'Mouse 5'][Number(value)] ?? `Mouse ${value}`;
  if (kind === 'Wheel') return value === 'Up' ? 'Wheel ↑' : 'Wheel ↓';
  if (kind === 'Pad') return PAD_LABELS[value] ?? `Pad ${value}`;
  return token;
}
