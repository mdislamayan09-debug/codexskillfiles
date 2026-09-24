import { describe, expect, it } from 'vitest';
import { CROPS, cropForSeed, growCrop, harvestYield, normalizeCrop, type CropState } from '../../src/game/Farming';
import { ITEMS } from '../../src/game/items';
import { BIOME } from '../../src/world/WorldConfig';

const itemIds = new Set(ITEMS.map((i) => i.id));
const fresh = (id: string, water = 1): CropState => ({ id, growth: 0, water, last: 0, harvests: 0 });

describe('farming', () => {
  it('plants and yields only real items', () => {
    for (const c of CROPS) {
      expect(itemIds.has(c.seed), c.seed).toBe(true);
      for (const [item] of c.yields) expect(itemIds.has(item), item).toBe(true);
    }
    expect(cropForSeed('seeds')?.id).toBe('flax');
    expect(cropForSeed('stone')).toBeNull();
  });

  it('ripens in its time when kept watered', () => {
    const crop = fresh('flax');
    for (let h = 1; h <= 30; h += 1) growCrop(crop, h, 1, BIOME.Hollowpine);
    expect(crop.growth).toBeCloseTo(1, 5);
  });

  it('grows slowly on dry soil, and the soil dries out', () => {
    const wet = fresh('flax', 1);
    const dry = fresh('flax', 0);
    growCrop(wet, 10, 0, BIOME.Hollowpine);
    growCrop(dry, 10, 0, BIOME.Hollowpine);
    expect(dry.growth).toBeLessThan(wet.growth * 0.3);
    expect(wet.water).toBeCloseTo(1 - 10 / 30, 5);
  });

  it('is watered by rain', () => {
    const crop = fresh('flax', 0);
    growCrop(crop, 5, 0.8, BIOME.Greensward);
    expect(crop.water).toBeGreaterThan(0.8);
  });

  it('suffers in the cold, except frostmint', () => {
    const flax = fresh('flax');
    const mint = fresh('frostmint');
    growCrop(flax, 10, 1, BIOME.Frostveil);
    growCrop(mint, 10, 1, BIOME.Frostveil);
    expect(mint.growth).toBeGreaterThan(flax.growth * 2);
  });

  it('gives the same harvest for the same plot and picking', () => {
    const crop = { ...fresh('lanternberry'), growth: 1 };
    expect(harvestYield('s12', crop)).toEqual(harvestYield('s12', crop));
    const [[item, n]] = harvestYield('s12', crop);
    expect(item).toBe('berries');
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('carries old saves forward', () => {
    const c = normalizeCrop({ planted: 10, ready: 46 }, 28);
    expect(c?.id).toBe('flax');
    expect(c?.growth).toBeCloseTo(0.5, 5);
    expect(normalizeCrop(null, 0)).toBeNull();
    expect(normalizeCrop({ id: 'nonsense' }, 0)).toBeNull();
  });
});
