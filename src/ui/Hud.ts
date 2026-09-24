import type { EventBus } from '../core/Events';
import { itemDef } from '../game/items';
import { HOTBAR_SIZE, type Inventory } from '../game/Inventory';
import type { SurvivalSnapshot } from '../game/Survival';
import { icon } from './icons';

// Diegetic-feeling HUD: everything fades unless it matters right now.

export interface CompassMarker {
  id: string;
  bearing: number;
  distance: number;
  kind: 'landmark' | 'quest' | 'satchel' | 'pin' | 'camp';
  label?: string;
}

export interface HudState {
  heading: number;
  markers: CompassMarker[];
  survival: SurvivalSnapshot;
  inventory: Inventory;
  hours: number;
  day: number;
  underwater: boolean;
  weather?: string;
}

const COMPASS_RANGE = 170;
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html !== undefined) node.innerHTML = html;
  parent?.appendChild(node);
  return node;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly tape: HTMLElement;
  private readonly markerLayer: HTMLElement;
  private readonly markerEls = new Map<string, HTMLElement>();
  private readonly clockIcon: HTMLElement;
  private readonly clockText: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthLoss: HTMLElement;
  private readonly vitals: HTMLElement;
  private readonly statusRow: HTMLElement;
  private readonly statusEls = new Map<string, HTMLElement>();
  private readonly staminaRing: SVGCircleElement;
  private readonly staminaWrap: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly heldName: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly lockMark: HTMLElement;
  private readonly scope: HTMLElement;
  private readonly scopeFocus: HTMLElement;
  private readonly notifications: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossTitle: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossLoss: HTMLElement;
  private bossShown = false;
  private bossFraction = 1;
  private bossLossFraction = 1;
  private readonly tapeWidth = 560;
  private lastHealth = 100;
  private healthLossTimer = 0;
  private staminaVisible = 0;
  private hotbarDirty = true;
  private heldNameTimer = 0;
  private bannerTimer = 0;
  private subtitleTimer = 0;
  private lastPrompt = '';
  private visible = true;

  constructor(parent: HTMLElement, events: EventBus) {
    this.root = el('div', 'hud', parent);

    // Compass tape.
    this.compass = el('div', 'hud-compass', this.root);
    const viewport = el('div', 'hud-compass-viewport', this.compass);
    this.tape = el('div', 'hud-compass-tape', viewport);
    const pxPerDeg = this.tapeWidth / COMPASS_RANGE;
    for (let d = -180; d <= 540; d += 5) {
      const norm = ((d % 360) + 360) % 360;
      const major = norm % 45 === 0;
      const tick = el('div', major ? 'tick major' : norm % 15 === 0 ? 'tick mid' : 'tick', this.tape);
      tick.style.left = `${(d + 180) * pxPerDeg}px`;
      if (major) {
        const label = el('span', CARDINALS[norm].length === 1 ? 'cardinal' : 'intercardinal', tick);
        label.textContent = CARDINALS[norm];
      }
    }
    this.markerLayer = el('div', 'hud-compass-markers', viewport);
    el('div', 'hud-compass-needle', this.compass);
    const clock = el('div', 'hud-clock', this.compass);
    this.clockIcon = el('span', 'hud-clock-icon', clock);
    this.clockText = el('span', 'hud-clock-text', clock);

    // Vitals.
    this.vitals = el('div', 'hud-vitals', this.root);
    const healthRow = el('div', 'hud-health', this.vitals);
    el('span', 'hud-health-icon', healthRow, icon('heart'));
    const bar = el('div', 'hud-health-bar', healthRow);
    this.healthLoss = el('div', 'hud-health-loss', bar);
    this.healthFill = el('div', 'hud-health-fill', bar);
    this.statusRow = el('div', 'hud-status', this.vitals);
    for (const [key, ic, label] of [
      ['food', 'food', 'Food'],
      ['water', 'water', 'Water'],
      ['temp', 'temperature', 'Body temperature'],
      ['wet', 'wet', 'Wet'],
    ] as const) {
      const item = el('div', `hud-stat hud-stat-${key}`, this.statusRow);
      item.setAttribute('aria-label', label);
      item.innerHTML = `<span class="ring"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15"/><circle class="fg" cx="18" cy="18" r="15"/></svg></span><span class="ic">${icon(ic)}</span>`;
      this.statusEls.set(key, item);
    }

    // Stamina ring beside the crosshair.
    this.staminaWrap = el('div', 'hud-stamina', this.root);
    this.staminaWrap.innerHTML = `<svg viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="19"/><circle class="fg" cx="24" cy="24" r="19"/></svg>`;
    this.staminaRing = this.staminaWrap.querySelector('circle.fg') as SVGCircleElement;

    this.crosshair = el('div', 'hud-crosshair', this.root);
    this.lockMark = el('div', 'hud-lock', this.root);
    this.scope = el('div', 'hud-spyglass', this.root);
    el('div', 'spy-ring', this.scope);
    this.scopeFocus = el('div', 'spy-focus', this.scope);
    this.prompt = el('div', 'hud-prompt', this.root);

    // Hotbar.
    this.hotbar = el('div', 'hud-hotbar', this.root);
    for (let i = 0; i < HOTBAR_SIZE; i += 1) {
      const slot = el('div', 'hud-slot', this.hotbar);
      slot.innerHTML = `<span class="key">${i + 1}</span><span class="ic"></span><span class="count"></span><span class="dur"><i></i></span>`;
      this.hotbarSlots.push(slot);
    }
    this.heldName = el('div', 'hud-held-name', this.root);

    this.notifications = el('div', 'hud-notifications', this.root);
    this.banner = el('div', 'hud-banner', this.root);
    this.subtitle = el('div', 'hud-subtitle', this.root);

    // Warden health: a long bar under the compass during a fight.
    this.boss = el('div', 'hud-boss', this.root);
    const bossHead = el('div', 'hud-boss-head', this.boss);
    this.bossName = el('span', 'hud-boss-name', bossHead);
    this.bossTitle = el('span', 'hud-boss-title', bossHead);
    const bossBar = el('div', 'hud-boss-bar', this.boss);
    this.bossLoss = el('div', 'hud-boss-loss', bossBar);
    this.bossFill = el('div', 'hud-boss-fill', bossBar);
    el('div', 'hud-boss-notch', bossBar);

    events.on('inventoryChanged', () => {
      this.hotbarDirty = true;
    });
    events.on('itemAdded', ({ id, count, total }) => {
      const def = itemDef(id);
      this.notify(`+${count} ${def.name}`, def.icon, 'good', `${total}`);
    });
    events.on('notify', ({ text, icon: ic, tone }) => this.notify(text, ic ?? 'compass', tone ?? 'info'));
    const kickers: Record<string, string> = { biome: 'Entering', quest: 'Completed', lore: 'Journal · Lore', landmark: 'Discovered' };
    events.on('discovered', ({ name, kind }) => this.showBanner(name, kickers[kind] ?? 'Discovered'));
    events.on('subtitle', ({ speaker, text, duration }) => this.showSubtitle(speaker, text, duration));
  }

  /** Show (or hide with null) a Warden's health. */
  setBoss(status: { name: string; title: string; fraction: number; phaseAt: number } | null, dt: number): void {
    const show = Boolean(status);
    if (show !== this.bossShown) {
      this.bossShown = show;
      this.boss.classList.toggle('show', show);
      if (status) {
        this.bossName.textContent = status.name;
        this.bossTitle.textContent = status.title;
        this.bossFraction = status.fraction;
        this.bossLossFraction = status.fraction;
        this.boss.style.setProperty('--notch', `${status.phaseAt * 100}%`);
      }
    }
    if (!status) return;
    this.bossFraction = status.fraction;
    // The pale "damage taken" segment drains after a beat.
    this.bossLossFraction = Math.max(this.bossFraction, this.bossLossFraction - dt * 0.25);
    this.bossFill.style.transform = `scaleX(${this.bossFraction})`;
    this.bossLoss.style.transform = `scaleX(${this.bossLossFraction})`;
  }

  /** Show the lock-on marker at a screen point (CSS pixels), or hide it. */
  setLock(at: { x: number; y: number } | null): void {
    this.lockMark.classList.toggle('show', at !== null);
    if (at) this.lockMark.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) rotate(45deg)`;
  }

  /** The spyglass: how far it is raised (0..1) and how long a place has been held in its sights. */
  setSpyglass(raised: number, focus: number): void {
    const show = raised > 0.002;
    if (!show && !this.scope.classList.contains('show')) return;
    this.scope.classList.toggle('show', show);
    this.scope.style.opacity = raised.toFixed(3);
    this.scopeFocus.style.setProperty('--focus', focus.toFixed(3));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
  }

  setOpacity(opacity: number): void {
    this.root.style.setProperty('--hud-opacity', String(opacity));
  }

  setPrompt(key: string | null, text: string | null): void {
    const html = key && text ? `<kbd>${key}</kbd><span>${text}</span>` : '';
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.prompt.innerHTML = html;
    this.prompt.classList.toggle('show', html.length > 0);
    this.crosshair.classList.toggle('active', html.length > 0);
  }

  notify(text: string, ic: string, tone: 'info' | 'good' | 'warn' | 'bad', aside?: string): void {
    const item = el('div', `hud-note tone-${tone}`, this.notifications);
    item.innerHTML = `<span class="ic">${icon(ic)}</span><span class="text"></span>${aside ? `<span class="aside">${aside}</span>` : ''}`;
    (item.querySelector('.text') as HTMLElement).textContent = text;
    while (this.notifications.children.length > 6) this.notifications.firstElementChild?.remove();
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 600);
    }, 3200);
  }

  showBanner(title: string, kicker: string): void {
    this.banner.innerHTML = `<span class="kicker"></span><span class="title"></span><span class="rule"></span>`;
    (this.banner.querySelector('.kicker') as HTMLElement).textContent = kicker;
    (this.banner.querySelector('.title') as HTMLElement).textContent = title;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = 5;
  }

  showSubtitle(speaker: string, text: string, duration: number): void {
    this.subtitle.innerHTML = speaker ? `<b></b><span></span>` : '<span></span>';
    if (speaker) (this.subtitle.querySelector('b') as HTMLElement).textContent = `${speaker}: `;
    (this.subtitle.querySelector('span') as HTMLElement).textContent = text;
    this.subtitle.classList.add('show');
    this.subtitleTimer = duration;
  }

  update(state: HudState, dt: number): void {
    if (!this.visible) return;
    this.updateCompass(state);
    this.updateVitals(state.survival, dt);
    if (this.hotbarDirty) this.renderHotbar(state.inventory);
    if (this.heldNameTimer > 0) {
      this.heldNameTimer -= dt;
      if (this.heldNameTimer <= 0) this.heldName.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.remove('show');
    }
    const hour = Math.floor(state.hours);
    const minute = Math.floor((state.hours - hour) * 60 / 10) * 10;
    const text = `Day ${state.day} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${state.weather ? ` · ${state.weather}` : ''}`;
    if (this.clockText.textContent !== text) this.clockText.textContent = text;
    const night = state.hours < 5.5 || state.hours > 19.5;
    const glyph = night ? 'moon' : 'sun';
    if (this.clockIcon.dataset.glyph !== glyph) {
      this.clockIcon.dataset.glyph = glyph;
      this.clockIcon.innerHTML = icon(glyph);
    }
  }

  private updateCompass(state: HudState): void {
    const pxPerDeg = this.tapeWidth / COMPASS_RANGE;
    const heading = ((state.heading % 360) + 360) % 360;
    this.tape.style.transform = `translateX(${this.tapeWidth / 2 - (heading + 180) * pxPerDeg}px)`;
    const seen = new Set<string>();
    for (const m of state.markers) {
      let delta = m.bearing - heading;
      delta = ((delta + 540) % 360) - 180;
      let node = this.markerEls.get(m.id);
      if (!node) {
        node = el('div', `hud-marker kind-${m.kind}`, this.markerLayer);
        node.innerHTML = `<span class="ic">${icon(m.kind === 'quest' ? 'quest' : m.kind === 'satchel' ? 'bag' : m.kind === 'camp' ? 'campfire' : 'landmark')}</span><span class="dist"></span>`;
        this.markerEls.set(m.id, node);
      }
      seen.add(m.id);
      const inRange = Math.abs(delta) < COMPASS_RANGE / 2 - 4;
      node.style.transform = `translateX(${this.tapeWidth / 2 + delta * pxPerDeg}px)`;
      node.classList.toggle('off', !inRange);
      node.classList.toggle('centered', Math.abs(delta) < 6);
      const dist = node.querySelector('.dist') as HTMLElement;
      const label = Math.abs(delta) < 6 ? `${m.label ? `${m.label} · ` : ''}${Math.round(m.distance)} m` : '';
      if (dist.textContent !== label) dist.textContent = label;
    }
    for (const [id, node] of this.markerEls) {
      if (!seen.has(id)) {
        node.remove();
        this.markerEls.delete(id);
      }
    }
  }

  private updateVitals(s: SurvivalSnapshot, dt: number): void {
    const hp = Math.max(0, s.health / s.maxHealth);
    this.healthFill.style.transform = `scaleX(${hp})`;
    if (s.health < this.lastHealth - 0.5) this.healthLossTimer = 0.8;
    if (this.healthLossTimer > 0) this.healthLossTimer -= dt;
    else this.healthLoss.style.transform = `scaleX(${hp})`;
    this.lastHealth = s.health;
    this.vitals.classList.toggle('critical', hp < 0.25);
    this.vitals.classList.toggle('quiet', hp > 0.98 && s.flags.length === 0 && s.food > 60 && s.water > 60);

    const setStat = (key: string, fill: number, show: boolean, level: 'ok' | 'warn' | 'bad', extra = '') => {
      const node = this.statusEls.get(key) as HTMLElement;
      const fg = node.querySelector('circle.fg') as SVGCircleElement;
      const c = 2 * Math.PI * 15;
      fg.style.strokeDasharray = `${c}`;
      fg.style.strokeDashoffset = `${c * (1 - Math.max(0, Math.min(1, fill)))}`;
      node.classList.toggle('show', show);
      node.dataset.level = level + extra;
    };
    setStat('food', s.food / 100, s.food < 60, s.food < 10 ? 'bad' : s.food < 25 ? 'warn' : 'ok');
    setStat('water', s.water / 100, s.water < 60, s.water < 10 ? 'bad' : s.water < 25 ? 'warn' : 'ok');
    const cold = s.bodyTemp < 36.2;
    const hot = s.bodyTemp > 37.9;
    const tempFill = cold ? (s.bodyTemp - 33) / 3.2 : hot ? 1 - (s.bodyTemp - 37.9) / 2 : 1;
    const tempLevel = s.bodyTemp < 34.2 || s.bodyTemp > 39.4 ? 'bad' : cold || hot ? 'warn' : 'ok';
    setStat('temp', tempFill, cold || hot, tempLevel, cold ? ' cold' : hot ? ' hot' : '');
    setStat('wet', s.wetness, s.wetness > 0.25, s.wetness > 0.7 ? 'warn' : 'ok');

    // Stamina ring: visible while not full.
    const st = s.stamina / s.maxStamina;
    const target = st < 0.995 ? 1 : 0;
    this.staminaVisible += (target - this.staminaVisible) * Math.min(1, dt * (target ? 10 : 2));
    this.staminaWrap.style.opacity = this.staminaVisible.toFixed(3);
    const c = 2 * Math.PI * 19;
    this.staminaRing.style.strokeDasharray = `${c}`;
    this.staminaRing.style.strokeDashoffset = `${c * (1 - st)}`;
    this.staminaWrap.classList.toggle('exhausted', s.exhausted);
    this.staminaWrap.classList.toggle('low', st < 0.25);
  }

  private renderHotbar(inventory: Inventory): void {
    this.hotbarDirty = false;
    for (let i = 0; i < HOTBAR_SIZE; i += 1) {
      const slot = this.hotbarSlots[i];
      const stack = inventory.slots[i];
      const ic = slot.querySelector('.ic') as HTMLElement;
      const count = slot.querySelector('.count') as HTMLElement;
      const dur = slot.querySelector('.dur') as HTMLElement;
      slot.classList.toggle('selected', i === inventory.selected);
      slot.classList.toggle('empty', !stack);
      if (!stack) {
        ic.innerHTML = '';
        count.textContent = '';
        dur.style.display = 'none';
        continue;
      }
      const def = itemDef(stack.id);
      if (ic.dataset.item !== stack.id) {
        ic.dataset.item = stack.id;
        ic.innerHTML = icon(def.icon);
      }
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      if (stack.durability !== undefined && def.tool) {
        dur.style.display = '';
        (dur.firstElementChild as HTMLElement).style.transform = `scaleX(${stack.durability / def.tool.durability})`;
      } else dur.style.display = 'none';
    }
    const held = inventory.held;
    const name = held ? itemDef(held.id).name : '';
    if (this.heldName.textContent !== name) {
      this.heldName.textContent = name;
      if (name) {
        this.heldName.classList.add('show');
        this.heldNameTimer = 1.6;
      } else this.heldName.classList.remove('show');
    }
  }
}
