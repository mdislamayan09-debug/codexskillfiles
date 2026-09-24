import { describe, expect, it } from 'vitest';
import { WARDENS } from '../../src/creatures/WardenDefs';
import { ITEMS } from '../../src/game/items';
import { RECIPES } from '../../src/game/recipes';
import { BELL_MEMORIES, BELL_WARDENS, DIALOGUE, EPILOGUE, NPCS, QUESTS } from '../../src/story/StoryData';
import { LANDMARKS } from '../../src/world/WorldLayout';

// The story is data; these checks keep every reference in it pointing at
// something that exists, so a typo can't strand a quest.

const itemIds = new Set(ITEMS.map((i) => i.id));
const landmarkIds = new Set(LANDMARKS.map((l) => l.id));
const npcIds = new Set(NPCS.map((n) => n.id));
const questIds = new Set(QUESTS.map((q) => q.id));
const structureTypes = new Set(['campfire', 'bedroll', 'workbench', 'chest', 'tanning_rack', 'cooking_pot', 'smelter', 'farm_plot', 'rain_collector', 'lantern_post', 'wood_foundation', 'wood_wall', 'wood_doorway', 'wood_floor', 'wood_roof', 'wood_stairs']);

describe('quests', () => {
  it('have unique ids', () => {
    expect(questIds.size).toBe(QUESTS.length);
  });

  it('only depend on quests that exist', () => {
    for (const q of QUESTS) for (const after of q.after) expect(questIds.has(after), `${q.id} after ${after}`).toBe(true);
  });

  it('point every step at something real', () => {
    for (const q of QUESTS) {
      for (const s of q.steps) {
        const where = `${q.id}.${s.id}`;
        if (s.kind === 'talk') expect(npcIds.has(s.target), where).toBe(true);
        if (s.kind === 'discover') expect(landmarkIds.has(s.target), where).toBe(true);
        if (s.kind === 'collect' || s.kind === 'craft') expect(itemIds.has(s.target), where).toBe(true);
        if (s.kind === 'place') expect(structureTypes.has(s.target), where).toBe(true);
      }
      for (const [item] of q.rewards) expect(itemIds.has(item), `${q.id} reward ${item}`).toBe(true);
    }
  });

  it('give every quest conversation its lines', () => {
    for (const q of QUESTS) {
      for (const s of q.steps) {
        if (s.kind !== 'talk') continue;
        expect(DIALOGUE[`${s.target}:${q.id}:${s.id}`], `${s.target}:${q.id}:${s.id}`).toBeDefined();
      }
    }
  });

  it('can all be reached from the first quest (no cycles, no orphans)', () => {
    const done = new Set<string>();
    let progress = true;
    while (progress) {
      progress = false;
      for (const q of QUESTS) {
        if (done.has(q.id)) continue;
        if (q.after.every((a) => done.has(a))) {
          done.add(q.id);
          progress = true;
        }
      }
    }
    expect([...questIds].filter((id) => !done.has(id))).toEqual([]);
  });
});

describe('bells and wardens', () => {
  it('pair each Bellstone with one Warden and a memory', () => {
    expect(WARDENS.length).toBe(5);
    for (const w of WARDENS) {
      expect(landmarkIds.has(w.bell), w.id).toBe(true);
      expect(BELL_WARDENS[w.bell]).toBe(w.flag);
      expect(BELL_MEMORIES[w.bell]?.length ?? 0, w.bell).toBeGreaterThan(2);
      expect(itemIds.has(w.trophy), w.trophy).toBe(true);
    }
    expect(new Set(WARDENS.map((w) => w.flag)).size).toBe(5);
    expect(new Set(WARDENS.map((w) => w.bell)).size).toBe(5);
  });

  it('have a quest to calm each Warden and ring its bell', () => {
    for (const w of WARDENS) {
      const quest = QUESTS.find((q) => q.steps.some((s) => s.kind === 'flag' && s.target === w.flag));
      expect(quest, w.id).toBeDefined();
      expect(quest?.steps.some((s) => s.target === `rung_${w.bell}`)).toBe(true);
    }
  });

  it('end with an epilogue', () => {
    expect(EPILOGUE.length).toBeGreaterThan(3);
    expect(QUESTS.find((q) => q.id === 'held_note')?.after.length).toBe(5);
  });
});

describe('recipes', () => {
  it('only use and make items that exist', () => {
    for (const r of RECIPES) {
      expect(itemIds.has(r.output), r.id).toBe(true);
      for (const [item] of r.inputs) expect(itemIds.has(item), `${r.id} needs ${item}`).toBe(true);
    }
  });
});
