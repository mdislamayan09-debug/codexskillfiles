import { beforeEach, describe, expect, it } from 'vitest';
import { SaveSystem } from '../../src/game/SaveSystem';

// localStorage / sessionStorage stand-ins for node.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v));
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
});

describe('save system', () => {
  it('saves every participant and loads them back', () => {
    const saves = new SaveSystem();
    let hp = 73;
    let place = 'camp';
    saves.register('hp', { save: () => hp, load: (d) => (hp = d as number) });
    saves.register('place', { save: () => place, load: (d) => (place = d as string) });
    expect(saves.save('auto', { day: 3, hours: 9, location: 'The Greensward', playtime: 600 })).toBe(true);
    hp = 1;
    place = 'nowhere';
    const meta = saves.load('auto');
    expect(meta?.day).toBe(3);
    expect(hp).toBe(73);
    expect(place).toBe('camp');
  });

  it('keeps going when one participant fails', () => {
    const saves = new SaveSystem();
    let ok = 0;
    saves.register('broken', {
      save: () => {
        throw new Error('boom');
      },
      load: () => undefined,
    });
    saves.register('fine', { save: () => 5, load: (d) => (ok = d as number) });
    saves.save('auto', { day: 1, hours: 8, location: 'x', playtime: 1 });
    expect(saves.load('auto')).not.toBeNull();
    expect(ok).toBe(5);
  });

  it('reads save details without loading', () => {
    const saves = new SaveSystem();
    saves.save('auto', { day: 7, hours: 21, location: 'Hollowpine', playtime: 3600 });
    expect(saves.meta('auto')?.location).toBe('Hollowpine');
    expect(saves.meta('missing')).toBeNull();
  });

  it('flags one resume across a reload', () => {
    SaveSystem.markResume();
    expect(SaveSystem.consumeResume()).toBe(true);
    expect(SaveSystem.consumeResume()).toBe(false);
  });
});
