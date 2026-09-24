import type { EventBus } from '../core/Events';
import { itemDef } from './items';

// Slot inventory: 8 hotbar slots followed by the backpack. Tools carry
// durability per stack (stack size 1). All mutations announce themselves so
// the HUD, quests and audio stay in sync without polling.

export interface ItemStack {
  id: string;
  count: number;
  /** Remaining durability for tools; undefined for everything else. */
  durability?: number;
}

export const HOTBAR_SIZE = 8;
export const BACKPACK_SIZE = 24;

export class Inventory {
  readonly slots: (ItemStack | null)[];
  /** Hotbar slot currently in hand. */
  selected = 0;

  constructor(
    private readonly events: EventBus,
    size = HOTBAR_SIZE + BACKPACK_SIZE,
  ) {
    this.slots = new Array(size).fill(null);
  }

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id: string, count = 1): boolean {
    return this.count(id) >= count;
  }

  /** Adds items; returns how many did not fit. */
  add(id: string, count = 1, durability?: number): number {
    const def = itemDef(id);
    let left = count;
    // Top up existing stacks first (hotbar, then backpack).
    if (def.stack > 1) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < def.stack) {
          const put = Math.min(left, def.stack - s.count);
          s.count += put;
          left -= put;
        }
      }
    }
    // New stacks: tools prefer the hotbar, resources the backpack.
    const preferHotbar = def.category === 'tool' || def.category === 'weapon' || def.category === 'food' || def.category === 'placeable';
    const order = preferHotbar ? this.slotOrder(true) : this.slotOrder(false);
    for (const i of order) {
      if (left <= 0) break;
      if (this.slots[i]) continue;
      const put = Math.min(left, def.stack);
      this.slots[i] = { id, count: put, durability: def.tool && def.tool.durability > 0 ? (durability ?? def.tool.durability) : undefined };
      left -= put;
    }
    const added = count - left;
    if (added > 0) {
      this.events.emit('itemAdded', { id, count: added, total: this.count(id) });
      this.events.emit('inventoryChanged', {});
    }
    return left;
  }

  private slotOrder(hotbarFirst: boolean): number[] {
    const hot = Array.from({ length: HOTBAR_SIZE }, (_, i) => i);
    const pack = Array.from({ length: this.slots.length - HOTBAR_SIZE }, (_, i) => i + HOTBAR_SIZE);
    return hotbarFirst ? [...hot, ...pack] : [...pack, ...hot];
  }

  /** Removes items (backpack first); returns true if all were available. */
  remove(id: string, count = 1): boolean {
    if (!this.has(id, count)) return false;
    let left = count;
    for (const i of this.slotOrder(false).reverse()) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
      if (left <= 0) break;
    }
    this.events.emit('itemRemoved', { id, count, total: this.count(id) });
    this.events.emit('inventoryChanged', {});
    return true;
  }

  /** Space for `count` more of an item? */
  canFit(id: string, count: number): boolean {
    const def = itemDef(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += def.stack;
      else if (s.id === id) room += def.stack - s.count;
      if (room >= count) return true;
    }
    return room >= count;
  }

  /** Wears the held tool; breaks it at zero. Returns true if it broke. */
  wearHeld(amount = 1): boolean {
    const s = this.held;
    if (!s || s.durability === undefined) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      const name = itemDef(s.id).name;
      this.slots[this.selected] = null;
      this.events.emit('notify', { text: `${name} broke`, icon: 'close', tone: 'bad' });
      this.events.emit('inventoryChanged', {});
      return true;
    }
    this.events.emit('inventoryChanged', {});
    return false;
  }

  consumeSlot(index: number, count = 1): void {
    const s = this.slots[index];
    if (!s) return;
    s.count -= count;
    if (s.count <= 0) this.slots[index] = null;
    this.events.emit('itemRemoved', { id: s.id, count, total: this.count(s.id) });
    this.events.emit('inventoryChanged', {});
  }

  swap(a: number, b: number): void {
    if (a === b) return;
    const sa = this.slots[a];
    const sb = this.slots[b];
    // Merge identical stackables.
    if (sa && sb && sa.id === sb.id && sa.durability === undefined) {
      const def = itemDef(sa.id);
      const put = Math.min(sa.count, def.stack - sb.count);
      sb.count += put;
      sa.count -= put;
      if (sa.count <= 0) this.slots[a] = null;
    } else {
      this.slots[a] = sb;
      this.slots[b] = sa;
    }
    this.events.emit('inventoryChanged', {});
  }

  select(index: number): void {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.events.emit('inventoryChanged', {});
  }

  serialize(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(slots: (ItemStack | null)[]): void {
    for (let i = 0; i < this.slots.length; i += 1) this.slots[i] = slots[i] ? { ...(slots[i] as ItemStack) } : null;
    this.events.emit('inventoryChanged', {});
  }
}
