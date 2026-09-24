import type { EventBus } from '../core/Events';
import { itemDef } from '../game/items';
import { BACKPACK_SIZE, HOTBAR_SIZE, type Inventory, type ItemStack } from '../game/Inventory';
import { CATEGORY_NAMES, RECIPES, STATION_NAMES, type Recipe, type RecipeCategory, type Station } from '../game/recipes';
import { icon } from './icons';

// One screen for the pack and the workbench: hotbar + backpack grid on the
// left (click to lift, click to drop/swap, right-click to use), crafting on
// the right filtered by the stations in reach. An open chest adds a third
// grid for transfers.

export interface CraftHooks {
  stations(): Set<Station>;
  onUse(slot: number): void;
  onClose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export function canCraft(recipe: Recipe, inventory: Inventory, stations: Set<Station>): boolean {
  if (!stations.has(recipe.station)) return false;
  for (const [item, n] of recipe.inputs) if (!inventory.has(item, n)) return false;
  return inventory.canFit(recipe.output, recipe.count);
}

export function craft(recipe: Recipe, inventory: Inventory, stations: Set<Station>, events: EventBus): boolean {
  if (!canCraft(recipe, inventory, stations)) return false;
  for (const [item, n] of recipe.inputs) inventory.remove(item, n);
  inventory.add(recipe.output, recipe.count);
  events.emit('crafted', { recipe: recipe.id, item: recipe.output, count: recipe.count });
  return true;
}

export class InventoryScreen {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly chestPanel: HTMLElement;
  private readonly chestGrid: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly stationsEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly list: HTMLElement;
  private readonly recipePanel: HTMLElement;
  private readonly cursor: HTMLElement;
  private open = false;
  private category: RecipeCategory | 'all' = 'all';
  private selectedRecipe: Recipe | null = null;
  /** Lifted stack: [source container, slot]. */
  private lifted: { container: 'pack' | 'chest'; slot: number } | null = null;
  private chest: (ItemStack | null)[] | null = null;
  private chestName = '';
  private chestSlots = 0;
  private readonly chestLabel: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly inventory: Inventory,
    private readonly events: EventBus,
    private readonly hooks: CraftHooks,
  ) {
    this.root = el('div', 'inv', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inventory and crafting');
    const frame = el('div', 'inv-frame', this.root);

    const left = el('section', 'inv-left', frame);
    const head = el('div', 'inv-head', left);
    el('h2', 'inv-title', head, 'Pack');
    const close = el('button', 'inv-close', head);
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.hooks.onClose());
    el('div', 'inv-label', left, 'Hotbar');
    this.hotbar = el('div', 'inv-grid inv-hotbar', left);
    el('div', 'inv-label', left, 'Backpack');
    this.grid = el('div', 'inv-grid', left);
    this.chestPanel = el('div', 'inv-chest', left);
    const chestHead = el('div', 'inv-chest-head', this.chestPanel);
    this.chestLabel = el('div', 'inv-label', chestHead, 'Storage');
    const takeAll = el('button', 'inv-take', chestHead, 'Take all');
    takeAll.addEventListener('click', () => this.takeAll());
    this.chestGrid = el('div', 'inv-grid', this.chestPanel);
    this.detail = el('div', 'inv-detail', left);

    const right = el('section', 'inv-right', frame);
    el('h2', 'inv-title', right, 'Crafting');
    this.stationsEl = el('div', 'inv-stations', right);
    this.tabsEl = el('div', 'inv-tabs', right);
    this.list = el('div', 'inv-recipes', right);
    this.recipePanel = el('div', 'inv-recipe', right);
    this.cursor = el('div', 'inv-cursor', this.root);

    for (let i = 0; i < HOTBAR_SIZE; i += 1) this.slotEl(this.hotbar, 'pack', i);
    for (let i = 0; i < BACKPACK_SIZE; i += 1) this.slotEl(this.grid, 'pack', HOTBAR_SIZE + i);

    this.root.addEventListener('mousemove', (e) => {
      this.cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    events.on('inventoryChanged', () => {
      if (this.open) this.render();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(chest: (ItemStack | null)[] | null = null, chestName = ''): void {
    this.open = true;
    this.chest = chest;
    this.chestName = chestName;
    if (chest && chest.length !== this.chestSlots) {
      // Containers differ in size (chests, a dropped pack): rebuild the grid.
      this.chestGrid.innerHTML = '';
      for (let i = 0; i < chest.length; i += 1) this.slotEl(this.chestGrid, 'chest', i);
      this.chestSlots = chest.length;
    }
    this.root.classList.add('open');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.dropLifted();
    this.root.classList.remove('open');
    this.chest = null;
  }

  private slotEl(parent: HTMLElement, container: 'pack' | 'chest', slot: number): void {
    const node = el('button', 'inv-slot', parent);
    node.dataset.container = container;
    node.dataset.slot = String(slot);
    node.innerHTML = '<span class="ic"></span><span class="count"></span><span class="dur"><i></i></span>';
    node.addEventListener('click', () => this.clickSlot(container, slot));
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (container === 'pack') this.hooks.onUse(slot);
    });
    node.addEventListener('mouseenter', () => this.showDetail(this.stackAt(container, slot)));
  }

  private stackAt(container: 'pack' | 'chest', slot: number): ItemStack | null {
    return container === 'pack' ? this.inventory.slots[slot] : (this.chest?.[slot] ?? null);
  }

  private setStack(container: 'pack' | 'chest', slot: number, stack: ItemStack | null): void {
    if (container === 'pack') this.inventory.slots[slot] = stack;
    else if (this.chest) this.chest[slot] = stack;
  }

  private clickSlot(container: 'pack' | 'chest', slot: number): void {
    if (container === 'chest' && !this.chest) return;
    if (!this.lifted) {
      if (this.stackAt(container, slot)) this.lifted = { container, slot };
    } else {
      const from = this.lifted;
      this.lifted = null;
      if (from.container === 'pack' && container === 'pack') this.inventory.swap(from.slot, slot);
      else {
        const a = this.stackAt(from.container, from.slot);
        const b = this.stackAt(container, slot);
        if (a && b && a.id === b.id && a.durability === undefined) {
          const max = itemDef(a.id).stack;
          const put = Math.min(a.count, max - b.count);
          b.count += put;
          a.count -= put;
          if (a.count <= 0) this.setStack(from.container, from.slot, null);
        } else {
          this.setStack(from.container, from.slot, b);
          this.setStack(container, slot, a);
        }
        this.events.emit('inventoryChanged', {});
      }
    }
    this.render();
  }

  /** Move everything that fits from the open container into the pack. */
  private takeAll(): void {
    const chest = this.chest;
    if (!chest) return;
    this.dropLifted();
    for (let i = 0; i < chest.length; i += 1) {
      const s = chest[i];
      if (!s) continue;
      if (s.durability !== undefined) {
        // Tools keep their wear: move whole stacks into empty slots only.
        const free = this.inventory.slots.indexOf(null);
        if (free < 0) continue;
        this.inventory.slots[free] = s;
        chest[i] = null;
        continue;
      }
      const left = this.inventory.add(s.id, s.count);
      if (left <= 0) chest[i] = null;
      else s.count = left;
    }
    this.events.emit('inventoryChanged', {});
    this.render();
  }

  get containerEmpty(): boolean {
    return !this.chest || this.chest.every((s) => !s);
  }

  private dropLifted(): void {
    this.lifted = null;
    this.cursor.innerHTML = '';
  }

  private showDetail(stack: ItemStack | null): void {
    if (!stack) {
      this.detail.innerHTML = '';
      return;
    }
    const def = itemDef(stack.id);
    const stats: string[] = [];
    if (def.tool && def.tool.damage) stats.push(`Damage ${def.tool.damage}`);
    if (def.tool && def.tool.durability) stats.push(`Durability ${stack.durability ?? def.tool.durability}/${def.tool.durability}`);
    if (def.food) {
      if (def.food.food) stats.push(`Food +${def.food.food}`);
      if (def.food.water) stats.push(`Water +${def.food.water}`);
      if (def.food.health) stats.push(`Health +${def.food.health}`);
      if (def.food.warmth) stats.push(def.food.warmth > 0 ? 'Warming' : 'Cooling');
    }
    if (def.armor) stats.push(`Protection ${def.armor.protection}`, `Warmth ${def.armor.warmth}`);
    this.detail.innerHTML = `<div class="ic">${icon(def.icon)}</div><div class="body"><b></b><p></p><small></small></div>`;
    (this.detail.querySelector('b') as HTMLElement).textContent = def.name;
    (this.detail.querySelector('p') as HTMLElement).textContent = def.description;
    (this.detail.querySelector('small') as HTMLElement).textContent = [...stats, def.category === 'food' || def.category === 'medicine' ? 'Right-click to eat' : ''].filter(Boolean).join(' · ');
  }

  private renderSlots(): void {
    for (const node of Array.from(this.root.querySelectorAll<HTMLElement>('.inv-slot'))) {
      const container = node.dataset.container as 'pack' | 'chest';
      const slot = Number(node.dataset.slot);
      const stack = this.stackAt(container, slot);
      const ic = node.querySelector('.ic') as HTMLElement;
      const count = node.querySelector('.count') as HTMLElement;
      const dur = node.querySelector('.dur') as HTMLElement;
      node.classList.toggle('lifted', Boolean(this.lifted && this.lifted.container === container && this.lifted.slot === slot));
      node.classList.toggle('selected', container === 'pack' && slot === this.inventory.selected);
      if (!stack) {
        ic.innerHTML = '';
        count.textContent = '';
        dur.style.display = 'none';
        node.setAttribute('aria-label', 'Empty slot');
        continue;
      }
      const def = itemDef(stack.id);
      ic.innerHTML = icon(def.icon);
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      node.setAttribute('aria-label', `${def.name}${stack.count > 1 ? ` ×${stack.count}` : ''}`);
      if (stack.durability !== undefined && def.tool && def.tool.durability > 0) {
        dur.style.display = '';
        (dur.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, stack.durability / def.tool.durability)})`;
      } else dur.style.display = 'none';
    }
    const lifted = this.lifted ? this.stackAt(this.lifted.container, this.lifted.slot) : null;
    this.cursor.innerHTML = lifted ? icon(itemDef(lifted.id).icon) : '';
  }

  private render(): void {
    this.renderSlots();
    this.chestPanel.style.display = this.chest ? '' : 'none';
    if (this.chest) this.chestLabel.textContent = this.chestName || 'Storage';
    const stations = this.hooks.stations();
    this.stationsEl.innerHTML = '';
    for (const s of stations) el('span', 'inv-station', this.stationsEl, STATION_NAMES[s]);

    this.tabsEl.innerHTML = '';
    const cats: (RecipeCategory | 'all')[] = ['all', 'tools', 'survival', 'food', 'gear', 'building', 'materials'];
    for (const c of cats) {
      const b = el('button', 'inv-tab', this.tabsEl, c === 'all' ? 'All' : CATEGORY_NAMES[c]);
      b.classList.toggle('active', c === this.category);
      b.addEventListener('click', () => {
        this.category = c;
        this.render();
      });
    }

    // Craftable first, then those one station away, then the rest.
    const visible = RECIPES.filter((r) => this.category === 'all' || r.category === this.category);
    const rank = (r: Recipe) => (canCraft(r, this.inventory, stations) ? 0 : stations.has(r.station) ? 1 : 2);
    visible.sort((a, b) => rank(a) - rank(b));
    this.list.innerHTML = '';
    for (const r of visible) {
      const def = itemDef(r.output);
      const ok = canCraft(r, this.inventory, stations);
      const row = el('button', `inv-recipe-row${ok ? ' ok' : ''}${stations.has(r.station) ? '' : ' far'}`, this.list);
      row.innerHTML = `<span class="ic">${icon(def.icon)}</span><span class="name"></span><span class="where"></span>`;
      (row.querySelector('.name') as HTMLElement).textContent = `${def.name}${r.count > 1 ? ` ×${r.count}` : ''}`;
      (row.querySelector('.where') as HTMLElement).textContent = r.station === 'hands' ? '' : STATION_NAMES[r.station];
      row.classList.toggle('active', this.selectedRecipe === r);
      row.addEventListener('click', () => {
        this.selectedRecipe = r;
        this.render();
      });
    }
    if (!this.selectedRecipe || !visible.includes(this.selectedRecipe)) this.selectedRecipe = visible[0] ?? null;
    this.renderRecipe(stations);
  }

  private renderRecipe(stations: Set<Station>): void {
    const r = this.selectedRecipe;
    this.recipePanel.innerHTML = '';
    if (!r) return;
    const def = itemDef(r.output);
    const head = el('div', 'inv-recipe-head', this.recipePanel);
    head.innerHTML = `<span class="ic">${icon(def.icon)}</span><div><b></b><p></p></div>`;
    (head.querySelector('b') as HTMLElement).textContent = `${def.name}${r.count > 1 ? ` ×${r.count}` : ''}`;
    (head.querySelector('p') as HTMLElement).textContent = def.description;
    const needs = el('ul', 'inv-needs', this.recipePanel);
    for (const [item, n] of r.inputs) {
      const have = this.inventory.count(item);
      const li = el('li', have >= n ? 'have' : 'missing', needs);
      li.innerHTML = `<span class="ic">${icon(itemDef(item).icon)}</span><span class="n"></span><span class="c"></span>`;
      (li.querySelector('.n') as HTMLElement).textContent = itemDef(item).name;
      (li.querySelector('.c') as HTMLElement).textContent = `${Math.min(have, 999)}/${n}`;
    }
    if (!stations.has(r.station)) el('p', 'inv-need-station', this.recipePanel, `Needs a ${STATION_NAMES[r.station].toLowerCase()} nearby`);
    const ok = canCraft(r, this.inventory, stations);
    const btn = el('button', `menu-button primary inv-craft${ok ? '' : ' disabled'}`, this.recipePanel, 'Craft');
    btn.disabled = !ok;
    btn.addEventListener('click', (e) => {
      const times = e.shiftKey ? 5 : 1;
      for (let i = 0; i < times; i += 1) if (!craft(r, this.inventory, this.hooks.stations(), this.events)) break;
      this.render();
    });
    el('p', 'inv-hint', this.recipePanel, 'Shift-click to craft five');
  }
}
