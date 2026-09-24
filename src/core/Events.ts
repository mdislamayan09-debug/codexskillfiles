// Typed publish/subscribe bus. Systems announce facts ("item gathered",
// "landmark discovered") without knowing who listens: HUD, audio, journal,
// quests and achievements all subscribe independently.

export interface GameEvents {
  notify: { text: string; icon?: string; tone?: 'info' | 'good' | 'warn' | 'bad' };
  itemAdded: { id: string; count: number; total: number };
  itemRemoved: { id: string; count: number; total: number };
  inventoryChanged: Record<string, never>;
  gathered: { resource: string; x: number; y: number; z: number };
  crafted: { recipe: string; item: string; count: number };
  damage: { amount: number; source: string; x?: number; z?: number };
  healed: { amount: number };
  died: { cause: string };
  respawned: { x: number; z: number };
  landed: { speed: number; height: number };
  jumped: Record<string, never>;
  footstep: { surface: string; speed: number; left: boolean };
  splash: { strength: number; x: number; y: number; z: number };
  enterWater: { depth: number };
  exitWater: Record<string, never>;
  climbStart: Record<string, never>;
  climbEnd: Record<string, never>;
  discovered: { id: string; name: string; kind: string };
  biomeChanged: { biome: number; name: string };
  swing: { tool: string };
  consumed: { kind: 'eat' | 'drink' };
  hit: { target: string; material: string; x: number; y: number; z: number };
  stateChanged: { state: string };
  subtitle: { speaker: string; text: string; duration: number };
  settingsChanged: { key: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<unknown>);
    return () => set?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        // One broken listener must never break the frame.
        console.error(`Event handler for "${String(type)}" failed`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
