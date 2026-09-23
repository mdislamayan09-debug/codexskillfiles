// Deterministic randomness. ALL gameplay and world randomness flows through
// these helpers (never Math.random) so worlds, saves, screenshots and bot
// playtests are reproducible.

export type Rng = () => number;

/** mulberry32: fast 32-bit seeded generator returning [0, 1). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of two ints → uint32. Stable across platforms. */
export function hash2i(x: number, y: number, seed = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x27d4eb2d);
  return (h ^ (h >>> 15)) >>> 0;
}

export function hash3i(x: number, y: number, z: number, seed = 0): number {
  return hash2i(hash2i(x, y, seed), z, seed + 1);
}

/** Hash → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  return hash2i(x, y, seed) / 4294967296;
}

/** String → uint32 (FNV-1a), used to derive stable seeds from ids. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rangeRng(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function intRng(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
