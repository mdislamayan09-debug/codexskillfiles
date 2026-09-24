import type { EventBus } from '../core/Events';
import type { Inventory } from '../game/Inventory';
import { itemDef } from '../game/items';
import { QUESTS, type QuestDef, type QuestStep } from './StoryData';

// Quest state machine. Progress arrives as game events (discoveries,
// crafting, placing, collecting, kills, story flags, conversations); the
// tracker advances the active step, pays rewards, starts follow-up quests
// and exposes the tracked objective to the HUD and compass.

interface QuestState {
  status: 'active' | 'done';
  step: number;
  progress: number;
}

export class QuestTracker {
  private readonly state = new Map<string, QuestState>();
  readonly flags = new Set<string>();
  readonly lore: string[] = [];
  tracked: string | null = null;
  /** Lets the game report steps that are already true (placed earlier, seen before). */
  isSatisfied: ((step: QuestStep) => boolean) | null = null;

  constructor(
    private readonly events: EventBus,
    private readonly inventory: Inventory,
  ) {
    events.on('discovered', ({ id }) => this.progress('discover', id));
    events.on('crafted', ({ item, recipe }) => {
      if (recipe === 'place') this.progress('place', item);
      else this.progress('craft', item);
    });
    events.on('itemAdded', ({ id }) => this.progress('collect', id));
  }

  /** Start any quest whose prerequisites are complete. */
  refresh(): void {
    for (const q of QUESTS) {
      if (this.state.has(q.id)) continue;
      if (!q.auto) continue;
      if (q.startFlag && !this.flags.has(q.startFlag)) continue;
      if (q.after.every((id) => this.state.get(id)?.status === 'done')) this.start(q);
    }
  }

  private start(q: QuestDef): void {
    this.state.set(q.id, { status: 'active', step: 0, progress: 0 });
    if (!this.tracked || (q.main && !QUESTS.find((d) => d.id === this.tracked)?.main)) this.tracked = q.id;
    this.events.emit('notify', { text: `${q.main ? 'Main quest' : 'Quest'} · ${q.title}`, icon: 'quest', tone: 'info' });
    // Some steps may already be satisfied (items in the pack, places seen).
    this.checkCollect(q);
  }

  private checkCollect(q: QuestDef): void {
    const s = this.state.get(q.id);
    if (!s || s.status !== 'active') return;
    const step = q.steps[s.step];
    if (!step) return;
    if (step.kind === 'collect' && this.inventory.has(step.target, step.count ?? 1)) this.advance(q);
    else if (step.kind !== 'talk' && step.kind !== 'kill' && this.isSatisfied?.(step)) this.advance(q);
  }

  /** Report something that happened; advances matching active steps. */
  progress(kind: QuestStep['kind'], target: string, amount = 1): void {
    for (const q of QUESTS) {
      const s = this.state.get(q.id);
      if (!s || s.status !== 'active') continue;
      const step = q.steps[s.step];
      if (!step || step.kind !== kind || step.target !== target) continue;
      if (kind === 'collect') {
        if (this.inventory.has(target, step.count ?? 1)) this.advance(q);
        continue;
      }
      s.progress += amount;
      if (s.progress >= (step.count ?? 1)) this.advance(q);
      else this.events.emit('notify', { text: `${step.text} (${s.progress}/${step.count})`, icon: 'quest', tone: 'info' });
    }
  }

  private advance(q: QuestDef): void {
    const s = this.state.get(q.id) as QuestState;
    s.step += 1;
    s.progress = 0;
    if (s.step >= q.steps.length) {
      s.status = 'done';
      for (const [item, n] of q.rewards) this.inventory.add(item, n);
      this.events.emit('notify', { text: `Completed · ${q.title}`, icon: 'quest', tone: 'good' });
      this.events.emit('discovered', { id: `quest:${q.id}`, name: q.title, kind: 'quest' });
      if (this.tracked === q.id) this.tracked = null;
      this.refresh();
      if (!this.tracked) this.tracked = this.activeQuests()[0]?.id ?? null;
      return;
    }
    const next = q.steps[s.step];
    this.events.emit('notify', { text: next.text, icon: 'quest', tone: 'info' });
    this.checkCollect(q);
  }

  setFlag(name: string): void {
    if (this.flags.has(name)) return;
    this.flags.add(name);
    this.progress('flag', name);
    this.refresh();
  }

  /** The quest step (if any) that a conversation with `npc` would advance. */
  talkStepFor(npc: string): { quest: QuestDef; step: QuestStep } | null {
    for (const q of QUESTS) {
      const s = this.state.get(q.id);
      if (!s || s.status !== 'active') continue;
      const step = q.steps[s.step];
      if (step && step.kind === 'talk' && step.target === npc) return { quest: q, step };
    }
    return null;
  }

  isDone(id: string): boolean {
    return this.state.get(id)?.status === 'done';
  }

  isActive(id: string): boolean {
    return this.state.get(id)?.status === 'active';
  }

  activeQuests(): QuestDef[] {
    return QUESTS.filter((q) => this.state.get(q.id)?.status === 'active');
  }

  doneQuests(): QuestDef[] {
    return QUESTS.filter((q) => this.state.get(q.id)?.status === 'done');
  }

  currentStep(id: string): { step: QuestStep; index: number; progress: number } | null {
    const q = QUESTS.find((d) => d.id === id);
    const s = this.state.get(id);
    if (!q || !s || s.status !== 'active') return null;
    return { step: q.steps[s.step], index: s.step, progress: s.progress };
  }

  /** Objective text for the HUD tracker. */
  trackedObjective(): { title: string; text: string; hint?: string } | null {
    const id = this.tracked;
    if (!id) return null;
    const q = QUESTS.find((d) => d.id === id);
    const cur = this.currentStep(id);
    if (!q || !cur) return null;
    const count = cur.step.count ? ` (${cur.progress}/${cur.step.count})` : '';
    let hint = cur.step.hint;
    if (cur.step.kind === 'craft' || cur.step.kind === 'collect') {
      try {
        hint = hint ?? `You need: ${itemDef(cur.step.target).name}`;
      } catch {
        // Not an item.
      }
    }
    return { title: q.title, text: `${cur.step.text}${count}`, hint };
  }

  serialize(): unknown {
    return { state: [...this.state.entries()], flags: [...this.flags], tracked: this.tracked, lore: this.lore };
  }

  load(data: unknown): void {
    const d = data as { state: [string, QuestState][]; flags: string[]; tracked: string | null; lore?: string[] };
    this.state.clear();
    for (const [id, s] of d.state ?? []) this.state.set(id, s);
    this.flags.clear();
    for (const f of d.flags ?? []) this.flags.add(f);
    this.tracked = d.tracked ?? null;
    this.lore.length = 0;
    for (const l of d.lore ?? []) this.lore.push(l);
  }

  reset(): void {
    this.state.clear();
    this.flags.clear();
    this.tracked = null;
    this.lore.length = 0;
  }
}
