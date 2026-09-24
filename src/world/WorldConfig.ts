// World-wide constants. Dependency-free: imported by the generator worker.

/** Bump whenever generation output changes so cached worlds are rebuilt. */
export const GEN_VERSION = 8;

export const WORLD_SEED = 0x57111d;

/** Playable heightfield covers [-WORLD_HALF, WORLD_HALF] on X (east) and Z (south). */
export const WORLD_SIZE = 2048;
export const WORLD_HALF = WORLD_SIZE / 2;

/** Height samples per side: 1 m spacing, sample i ↔ world coordinate i - WORLD_HALF. */
export const HEIGHT_RES = 2048;
/** Biome, mask and water fields: 2 m spacing. */
export const FIELD_RES = 1024;
export const FIELD_CELL = WORLD_SIZE / FIELD_RES;

export const SEA_LEVEL = 0;
/** Radius of the Veil (mist wall) that bounds the playable land. */
export const VEIL_RADIUS = 980;
/** Terrain never exceeds this; used for bounds and shadow camera setup. */
export const MAX_TERRAIN_HEIGHT = 360;
export const MIN_TERRAIN_HEIGHT = -45;

export const BIOME = {
  Greensward: 0,
  Hollowpine: 1,
  Glasswood: 2,
  Coast: 3,
  Cinderreach: 4,
  Frostveil: 5,
  Drownfen: 6,
  Rim: 7,
} as const;

export type BiomeId = (typeof BIOME)[keyof typeof BIOME];
export const BIOME_COUNT = 8;

export interface BiomeInfo {
  id: BiomeId;
  key: string;
  name: string;
  subtitle: string;
  /** Baseline felt temperature at noon in °C before altitude/weather/time. */
  temperature: number;
  /** Chance weights for weather kinds in this biome. */
  weather: { clear: number; cloudy: number; fog: number; rain: number; storm: number; snow: number; ash: number };
  /** Music mode used by the generative score. */
  musicMode: 'lydian' | 'dorian' | 'wholetone' | 'mixolydian' | 'phrygian' | 'aeolian' | 'locrian' | 'ionian';
}

export const BIOMES: readonly BiomeInfo[] = [
  {
    id: BIOME.Greensward,
    key: 'greensward',
    name: 'The Greensward',
    subtitle: 'Where the Meridian fell',
    temperature: 17,
    weather: { clear: 5, cloudy: 3, fog: 1, rain: 2, storm: 0.6, snow: 0, ash: 0 },
    musicMode: 'lydian',
  },
  {
    id: BIOME.Hollowpine,
    key: 'hollowpine',
    name: 'Hollowpine',
    subtitle: 'The forest that remembers',
    temperature: 12,
    weather: { clear: 2, cloudy: 3, fog: 4, rain: 3, storm: 0.8, snow: 0, ash: 0 },
    musicMode: 'dorian',
  },
  {
    id: BIOME.Glasswood,
    key: 'glasswood',
    name: 'The Glasswood',
    subtitle: 'Where the song still rings',
    temperature: 15,
    weather: { clear: 4, cloudy: 2, fog: 2, rain: 1, storm: 0.3, snow: 0, ash: 0 },
    musicMode: 'wholetone',
  },
  {
    id: BIOME.Coast,
    key: 'coast',
    name: 'Saltglass Coast',
    subtitle: 'Wrecks of other ages',
    temperature: 14,
    weather: { clear: 3, cloudy: 3, fog: 3, rain: 2, storm: 1.4, snow: 0, ash: 0 },
    musicMode: 'mixolydian',
  },
  {
    id: BIOME.Cinderreach,
    key: 'cinderreach',
    name: 'Cinderreach',
    subtitle: 'The forge that never cooled',
    temperature: 31,
    weather: { clear: 3, cloudy: 2, fog: 0.5, rain: 0.5, storm: 0.6, snow: 0, ash: 3 },
    musicMode: 'phrygian',
  },
  {
    id: BIOME.Frostveil,
    key: 'frostveil',
    name: 'Frostveil Peaks',
    subtitle: 'Winter without end',
    temperature: -6,
    weather: { clear: 3, cloudy: 3, fog: 2, rain: 0, storm: 0.4, snow: 4, ash: 0 },
    musicMode: 'aeolian',
  },
  {
    id: BIOME.Drownfen,
    key: 'drownfen',
    name: 'The Drownfen',
    subtitle: 'The singing mire',
    temperature: 19,
    weather: { clear: 1.5, cloudy: 3, fog: 5, rain: 3, storm: 0.8, snow: 0, ash: 0 },
    musicMode: 'locrian',
  },
  {
    id: BIOME.Rim,
    key: 'rim',
    name: 'The Rim',
    subtitle: 'Edge of the Stillheart',
    temperature: 13,
    weather: { clear: 4, cloudy: 3, fog: 1.5, rain: 1.5, storm: 0.7, snow: 0, ash: 0 },
    musicMode: 'ionian',
  },
];

export function worldToHeightIndex(value: number): number {
  return value + WORLD_HALF;
}

export function isInsideWorld(x: number, z: number, margin = 0): boolean {
  return x > -WORLD_HALF + margin && x < WORLD_HALF - margin && z > -WORLD_HALF + margin && z < WORLD_HALF - margin;
}
