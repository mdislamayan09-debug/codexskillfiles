import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/Events';
import { Inventory } from '../../src/game/Inventory';
import { QuestTracker } from '../../src/story/Quests';

function setup() {
  const events = new EventBus();
  const inventory = new Inventory(events);
  const quests = new QuestTracker(events, inventory);
  return { events, inventory, quests };
}

describe('quest tracker', () => {
  it('starts the first quest and tracks it', () => {
    const { quests } = setup();
    quests.refresh();
    expect(quests.isActive('waking')).toBe(true);
    expect(quests.tracked).toBe('waking');
    expect(quests.trackedObjective()?.text).toMatch(/Varga/);
  });

  it('advances on the right events and starts what follows', () => {
    const { events, quests } = setup();
    quests.refresh();
    quests.progress('talk', 'varga');
    expect(quests.isDone('waking')).toBe(true);
    expect(quests.isActive('shelter')).toBe(true);
    // Crafting the axe, then placing a fire and a bed.
    events.emit('crafted', { recipe: 'stone_axe', item: 'stone_axe', count: 1 });
    events.emit('crafted', { recipe: 'place', item: 'campfire', count: 1 });
    events.emit('crafted', { recipe: 'place', item: 'bedroll', count: 1 });
    expect(quests.currentStep('shelter')?.step.id).toBe('report');
  });

  it('ignores steps that do not match', () => {
    const { events, quests } = setup();
    quests.refresh();
    events.emit('crafted', { recipe: 'place', item: 'campfire', count: 1 });
    expect(quests.isActive('waking')).toBe(true);
  });

  it('catches up on collect steps already satisfied', () => {
    const { inventory, quests } = setup();
    inventory.add('echo_lantern', 1);
    quests.load({
      state: [
        ['waking', { status: 'done', step: 1, progress: 0 }],
        ['shelter', { status: 'done', step: 4, progress: 0 }],
        ['stones', { status: 'active', step: 3, progress: 0 }],
      ],
      flags: [],
      tracked: 'stones',
    });
    quests.progress('collect', 'echo_lantern');
    expect(quests.currentStep('stones')?.step.id).toBe('listen');
  });

  it('opens the Held Note only after all five Wardens', () => {
    const { quests } = setup();
    const done = (step: number) => ({ status: 'done' as const, step, progress: 0 });
    quests.load({
      state: [
        ['waking', done(1)],
        ['shelter', done(4)],
        ['stones', done(5)],
        ['needle', done(3)],
        ['grove_warden', done(4)],
        ['coast_warden', done(3)],
        ['cinder_warden', done(3)],
        ['frost_warden', done(3)],
      ],
      flags: [],
      tracked: null,
    });
    quests.refresh();
    expect(quests.isActive('held_note')).toBe(false);
    quests.load({ ...(quests.serialize() as object), state: [...(quests.serialize() as { state: [string, unknown][] }).state, ['fen_warden', done(3)]] } as never);
    quests.refresh();
    expect(quests.isActive('held_note')).toBe(true);
  });

  it('round-trips through a save', () => {
    const { events, inventory, quests } = setup();
    quests.refresh();
    quests.setFlag('read_mural');
    const saved = JSON.parse(JSON.stringify(quests.serialize()));
    const other = new QuestTracker(events, inventory);
    other.load(saved);
    expect(other.isActive('waking')).toBe(true);
    expect(other.flags.has('read_mural')).toBe(true);
  });
});
