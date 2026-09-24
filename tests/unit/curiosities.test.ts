import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/game/items';
import { CAIRN_LINES, ECHO_LINES, PACK_LOOT } from '../../src/story/Curiosities';

const itemIds = new Set(ITEMS.map((i) => i.id));

describe('curiosities', () => {
  it('only give items that exist', () => {
    for (const pack of PACK_LOOT) for (const [item, n] of pack) {
      expect(itemIds.has(item), item).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
    expect(itemIds.has('heartsong')).toBe(true);
    expect(itemIds.has('songstone')).toBe(true);
  });

  it('have plenty to say', () => {
    expect(CAIRN_LINES.length).toBeGreaterThanOrEqual(12);
    expect(ECHO_LINES.length).toBeGreaterThanOrEqual(6);
    for (const line of [...CAIRN_LINES, ...ECHO_LINES]) expect(line.length).toBeGreaterThan(20);
  });
});
