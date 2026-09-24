import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/game/items';
import { CACHE_SPOTS, CACHES, LANDMARK_LORE } from '../../src/story/LandmarkData';
import { LANDMARKS } from '../../src/world/WorldLayout';

const itemIds = new Set(ITEMS.map((i) => i.id));
const landmarkIds = new Set(LANDMARKS.map((l) => l.id));

describe('landmark caches', () => {
  it('belong to real places and have a spot to sit', () => {
    for (const id of Object.keys(CACHES)) {
      expect(landmarkIds.has(id), id).toBe(true);
      expect(CACHE_SPOTS[id], id).toBeDefined();
    }
  });

  it('only give items that exist', () => {
    for (const [id, cache] of Object.entries(CACHES)) {
      for (const [item, n] of cache.items) {
        expect(itemIds.has(item), `${id}: ${item}`).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });

  it('each add a distinct journal page', () => {
    const ids = LANDMARK_LORE.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LANDMARK_LORE) {
      expect(l.id.startsWith('lore:')).toBe(true);
      expect(l.text.length).toBeGreaterThan(40);
    }
  });

  it('cover most of the island', () => {
    expect(Object.keys(CACHES).length).toBeGreaterThanOrEqual(20);
  });
});
