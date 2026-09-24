import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/Events';
import { HOTBAR_SIZE, Inventory } from '../../src/game/Inventory';
import { itemDef } from '../../src/game/items';

describe('inventory', () => {
  it('stacks up to the item limit and spills into new slots', () => {
    const inv = new Inventory(new EventBus());
    const stack = itemDef('wood').stack;
    expect(inv.add('wood', stack + 3)).toBe(0);
    expect(inv.count('wood')).toBe(stack + 3);
    expect(inv.slots.filter((s) => s?.id === 'wood').length).toBe(2);
  });

  it('puts tools on the hotbar and resources in the pack', () => {
    const inv = new Inventory(new EventBus());
    inv.add('stone_axe', 1);
    inv.add('flint', 3);
    expect(inv.slots.findIndex((s) => s?.id === 'stone_axe')).toBeLessThan(HOTBAR_SIZE);
    expect(inv.slots.findIndex((s) => s?.id === 'flint')).toBeGreaterThanOrEqual(HOTBAR_SIZE);
  });

  it('gives tools durability and wears them down', () => {
    const inv = new Inventory(new EventBus());
    inv.add('stone_axe', 1);
    const i = inv.slots.findIndex((s) => s?.id === 'stone_axe');
    inv.select(i);
    const before = inv.held?.durability ?? 0;
    expect(before).toBeGreaterThan(0);
    inv.wearHeld(5);
    expect(inv.held?.durability).toBe(before - 5);
  });

  it('removes across stacks and reports shortfalls', () => {
    const inv = new Inventory(new EventBus());
    inv.add('stick', 10);
    expect(inv.remove('stick', 4)).toBe(true);
    expect(inv.count('stick')).toBe(6);
    expect(inv.remove('stick', 7)).toBe(false);
    expect(inv.count('stick')).toBe(6);
  });

  it('reports what does not fit', () => {
    const inv = new Inventory(new EventBus(), 2);
    const stack = itemDef('stone').stack;
    expect(inv.add('stone', stack * 3)).toBe(stack);
    expect(inv.canFit('stone', 1)).toBe(false);
  });

  it('announces changes', () => {
    const events = new EventBus();
    const inv = new Inventory(events);
    const added: string[] = [];
    events.on('itemAdded', ({ id }) => added.push(id));
    inv.add('berries', 2);
    expect(added).toEqual(['berries']);
  });
});
