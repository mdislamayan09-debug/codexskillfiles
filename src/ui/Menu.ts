import type { GameSettings, SettingsStore } from '../core/Settings';
import { QUALITY_LABELS, QUALITY_ORDER, type QualityName } from '../render/Quality';
import { icon } from './icons';

// Pause menu with tabbed settings. Graphics presets that need new geometry
// budgets are applied by saving the session and reloading (fast: the world
// is cached), everything else applies live.

export interface MenuHooks {
  onResume(): void;
  onApplyQuality(quality: QualityName | 'auto'): void;
  onRespawn?(): void;
  onQuitToTitle?(): void;
  detectedQuality: QualityName;
  activeQuality: QualityName;
  gpu: string;
}

type Tab = 'graphics' | 'controls' | 'audio' | 'accessibility' | 'gameplay';

const QUALITY_NOTES: Record<QualityName, string> = {
  low: 'Older integrated graphics. No volumetric clouds, short draw distance.',
  medium: 'Integrated graphics and mainstream laptops. Volumetric clouds, soft shadows, moderate foliage.',
  high: 'Recommended for Apple M-series and modern GPUs. God rays, reflections, full-resolution scene.',
  extra: 'Pro / Max class GPUs. Retina resolution, 4K shadows, denser grass and forests.',
  max: 'Everything: the finest clouds, longest view distance, densest vegetation. With dynamic resolution on, it holds your frame rate on any GPU.',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export class Menu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly nav: HTMLElement;
  private tab: Tab = 'graphics';
  private open = false;
  private pendingQuality: QualityName | 'auto';
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly resumeEl: HTMLElement;
  private readonly playOnly: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly settings: SettingsStore,
    private readonly hooks: MenuHooks,
  ) {
    this.pendingQuality = settings.get('quality');
    this.root = el('div', 'menu', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Paused');
    const frame = el('div', 'menu-frame', this.root);
    const side = el('div', 'menu-side', frame);
    this.titleEl = el('div', 'menu-title', side, 'Paused');
    this.subEl = el('div', 'menu-sub', side, 'The island waits.');
    const resume = el('button', 'menu-button primary', side, 'Resume');
    resume.addEventListener('click', () => this.hooks.onResume());
    this.resumeEl = resume;
    this.nav = el('nav', 'menu-nav', side);
    const tabs: [Tab, string][] = [
      ['graphics', 'Graphics'],
      ['controls', 'Controls'],
      ['audio', 'Audio'],
      ['accessibility', 'Accessibility'],
      ['gameplay', 'Gameplay'],
    ];
    for (const [id, label] of tabs) {
      const b = el('button', 'menu-tab', this.nav, label);
      b.dataset.tab = id;
      b.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
    }
    if (hooks.onRespawn) {
      const unstuck = el('button', 'menu-button subtle', side, 'Return to camp');
      unstuck.addEventListener('click', () => hooks.onRespawn?.());
      this.playOnly.push(unstuck);
    }
    if (hooks.onQuitToTitle) {
      const quit = el('button', 'menu-button subtle', side, 'Save and quit to title');
      quit.addEventListener('click', () => hooks.onQuitToTitle?.());
      this.playOnly.push(quit);
    }
    const hint = el('div', 'menu-hint', side);
    hint.innerHTML = '<kbd>Esc</kbd> resume';
    this.panel = el('div', 'menu-panel', frame);
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Paused mid-game, or settings opened from the title. */
  show(context: 'pause' | 'title' = 'pause'): void {
    this.open = true;
    this.pendingQuality = this.settings.get('quality');
    const title = context === 'title';
    this.titleEl.textContent = title ? 'Settings' : 'Paused';
    this.subEl.textContent = title ? 'Tune the island to your machine.' : 'The island waits.';
    this.resumeEl.textContent = title ? 'Back' : 'Resume';
    this.root.setAttribute('aria-label', title ? 'Settings' : 'Paused');
    for (const b of this.playOnly) b.style.display = title ? 'none' : '';
    this.render();
    this.root.classList.add('open');
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  private render(): void {
    for (const b of Array.from(this.nav.children) as HTMLElement[]) b.classList.toggle('active', b.dataset.tab === this.tab);
    this.panel.innerHTML = '';
    switch (this.tab) {
      case 'graphics':
        this.renderGraphics();
        break;
      case 'controls':
        this.renderControls();
        break;
      case 'audio':
        this.renderAudio();
        break;
      case 'accessibility':
        this.renderAccessibility();
        break;
      case 'gameplay':
        this.renderGameplay();
        break;
    }
  }

  private section(title: string): HTMLElement {
    const s = el('section', 'menu-section', this.panel);
    el('h3', 'menu-heading', s, title);
    return s;
  }

  private renderGraphics(): void {
    const s = this.section('Graphics quality');
    const seg = el('div', 'menu-quality', s);
    const options: (QualityName | 'auto')[] = ['auto', ...QUALITY_ORDER];
    for (const q of options) {
      const b = el('button', 'menu-quality-option', seg);
      b.innerHTML = `<span class="name">${q === 'auto' ? 'Auto' : QUALITY_LABELS[q]}</span>${q === 'auto' ? `<span class="tag">${QUALITY_LABELS[this.hooks.detectedQuality]}</span>` : ''}`;
      b.classList.toggle('selected', this.pendingQuality === q);
      b.addEventListener('click', () => {
        this.pendingQuality = q;
        this.render();
      });
    }
    const effective = this.pendingQuality === 'auto' ? this.hooks.detectedQuality : this.pendingQuality;
    el('p', 'menu-note', s, QUALITY_NOTES[effective]);
    const gpu = el('p', 'menu-note faint', s);
    gpu.textContent = `GPU: ${this.hooks.gpu || 'unknown'} · running ${QUALITY_LABELS[this.hooks.activeQuality]}`;
    if (this.pendingQuality !== this.settings.get('quality') || effective !== this.hooks.activeQuality) {
      const apply = el('button', 'menu-button primary', s, 'Apply preset');
      apply.addEventListener('click', () => {
        this.settings.set('quality', this.pendingQuality);
        this.hooks.onApplyQuality(this.pendingQuality);
      });
      el('p', 'menu-note faint', s, 'The world reloads in a few seconds; your position, time and pack are kept.');
    }
    const r = this.section('Resolution');
    this.toggle(r, 'Dynamic resolution (holds the frame rate)', 'dynamicResolution');
    this.select(r, 'Target frame rate', 'targetFps', [
      [30, '30 fps'],
      [45, '45 fps'],
      [60, '60 fps'],
      [90, '90 fps'],
      [120, '120 fps'],
    ]);
    this.slider(r, 'Sharpness', 'sharpness', 0, 1, 0.05, (n) => `${Math.round(n * 100)}%`);
    el('p', 'menu-note faint', r, 'Temporal anti-aliasing rebuilds every frame at your display’s full resolution; dynamic resolution renders the scene smaller only when frames run long.');
    const v = this.section('View');
    this.slider(v, 'Field of view', 'fov', 60, 100, 1, (n) => `${n}°`);
    this.slider(v, 'Brightness', 'brightness', 0.6, 1.6, 0.05, (n) => `${Math.round(n * 100)}%`);
    this.toggle(v, 'Show frame rate', 'showFps');
  }

  private renderControls(): void {
    const s = this.section('Look');
    this.slider(s, 'Mouse sensitivity', 'mouseSensitivity', 0.2, 3, 0.05, (n) => n.toFixed(2));
    this.slider(s, 'Controller sensitivity', 'padSensitivity', 0.2, 3, 0.05, (n) => n.toFixed(2));
    this.toggle(s, 'Invert vertical look', 'invertY');
    const m = this.section('Movement');
    this.toggle(m, 'Toggle sprint (instead of hold)', 'toggleSprint');
    this.toggle(m, 'Toggle crouch (instead of hold)', 'toggleCrouch');
    const k = this.section('Keys');
    const grid = el('div', 'menu-keys', k);
    const rows: [string, string][] = [
      ['Move', 'W A S D'],
      ['Jump / climb hop', 'Space'],
      ['Sprint', 'Shift'],
      ['Crouch / let go', 'C'],
      ['Interact / gather', 'E'],
      ['Use / attack', 'Left mouse'],
      ['Aim / block', 'Right mouse'],
      ['Hotbar', '1 – 8 · wheel'],
      ['Inventory & crafting', 'Tab'],
      ['Map', 'M'],
      ['Journal', 'J'],
      ['Build', 'B'],
      ['Lantern', 'F'],
      ['Photo mode', 'P'],
    ];
    for (const [action, keys] of rows) {
      el('span', 'menu-key-action', grid, action);
      const kk = el('span', 'menu-key-keys', grid);
      for (const part of keys.split(' · ')) {
        const kb = el('kbd', '', kk, part);
        void kb;
      }
    }
  }

  private renderAudio(): void {
    const s = this.section('Volume');
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    this.slider(s, 'Master', 'masterVolume', 0, 1, 0.01, pct);
    this.slider(s, 'Music', 'musicVolume', 0, 1, 0.01, pct);
    this.slider(s, 'Effects', 'sfxVolume', 0, 1, 0.01, pct);
    this.slider(s, 'Ambience', 'ambienceVolume', 0, 1, 0.01, pct);
  }

  private renderAccessibility(): void {
    const s = this.section('Motion');
    this.toggle(s, 'Reduced motion (no bob, shake or sway)', 'reducedMotion');
    this.toggle(s, 'Head bob', 'headBob');
    this.toggle(s, 'Camera shake', 'cameraShake');
    const v = this.section('Vision');
    this.select(v, 'Colour-blind filter', 'colorblind', [
      [0, 'Off'],
      [1, 'Protanopia'],
      [2, 'Deuteranopia'],
      [3, 'Tritanopia'],
    ]);
    this.slider(v, 'Interface scale', 'uiScale', 0.8, 1.4, 0.05, (n) => `${Math.round(n * 100)}%`);
    this.slider(v, 'HUD opacity', 'hudOpacity', 0.3, 1, 0.05, (n) => `${Math.round(n * 100)}%`);
    const t = this.section('Subtitles');
    this.toggle(t, 'Subtitles', 'subtitles');
    this.select(t, 'Subtitle size', 'subtitleSize', [
      ['small', 'Small'],
      ['medium', 'Medium'],
      ['large', 'Large'],
    ]);
  }

  private renderGameplay(): void {
    const s = this.section('Difficulty');
    this.select(s, 'Difficulty', 'difficulty', [
      ['explorer', 'Explorer — gentle needs, keep everything on death'],
      ['survivor', 'Survivor — the intended balance'],
      ['harsh', 'Harsh — hungry nights, lose your pack'],
    ]);
  }

  private row(parent: HTMLElement, label: string): HTMLElement {
    const row = el('label', 'menu-row', parent);
    el('span', 'menu-label', row, label);
    return row;
  }

  private slider<K extends keyof GameSettings>(parent: HTMLElement, label: string, key: K, min: number, max: number, step: number, format: (n: number) => string): void {
    const row = this.row(parent, label);
    const input = el('input', 'menu-slider', row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.settings.get(key));
    const value = el('span', 'menu-value', row, format(Number(this.settings.get(key))));
    input.addEventListener('input', () => {
      const n = Number(input.value);
      value.textContent = format(n);
      this.settings.set(key, n as GameSettings[K]);
    });
  }

  private toggle<K extends keyof GameSettings>(parent: HTMLElement, label: string, key: K): void {
    const row = this.row(parent, label);
    const input = el('input', 'menu-toggle', row);
    input.type = 'checkbox';
    input.checked = Boolean(this.settings.get(key));
    input.addEventListener('change', () => this.settings.set(key, input.checked as GameSettings[K]));
  }

  private select<K extends keyof GameSettings>(parent: HTMLElement, label: string, key: K, options: [GameSettings[K], string][]): void {
    const row = this.row(parent, label);
    const sel = el('select', 'menu-select', row);
    options.forEach(([value, text], i) => {
      const opt = el('option', '', sel, text);
      opt.value = String(i);
      if (value === this.settings.get(key)) sel.value = String(i);
    });
    sel.addEventListener('change', () => this.settings.set(key, options[Number(sel.value)][0]));
  }
}

/** Full-screen notice for death and respawn. */
export class DeathScreen {
  readonly root: HTMLElement;
  private readonly cause: HTMLElement;

  constructor(parent: HTMLElement, onRespawn: () => void) {
    this.root = el('div', 'death', parent);
    const inner = el('div', 'death-inner', this.root);
    el('div', 'death-title', inner, 'The island keeps you');
    this.cause = el('div', 'death-cause', inner);
    const b = el('button', 'menu-button primary', inner, 'Wake at camp');
    b.addEventListener('click', onRespawn);
    const i = el('span', 'death-icon', inner);
    i.innerHTML = icon('campfire');
  }

  show(cause: string): void {
    const text: Record<string, string> = {
      fall: 'You fell too far.',
      cold: 'The cold took you.',
      heat: 'The heat was too much.',
      starvation: 'You starved.',
      dehydration: 'You ran out of water.',
      drowning: 'You drowned.',
    };
    this.cause.textContent = text[cause] ?? `Killed by ${cause}.`;
    this.root.classList.add('open');
  }

  hide(): void {
    this.root.classList.remove('open');
  }
}
