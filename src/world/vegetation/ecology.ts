// Plant ecology shared by the world generator (forest canopy mask for distant
// terrain) and the runtime scatter (actual trees). Dependency-light so the
// worker can import it.

import { smoothstep } from '../../core/math';
import type { Simplex2 } from '../../core/noise';
import { BIOME } from '../WorldConfig';

export interface SpeciesWeight {
  species: string;
  weight: number;
}

export interface BiomeFlora {
  /** Trees per 100 m² at full density. */
  treeDensity: number;
  trees: SpeciesWeight[];
  /** Shrubs per 100 m². */
  shrubDensity: number;
  shrubs: SpeciesWeight[];
  /** Noise threshold shaping groves (higher = more open land). */
  openness: number;
  /** Altitude above which trees thin out (treeline). */
  treeline: number;
}

export const BIOME_FLORA: Record<number, BiomeFlora> = {
  [BIOME.Greensward]: {
    treeDensity: 1.6,
    trees: [
      { species: 'birch', weight: 6 },
      { species: 'oak', weight: 2 },
      { species: 'pine', weight: 0.6 },
    ],
    shrubDensity: 1.2,
    shrubs: [{ species: 'shrub', weight: 1 }],
    openness: 0.62,
    treeline: 400,
  },
  [BIOME.Hollowpine]: {
    treeDensity: 4.2,
    trees: [
      { species: 'spruce', weight: 6 },
      { species: 'pine', weight: 2.5 },
      { species: 'birch', weight: 0.6 },
      { species: 'deadwood', weight: 0.25 },
    ],
    shrubDensity: 1.4,
    shrubs: [{ species: 'shrub', weight: 1 }],
    openness: 0.18,
    treeline: 400,
  },
  [BIOME.Glasswood]: {
    treeDensity: 2.2,
    trees: [
      { species: 'glasstree', weight: 5 },
      { species: 'birch', weight: 2 },
    ],
    shrubDensity: 0.8,
    shrubs: [{ species: 'shrub', weight: 1 }],
    openness: 0.42,
    treeline: 400,
  },
  [BIOME.Coast]: {
    treeDensity: 0.9,
    trees: [
      { species: 'pine', weight: 5 },
      { species: 'deadwood', weight: 0.6 },
    ],
    shrubDensity: 2.2,
    shrubs: [
      { species: 'heath', weight: 3 },
      { species: 'shrub', weight: 1 },
    ],
    openness: 0.6,
    treeline: 400,
  },
  [BIOME.Cinderreach]: {
    treeDensity: 0.35,
    trees: [{ species: 'deadwood', weight: 1 }],
    shrubDensity: 0.8,
    shrubs: [{ species: 'heath', weight: 1 }],
    openness: 0.55,
    treeline: 140,
  },
  [BIOME.Frostveil]: {
    treeDensity: 2.4,
    trees: [
      { species: 'spruce', weight: 7 },
      { species: 'deadwood', weight: 0.4 },
    ],
    shrubDensity: 1.0,
    shrubs: [{ species: 'heath', weight: 1 }],
    openness: 0.4,
    treeline: 175,
  },
  [BIOME.Drownfen]: {
    treeDensity: 2.0,
    trees: [
      { species: 'swampcypress', weight: 5 },
      { species: 'willow', weight: 2.5 },
      { species: 'deadwood', weight: 0.8 },
    ],
    shrubDensity: 1.6,
    shrubs: [{ species: 'shrub', weight: 1 }],
    openness: 0.35,
    treeline: 400,
  },
  [BIOME.Rim]: {
    treeDensity: 0.6,
    trees: [
      { species: 'pine', weight: 3 },
      { species: 'birch', weight: 1 },
    ],
    shrubDensity: 1.0,
    shrubs: [{ species: 'heath', weight: 1 }],
    openness: 0.58,
    treeline: 400,
  },
};

/** Forest density in [0, 1] from blended biome weights (length BIOME_COUNT). */
export function forestDensity(noise: Simplex2, x: number, z: number, height: number, biomeWeights: ArrayLike<number>): number {
  const n = noise.fbm(x / 170, z / 170, 4) * 0.65 + noise.noise(x / 55, z / 55) * 0.35;
  const v = n * 0.5 + 0.5;
  let density = 0;
  for (let b = 0; b < biomeWeights.length; b += 1) {
    const w = biomeWeights[b];
    if (w < 0.01) continue;
    const flora = BIOME_FLORA[b];
    const grove = smoothstep(flora.openness - 0.12, flora.openness + 0.1, v);
    const tree = 1 - smoothstep(flora.treeline - 25, flora.treeline + 10, height);
    density += w * grove * tree * Math.min(1, flora.treeDensity / 4);
  }
  return density;
}
