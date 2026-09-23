// Deterministic world generation. Pure function of WORLD_SEED + layout data.
// Runs in a Web Worker in the game and directly in Node for previews/tests.

import { clamp, clamp01, lerp, pointSegmentDistance, smoothstep, terrace } from '../../core/math';
import { Simplex2 } from '../../core/noise';
import {
  BIOME,
  BIOME_COUNT,
  FIELD_CELL,
  FIELD_RES,
  GEN_VERSION,
  HEIGHT_RES,
  WORLD_HALF,
  WORLD_SEED,
  type BiomeId,
} from '../WorldConfig';
import {
  BEACH_BEARINGS,
  BIOME_SEEDS,
  COAST_PROFILE,
  CRATER_DESCENT_BEARING,
  HEADLANDS,
  LAKES,
  LANDMARKS,
  RIM_RADIUS,
  RIVERS,
  SEA_STACKS,
  TRAILS,
  VOLCANO,
  landmarkById,
  type LakeDef,
  type RiverDef,
} from '../WorldLayout';
import { erode } from './erosion';

export interface RiverData {
  id: string;
  name: string;
  warm: boolean;
  fromLake?: string;
  toLake?: string;
  /** Interleaved per point: x, z, surfaceY, halfWidth, distanceAlong, fall(0..1). */
  points: Float32Array;
  count: number;
}

export interface LakeData {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  level: number;
  depth: number;
  frozen: boolean;
  hot: boolean;
  /** Radius multiplier sampled at LAKE_SHAPE_SAMPLES angles. */
  shape: Float32Array;
}

export interface LandmarkPlacement {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface WorldFields {
  version: number;
  /** HEIGHT_RES² terrain heights in meters. */
  heights: Float32Array;
  /** HEIGHT_RES² × 4: normal xyz (0..255) + ambient occlusion. */
  normals: Uint8Array;
  /** FIELD_RES² × 8 biome weights (0..255, sum ≈ 255). */
  biome: Uint8Array;
  /** FIELD_RES² × 8: path, sand, wet, cave, deposit, carve, forest, snow. */
  masks: Uint8Array;
  /** FIELD_RES² water surface height (sea level where no lake/river). */
  water: Float32Array;
  rivers: RiverData[];
  lakes: LakeData[];
  landmarks: LandmarkPlacement[];
  stats: Record<string, number>;
}

export const MASK = {
  path: 0,
  sand: 1,
  wet: 2,
  cave: 3,
  deposit: 4,
  carve: 5,
  forest: 6,
  snow: 7,
} as const;
export const MASK_CHANNELS = 8;
export const LAKE_SHAPE_SAMPLES = 64;

export type ProgressFn = (stage: string, fraction: number) => void;

const DEG = Math.PI / 180;

/** Compass bearing in degrees (0 = north/−Z, 90 = east/+X). */
export function bearingOf(x: number, z: number): number {
  const b = Math.atan2(x, -z) / DEG;
  return b < 0 ? b + 360 : b;
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

class Noises {
  readonly base = new Simplex2(WORLD_SEED);
  readonly detail = new Simplex2(WORLD_SEED + 11);
  readonly warp = new Simplex2(WORLD_SEED + 23);
  readonly ridge = new Simplex2(WORLD_SEED + 37);
  readonly coast = new Simplex2(WORLD_SEED + 41);
  readonly misc = new Simplex2(WORLD_SEED + 53);
}

// ---------------------------------------------------------------------------
// Coastline

function profileRadius(bearing: number): number {
  for (let i = 0; i < COAST_PROFILE.length - 1; i += 1) {
    const [b0, r0] = COAST_PROFILE[i];
    const [b1, r1] = COAST_PROFILE[i + 1];
    if (bearing >= b0 && bearing <= b1) {
      const t = (bearing - b0) / (b1 - b0);
      const s = t * t * (3 - 2 * t);
      return r0 + (r1 - r0) * s;
    }
  }
  return COAST_PROFILE[0][1];
}

const COAST_LUT_SIZE = 3600;

class CoastTables {
  readonly radius = new Float32Array(COAST_LUT_SIZE + 1);
  readonly beach = new Float32Array(COAST_LUT_SIZE + 1);
  constructor(n: Noises) {
    for (let s = 0; s <= COAST_LUT_SIZE; s += 1) {
      const bearing = (s / COAST_LUT_SIZE) * 360;
      this.radius[s] = coastRadius(n, bearing);
      this.beach[s] = beachFactor(n, bearing);
    }
  }
  lookup(table: Float32Array, bearing: number): number {
    const f = (bearing / 360) * COAST_LUT_SIZE;
    const i = Math.min(COAST_LUT_SIZE - 1, Math.max(0, f | 0));
    const t = f - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  }
}

function coastRadius(n: Noises, bearing: number): number {
  const a = bearing * DEG;
  const cx = Math.sin(a);
  const cz = Math.cos(a);
  let r = profileRadius(bearing);
  r += 48 * n.coast.fbm(cx * 1.7 + 5, cz * 1.7 - 3, 4);
  r += 22 * n.coast.fbm(cx * 5.5 - 2, cz * 5.5 + 7, 3);
  for (const h of HEADLANDS) {
    const d = angularDistance(bearing, h.bearing) / h.width;
    r += h.extend * Math.exp(-d * d);
  }
  return r;
}

function beachFactor(n: Noises, bearing: number): number {
  let beach = 0;
  for (const [b0, b1] of BEACH_BEARINGS) {
    const inside = Math.min(smoothstep(b0 - 3, b0 + 2, bearing), 1 - smoothstep(b1 - 2, b1 + 3, bearing));
    beach = Math.max(beach, inside);
  }
  const a = bearing * DEG;
  // Small coves appear in cliff sections too.
  const cove = smoothstep(0.45, 0.7, n.coast.noise(Math.sin(a) * 7 + 9, Math.cos(a) * 7 - 2));
  return Math.max(beach, cove);
}

// ---------------------------------------------------------------------------
// Biomes

function computeBiomeField(n: Noises): Float32Array {
  // Computed at half the field resolution (4 m) — transitions are ~100 m wide.
  const res = FIELD_RES / 2;
  const cell = FIELD_CELL * 2;
  const low = new Float32Array(res * res * BIOME_COUNT);
  const temperature = 36;
  const dists = new Float32Array(BIOME_SEEDS.length);
  const acc = new Float32Array(BIOME_COUNT);
  for (let j = 0; j < res; j += 1) {
    const z = -WORLD_HALF + (j + 0.5) * cell;
    for (let i = 0; i < res; i += 1) {
      const x = -WORLD_HALF + (i + 0.5) * cell;
      const wx = x + 115 * n.warp.fbm(x / 430 + 3.3, z / 430 - 1.1, 3) + 25 * n.warp.noise(x / 90, z / 90);
      const wz = z + 115 * n.warp.fbm(x / 430 - 7.9, z / 430 + 4.6, 3) + 25 * n.warp.noise(x / 90 + 13, z / 90 - 5);
      let minD = Infinity;
      for (let s = 0; s < BIOME_SEEDS.length; s += 1) {
        const seed = BIOME_SEEDS[s];
        const dx = wx - seed.x;
        const dz = wz - seed.z;
        const d = Math.sqrt(dx * dx + dz * dz) - seed.bias;
        dists[s] = d;
        if (d < minD) minD = d;
      }
      acc.fill(0);
      for (let s = 0; s < BIOME_SEEDS.length; s += 1) {
        acc[BIOME_SEEDS[s].biome] += Math.exp(-(dists[s] - minD) / temperature);
      }
      // The Rim is radial around the crater, with a ragged edge.
      const r = Math.sqrt(x * x + z * z) + 30 * n.warp.fbm(x / 160, z / 160, 3);
      const rim = smoothstep(RIM_RADIUS + 25, RIM_RADIUS - 45, r);
      let sum = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        if (b === BIOME.Rim) continue;
        sum += acc[b];
      }
      const base = (j * res + i) * BIOME_COUNT;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        low[base + b] = b === BIOME.Rim ? rim : ((acc[b] / sum) * (1 - rim));
      }
    }
  }
  // Bilinear upsample (cell-centered grids) to FIELD_RES.
  const out = new Float32Array(FIELD_RES * FIELD_RES * BIOME_COUNT);
  for (let j = 0; j < FIELD_RES; j += 1) {
    const fz = clamp((j + 0.5) / 2 - 0.5, 0, res - 1.001);
    const lj = fz | 0;
    const tz = fz - lj;
    for (let i = 0; i < FIELD_RES; i += 1) {
      const fx = clamp((i + 0.5) / 2 - 0.5, 0, res - 1.001);
      const li = fx | 0;
      const tx = fx - li;
      const a = (lj * res + li) * BIOME_COUNT;
      const b = a + BIOME_COUNT;
      const c = a + res * BIOME_COUNT;
      const d = c + BIOME_COUNT;
      const o = (j * FIELD_RES + i) * BIOME_COUNT;
      for (let k = 0; k < BIOME_COUNT; k += 1) {
        out[o + k] = (low[a + k] * (1 - tx) + low[b + k] * tx) * (1 - tz) + (low[c + k] * (1 - tx) + low[d + k] * tx) * tz;
      }
    }
  }
  return out;
}

/** Bilinear sample of the corner-aligned coarse grid at world (x, z). */
function sampleCoarse(grid: Float32Array, x: number, z: number): number {
  const res = HEIGHT_RES / 2;
  const fx = clamp((x + WORLD_HALF) / 2, 0, res - 1.001);
  const fz = clamp((z + WORLD_HALF) / 2, 0, res - 1.001);
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * res + i;
  return (grid[k] * (1 - tx) + grid[k + 1] * tx) * (1 - tz) + (grid[k + res] * (1 - tx) + grid[k + res + 1] * tx) * tz;
}

/** Bilinear sample of a FIELD_RES × channels float field at world (x, z). */
function sampleFieldF(field: Float32Array, channels: number, channel: number, x: number, z: number): number {
  const fx = clamp((x + WORLD_HALF) / FIELD_CELL - 0.5, 0, FIELD_RES - 1.001);
  const fz = clamp((z + WORLD_HALF) / FIELD_CELL - 0.5, 0, FIELD_RES - 1.001);
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const a = field[(j * FIELD_RES + i) * channels + channel];
  const b = field[(j * FIELD_RES + i + 1) * channels + channel];
  const c = field[((j + 1) * FIELD_RES + i) * channels + channel];
  const d = field[((j + 1) * FIELD_RES + i + 1) * channels + channel];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ---------------------------------------------------------------------------
// Heights

function rimHeight(n: Noises, x: number, z: number): number {
  const r0 = Math.sqrt(x * x + z * z);
  const bearingRad = Math.atan2(x, -z);
  const bx = Math.sin(bearingRad);
  const bz = Math.cos(bearingRad);
  const r = r0 + 16 * n.misc.fbm(x / 95, z / 95, 3);
  const floor = 14 + 3.2 * n.detail.fbm(x / 55, z / 55, 3) + 11 * Math.exp(-(r0 / 46) * (r0 / 46));
  // The crest rises and falls around the ring; two collapsed passes lead in.
  let crest = 74 + 26 * n.base.fbm(bx * 1.6 + 4, bz * 1.6 - 2, 3) + 6 * n.detail.fbm(x / 60 + 3, z / 60, 3);
  const bearingDeg = bearingRad / DEG < 0 ? bearingRad / DEG + 360 : bearingRad / DEG;
  crest -= 30 * Math.exp(-Math.pow(angularDistance(bearingDeg, 305) / 11, 2));
  crest -= 22 * Math.exp(-Math.pow(angularDistance(bearingDeg, 120) / 9, 2));
  const wallT = Math.pow(smoothstep(148, 244, r), 1.6);
  // Broken rocky ledges on the inner wall.
  const ledgeNoise = n.ridge.ridged(x / 48, z / 48, 3);
  const ledges = terrace(clamp01(wallT + 0.12 * (ledgeNoise - 0.5)), 5, 0.62);
  let inner = floor + (crest - floor) * lerp(wallT, ledges, 0.3 * ledgeNoise);
  // The Descent: a gentler ramp cut into the south-south-west wall.
  const bearing = bearingOf(x, z);
  const sector = Math.exp(-Math.pow(angularDistance(bearing, CRATER_DESCENT_BEARING) / 9, 2));
  const ramp = floor + (crest - floor) * smoothstep(110, 262, r);
  inner = lerp(inner, ramp, sector);
  // Ejecta blanket: radial ribs fanning out from the crater.
  const ribs = n.ridge.ridged(bx * 3.2 + r / 140, bz * 3.2 - r / 170, 3);
  const outer = crest - (crest - 34) * smoothstep(250, 400, r) + 5 * n.detail.fbm(x / 60, z / 60, 3) + 7 * (ribs - 0.5) * smoothstep(250, 300, r);
  return lerp(inner, outer, smoothstep(238, 258, r));
}

function volcanoProfile(n: Noises, x: number, z: number): { cone: number; mask: number } {
  const dx = x - VOLCANO.x;
  const dz = z - VOLCANO.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > VOLCANO.radius) return { cone: 0, mask: 0 };
  const angle = Math.atan2(dz, dx);
  // Lava lobes and gullies: low-frequency, warped, not a starburst.
  const lobes = n.ridge.fbm(Math.cos(angle) * 1.8 + dist / 230, Math.sin(angle) * 1.8 - dist / 290, 4);
  const t = 1 - dist / VOLCANO.radius + 0.06 * lobes;
  const cone = VOLCANO.height * Math.pow(clamp01(t), 1.45) * (1 + 0.07 * lobes);
  const caldera = VOLCANO.calderaDepth * (1 - smoothstep(18, VOLCANO.calderaRadius, dist));
  return { cone: cone - caldera, mask: smoothstep(0, 0.35, t) };
}

function biomeHeight(n: Noises, biome: number, x: number, z: number): number {
  switch (biome) {
    case BIOME.Greensward: {
      let h = 19 + 12 * n.base.fbm(x / 310, z / 310, 4) + 4.5 * n.detail.fbm(x / 85, z / 85, 3);
      const tor = n.ridge.noise(x / 170 + 3.1, z / 170 - 7.4);
      if (tor > 0.48) h += terrace((tor - 0.48) / 0.52, 3, 0.45) * 15;
      return h;
    }
    case BIOME.Hollowpine: {
      let h = 46 + 27 * n.base.fbm(x / 380 + 11, z / 380 - 4, 5);
      const v = 1 - Math.abs(n.warp.noise(x / 560, z / 560));
      h -= 20 * v * v * v * v;
      h += 10 * (n.ridge.ridged(x / 170, z / 170, 4) - 0.45);
      return h;
    }
    case BIOME.Glasswood: {
      let h = 31 + 12 * n.base.fbm(x / 270 - 2, z / 270 + 5, 4) + 3 * n.detail.fbm(x / 60, z / 60, 2);
      const mx = x + 30 * n.detail.noise(x / 70, z / 70);
      const mz = z + 30 * n.detail.noise(x / 70 + 9, z / 70 - 4);
      const mesa = n.warp.fbm(mx / 230 + 9, mz / 230 + 2, 3);
      h += smoothstep(0.12, 0.3, mesa) * (11 + 5 * n.misc.noise(x / 120, z / 120));
      return h;
    }
    case BIOME.Coast:
      return 26 + 10 * n.base.fbm(x / 250 + 4, z / 250 - 9, 4) + 4 * n.detail.fbm(x / 70, z / 70, 3);
    case BIOME.Cinderreach: {
      const t = clamp01(0.5 + 0.55 * n.base.fbm(x / 300 - 5, z / 300 + 8, 4));
      const plains = 42 + 58 * terrace(t, 6, 0.55) + 5 * n.detail.fbm(x / 65, z / 65, 3);
      const volcano = volcanoProfile(n, x, z);
      return plains * (1 - 0.55 * volcano.mask) + volcano.cone;
    }
    case BIOME.Frostveil: {
      const ridged = n.ridge.ridged(x / 460 + 2, z / 460 - 6, 6);
      return 86 + 215 * Math.pow(ridged, 1.45) + 22 * n.base.fbm(x / 150, z / 150, 4);
    }
    case BIOME.Drownfen: {
      let h = 0.3 + 2.0 * n.base.fbm(x / 115, z / 115, 4) + 1.3 * n.detail.fbm(x / 420, z / 420, 2) + 0.9 * n.misc.noise(x / 38, z / 38);
      const channel = 1 - Math.abs(n.warp.noise(x / 190 + 1.7, z / 190 - 3.3));
      h -= 3.2 * Math.pow(channel, 5);
      return h;
    }
    case BIOME.Rim:
      return rimHeight(n, x, z);
    default:
      return 20;
  }
}

function applyCoast(n: Noises, coast: CoastTables, x: number, z: number, landHeight: number): number {
  const r = Math.sqrt(x * x + z * z);
  if (r < 420) return landHeight;
  const bearing = bearingOf(x, z);
  const R = coast.lookup(coast.radius, bearing);
  // 2D noise lets bays, peninsulas and islets break the radial symmetry.
  const dc = R - r + 58 * n.coast.fbm(x / 270 + 1.3, z / 270 - 8.1, 4) + 14 * n.coast.noise(x / 55, z / 55);
  if (dc > 160) return landHeight;
  const beach = coast.lookup(coast.beach, bearing);
  const cliff = dc > 0 ? lerp(1.3, landHeight, Math.pow(smoothstep(0, 17, dc), 0.42)) : 1.3;
  const beachH = dc > 0 ? lerp(0.35 + dc * 0.03, landHeight, smoothstep(22, 150, dc)) : 0.35;
  const land = lerp(cliff, beachH, beach);
  const depth = Math.min(38, Math.pow(Math.max(0, -dc), 0.85) * 0.34);
  const seabed = -1.2 - depth + 1.6 * n.detail.noise(x / 40, z / 40);
  return lerp(seabed, land, smoothstep(-14, 4, dc));
}

/** Coarse grid: COARSE_RES² samples, corner-aligned, 2 m apart. */
const COARSE_RES = HEIGHT_RES / 2;
const COARSE_CELL = 2;

function computeBaseHeights(n: Noises, biome: Float32Array, progress?: ProgressFn): Float32Array {
  const res = COARSE_RES;
  const heights = new Float32Array(res * res);
  const w = new Float32Array(BIOME_COUNT);
  const mounds = LANDMARKS.filter((l) => l.mound);
  const coast = new CoastTables(n);
  for (let j = 0; j < res; j += 1) {
    if (progress && j % 32 === 0) progress('Raising the land', j / res);
    const z = j * COARSE_CELL - WORLD_HALF;
    for (let i = 0; i < res; i += 1) {
      const x = i * COARSE_CELL - WORLD_HALF;
      let total = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        w[b] = sampleFieldF(biome, BIOME_COUNT, b, x, z);
        total += w[b];
      }
      let h = 0;
      let used = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        const weight = w[b] / total;
        if (weight < 0.003) continue;
        h += weight * biomeHeight(n, b, x, z);
        used += weight;
      }
      h /= used;
      for (const m of mounds) {
        const dx = x - m.x;
        const dz = z - m.z;
        const d2 = dx * dx + dz * dz;
        const r = m.mound!.radius;
        if (d2 < r * r) {
          const k = 1 - Math.sqrt(d2) / r;
          h += m.mound!.height * k * k * (3 - 2 * k);
        }
      }
      h = applyCoast(n, coast, x, z, h);
      for (const s of SEA_STACKS) {
        const dx = x - s.x;
        const dz = z - s.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > s.radius * s.radius * 1.4) continue;
        const d = Math.sqrt(d2) * (1 + 0.18 * n.misc.noise(x / 9, z / 9));
        if (d < s.radius) {
          const stack = s.height * Math.pow(smoothstep(s.radius, s.radius * 0.62, d), 0.55) + 1.5 * n.detail.noise(x / 5, z / 5);
          if (stack > h) h = stack;
        }
      }
      heights[j * res + i] = h;
    }
  }
  return heights;
}

// ---------------------------------------------------------------------------
// Erosion (at 2 m resolution, delta applied back to 1 m heights)

/** Erodes the coarse grid in place; returns the (smoothed) erosion delta. */
function applyErosion(coarse: Float32Array, biome: Float32Array, progress?: ProgressFn): Float32Array {
  const res = COARSE_RES;
  const original = coarse.slice();
  // Harder rock in the peaks and basalt, softer soil in meadows and marsh.
  const hardness = new Float32Array(res * res);
  const hardByBiome = [0.85, 0.9, 0.75, 0.8, 0.7, 1.0, 0.25, 0.65];
  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const x = i * COARSE_CELL - WORLD_HALF;
      const z = j * COARSE_CELL - WORLD_HALF;
      let hsum = 0;
      let wsum = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        const w = sampleFieldF(biome, BIOME_COUNT, b, x, z);
        hsum += w * hardByBiome[b];
        wsum += w;
      }
      hardness[j * res + i] = hsum / Math.max(1e-6, wsum);
    }
  }
  erode(coarse, {
    size: res,
    droplets: 700_000,
    seed: WORLD_SEED + 101,
    heightScale: 30,
    lifetime: 55,
    radius: 2,
    erodeSpeed: 0.34,
    depositSpeed: 0.26,
    evaporateSpeed: 0.01,
    capacity: 5,
    minStartHeight: 2,
    hardness,
    onProgress: (f) => progress?.('Carving the valleys', f),
  });
  // Smooth the delta slightly to avoid pitting, then upsample to 1 m.
  const delta = new Float32Array(res * res);
  for (let k = 0; k < res * res; k += 1) delta[k] = coarse[k] - original[k];
  const smooth = new Float32Array(res * res);
  for (let j = 1; j < res - 1; j += 1) {
    for (let i = 1; i < res - 1; i += 1) {
      const k = j * res + i;
      smooth[k] =
        delta[k] * 0.4 +
        (delta[k - 1] + delta[k + 1] + delta[k - res] + delta[k + res]) * 0.1 +
        (delta[k - res - 1] + delta[k - res + 1] + delta[k + res - 1] + delta[k + res + 1]) * 0.05;
    }
  }
  return smooth;
}

/** Upsamples the coarse grid to 1 m and adds fine relief the coarse grid can't hold. */
function upsampleHeights(n: Noises, coarse: Float32Array, biome: Float32Array, progress?: ProgressFn): Float32Array {
  const heights = new Float32Array(HEIGHT_RES * HEIGHT_RES);
  const res = COARSE_RES;
  for (let j = 0; j < HEIGHT_RES; j += 1) {
    if (progress && j % 128 === 0) progress('Weathering stone', j / HEIGHT_RES);
    const fz = Math.min(j / 2, res - 1.001);
    const cj = fz | 0;
    const tz = fz - cj;
    const z = j - WORLD_HALF;
    for (let i = 0; i < HEIGHT_RES; i += 1) {
      const fx = Math.min(i / 2, res - 1.001);
      const ci = fx | 0;
      const tx = fx - ci;
      const k = cj * res + ci;
      let h = (coarse[k] * (1 - tx) + coarse[k + 1] * tx) * (1 - tz) + (coarse[k + res] * (1 - tx) + coarse[k + res + 1] * tx) * tz;
      if (h > -0.5) {
        const x = i - WORLD_HALF;
        // Micro relief: stronger on rocky biomes, near zero on marsh flats.
        const rough = 0.35 + 0.65 * (1 - sampleFieldF(biome, BIOME_COUNT, BIOME.Drownfen, x, z));
        h += rough * (0.32 * n.detail.noise(x / 7.5, z / 7.5) + 0.12 * n.detail.noise(x / 2.7 + 17, z / 2.7 - 5));
      }
      heights[j * HEIGHT_RES + i] = h;
    }
  }
  return heights;
}

// ---------------------------------------------------------------------------
// Height sampling helpers on the 1 m grid

function heightAt(heights: Float32Array, x: number, z: number): number {
  const fx = clamp(x + WORLD_HALF, 0, HEIGHT_RES - 1.001);
  const fz = clamp(z + WORLD_HALF, 0, HEIGHT_RES - 1.001);
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * HEIGHT_RES + i;
  return (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - tz) + (heights[k + HEIGHT_RES] * (1 - tx) + heights[k + HEIGHT_RES + 1] * tx) * tz;
}

function forEachSampleInBox(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  fn: (index: number, x: number, z: number) => void,
): void {
  const i0 = Math.max(0, Math.floor(minX + WORLD_HALF));
  const i1 = Math.min(HEIGHT_RES - 1, Math.ceil(maxX + WORLD_HALF));
  const j0 = Math.max(0, Math.floor(minZ + WORLD_HALF));
  const j1 = Math.min(HEIGHT_RES - 1, Math.ceil(maxZ + WORLD_HALF));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) fn(j * HEIGHT_RES + i, i - WORLD_HALF, j - WORLD_HALF);
  }
}

// ---------------------------------------------------------------------------
// Lakes

function lakeShape(n: Noises, lake: LakeDef): Float32Array {
  const shape = new Float32Array(LAKE_SHAPE_SAMPLES);
  for (let s = 0; s < LAKE_SHAPE_SAMPLES; s += 1) {
    const a = (s / LAKE_SHAPE_SAMPLES) * Math.PI * 2;
    shape[s] = 1 + 0.13 * n.misc.fbm(Math.cos(a) * 1.8 + lake.x * 0.01, Math.sin(a) * 1.8 + lake.z * 0.01, 3);
  }
  return shape;
}

export function lakeRadiusAt(lake: { x: number; z: number; radius: number; shape: Float32Array }, x: number, z: number): number {
  let a = Math.atan2(z - lake.z, x - lake.x);
  if (a < 0) a += Math.PI * 2;
  const f = (a / (Math.PI * 2)) * LAKE_SHAPE_SAMPLES;
  const i = Math.floor(f) % LAKE_SHAPE_SAMPLES;
  const t = f - Math.floor(f);
  const s = lake.shape[i] * (1 - t) + lake.shape[(i + 1) % LAKE_SHAPE_SAMPLES] * t;
  return lake.radius * s;
}

function carveLakes(n: Noises, heights: Float32Array): LakeData[] {
  const lakes: LakeData[] = [];
  for (const def of LAKES) {
    const shape = lakeShape(n, def);
    const data: LakeData = {
      id: def.id,
      name: def.name,
      x: def.x,
      z: def.z,
      radius: def.radius,
      level: 0,
      depth: def.depth,
      frozen: Boolean(def.frozen),
      hot: Boolean(def.hot),
      shape,
    };
    // Settle the valley floor around the lake so it sits in a natural basin.
    {
      const R = def.radius;
      let vs = 0;
      let vc = 0;
      forEachSampleInBox(def.x - R * 1.35, def.z - R * 1.35, def.x + R * 1.35, def.z + R * 1.35, (k, x, z) => {
        if ((x & 3) !== 0 || (z & 3) !== 0) return;
        if ((x - def.x) ** 2 + (z - def.z) ** 2 < R * R * 1.8) {
          vs += heights[k];
          vc += 1;
        }
      });
      const valley = vs / Math.max(1, vc);
      const reachV = R * 1.95;
      forEachSampleInBox(def.x - reachV, def.z - reachV, def.x + reachV, def.z + reachV, (k, x, z) => {
        const d = Math.sqrt((x - def.x) ** 2 + (z - def.z) ** 2);
        const w = 0.72 * (1 - smoothstep(R * 0.95, reachV, d));
        if (w > 0) heights[k] = lerp(heights[k], valley, w);
      });
    }
    // Level: a little under the average ground height around the shore.
    let sum = 0;
    let min = Infinity;
    const ring = 48;
    for (let s = 0; s < ring; s += 1) {
      const a = (s / ring) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r = lakeRadiusAt(data, def.x + ca, def.z + sa) * 1.05;
      const h = heightAt(heights, def.x + ca * r, def.z + sa * r);
      sum += h;
      min = Math.min(min, h);
    }
    const avg = sum / ring;
    data.level = Math.round((lerp(min, avg, 0.35) - 0.6) * 10) / 10;
    const margin = Math.min(30, 8 + def.radius * 0.6);
    const reach = def.radius * 1.2 + margin;
    forEachSampleInBox(def.x - reach, def.z - reach, def.x + reach, def.z + reach, (k, x, z) => {
      const d = Math.sqrt((x - def.x) ** 2 + (z - def.z) ** 2);
      const R = lakeRadiusAt(data, x, z);
      const h = heights[k];
      if (d < R) {
        const t = d / R;
        const bed = data.level - def.depth * (1 - smoothstep(0.25, 1, t)) - 0.35 * (1 - t) + 0.5 * n.detail.noise(x / 12, z / 12) * t;
        heights[k] = Math.min(h, lerp(bed, data.level - 0.25, smoothstep(0.82, 1, t)));
      } else if (d < R + margin) {
        // A beach rising gently from the waterline, blended back into the
        // terrain; where the ground is lower it forms a natural berm.
        const t = (d - R) / margin;
        const beach = data.level + 0.22 + (d - R) * 0.07;
        heights[k] = lerp(beach, h, smoothstep(0, 1, t));
      }
    });
    lakes.push(data);
  }
  return lakes;
}

// ---------------------------------------------------------------------------
// Rivers

function catmullRom(points: readonly [number, number][], spacing: number): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s < points.length - 1; s += 1) {
    const p0 = points[Math.max(0, s - 1)];
    const p1 = points[s];
    const p2 = points[s + 1];
    const p3 = points[Math.min(points.length - 1, s + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(segLen / spacing));
    for (let k = 0; k < steps; k += 1) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push([points[points.length - 1][0], points[points.length - 1][1]]);
  return out;
}

const RIVER_STRIDE = 6;

function buildRiver(n: Noises, def: RiverDef, heights: Float32Array, lakes: LakeData[]): RiverData {
  let pts = catmullRom(def.points, 3);
  // Rivers end a few meters past the shoreline instead of trenching the seabed.
  if (!def.toLake) {
    for (let p = 8; p < pts.length; p += 1) {
      if (heightAt(heights, pts[p][0], pts[p][1]) < -0.6) {
        pts = pts.slice(0, Math.min(pts.length, p + 4));
        break;
      }
    }
  }
  const count = pts.length;
  const data = new Float32Array(count * RIVER_STRIDE);
  const fromLake = def.fromLake ? lakes.find((l) => l.id === def.fromLake) : undefined;
  const toLake = def.toLake ? lakes.find((l) => l.id === def.toLake) : undefined;
  let along = 0;
  let surface = fromLake ? fromLake.level : heightAt(heights, pts[0][0], pts[0][1]) - 0.8;
  for (let p = 0; p < count; p += 1) {
    const [x, z] = pts[p];
    if (p > 0) along += Math.hypot(x - pts[p - 1][0], z - pts[p - 1][1]);
    // Smooth the ground along the channel so the bed doesn't follow every bump.
    let ground = 0;
    for (let s = -2; s <= 2; s += 1) {
      const q = pts[clamp(p + s, 0, count - 1)];
      ground += heightAt(heights, q[0], q[1]);
    }
    ground /= 5;
    const target = ground - 1.0;
    const previous = surface;
    if (p > 0) surface = Math.min(surface - 0.012, target);
    if (toLake && p > count - 12) surface = Math.max(surface, toLake.level);
    if (!toLake && ground < 0.6) surface = Math.max(0, Math.min(surface, 0.05));
    surface = Math.max(surface, toLake ? toLake.level : 0);
    const halfWidth = (def.width * 0.5) * (1 + 0.18 * n.misc.noise(along / 60, def.width)) * (0.75 + 0.25 * smoothstep(0, 60, along));
    const fall = p > 0 ? clamp01((previous - surface - 0.25) / 1.5) : 0;
    const o = p * RIVER_STRIDE;
    data[o] = x;
    data[o + 1] = z;
    data[o + 2] = surface;
    data[o + 3] = halfWidth;
    data[o + 4] = along;
    data[o + 5] = fall;
  }
  return {
    id: def.id,
    name: def.name,
    warm: Boolean(def.warm),
    fromLake: def.fromLake,
    toLake: def.toLake,
    points: data,
    count,
  };
}

interface RiverHit {
  dist: Float32Array;
  surface: Float32Array;
  halfWidth: Float32Array;
}

function carveRivers(n: Noises, heights: Float32Array, rivers: RiverData[]): RiverHit {
  const size = HEIGHT_RES * HEIGHT_RES;
  const hit: RiverHit = {
    dist: new Float32Array(size).fill(1e9),
    surface: new Float32Array(size),
    halfWidth: new Float32Array(size),
  };
  const tOut = [0];
  for (const river of rivers) {
    const p = river.points;
    for (let s = 0; s < river.count - 1; s += 1) {
      const a = s * RIVER_STRIDE;
      const b = a + RIVER_STRIDE;
      const hw = Math.max(p[a + 3], p[b + 3]);
      const reach = hw * 2.4 + 8;
      const minX = Math.min(p[a], p[b]) - reach;
      const maxX = Math.max(p[a], p[b]) + reach;
      const minZ = Math.min(p[a + 1], p[b + 1]) - reach;
      const maxZ = Math.max(p[a + 1], p[b + 1]) + reach;
      forEachSampleInBox(minX, minZ, maxX, maxZ, (k, x, z) => {
        const d = pointSegmentDistance(x, z, p[a], p[a + 1], p[b], p[b + 1], tOut);
        if (d < hit.dist[k]) {
          const t = tOut[0];
          hit.dist[k] = d;
          hit.surface[k] = lerp(p[a + 2], p[b + 2], t);
          hit.halfWidth[k] = lerp(p[a + 3], p[b + 3], t);
        }
      });
    }
  }
  for (let k = 0; k < size; k += 1) {
    const d = hit.dist[k];
    if (d > 1e8) continue;
    const hw = hit.halfWidth[k];
    const surface = hit.surface[k];
    const bank = hw * 1.4 + 6;
    const h = heights[k];
    const x = (k % HEIGHT_RES) - WORLD_HALF;
    const z = Math.floor(k / HEIGHT_RES) - WORLD_HALF;
    const depth = 1.1 + 0.9 * clamp01(hw / 7);
    if (d < hw) {
      const t = d / hw;
      const bed = surface - depth * (1 - t * t) - 0.15 + 0.25 * n.detail.noise(x / 6, z / 6);
      heights[k] = Math.min(h, bed);
    } else if (d < hw + bank) {
      const t = (d - hw) / bank;
      const bankHeight = surface + 0.2 + t * t * (bank * 0.55);
      const blend = 1 - smoothstep(0, 1, t);
      if (h > bankHeight) heights[k] = lerp(h, bankHeight, blend * 0.85);
      else if (surface > 0.3 && h > -0.5) heights[k] = lerp(h, surface + 0.25 + t * 1.5, blend);
    }
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Pads and trails

function flattenPads(n: Noises, heights: Float32Array): void {
  for (const lm of LANDMARKS) {
    if (!lm.pad) continue;
    const { radius, falloff } = lm.pad;
    let padH = lm.pad.height;
    if (padH === undefined) {
      let sum = 0;
      let count = 0;
      forEachSampleInBox(lm.x - radius, lm.z - radius, lm.x + radius, lm.z + radius, (k, x, z) => {
        if ((x - lm.x) ** 2 + (z - lm.z) ** 2 <= radius * radius) {
          sum += heights[k];
          count += 1;
        }
      });
      padH = sum / Math.max(1, count) + (lm.pad.offset ?? 0);
    }
    const reach = radius + falloff;
    const target = padH;
    forEachSampleInBox(lm.x - reach * 1.2, lm.z - reach * 1.2, lm.x + reach * 1.2, lm.z + reach * 1.2, (k, x, z) => {
      const a = Math.atan2(z - lm.z, x - lm.x);
      const lobe = 1 + 0.16 * n.misc.noise(Math.cos(a) * 1.7 + lm.x * 0.01, Math.sin(a) * 1.7 + lm.z * 0.01);
      const d = Math.sqrt((x - lm.x) ** 2 + (z - lm.z) ** 2) / lobe;
      const w = 1 - smoothstep(radius, reach, d);
      if (w > 0) heights[k] = lerp(heights[k], target, w);
    });
  }
}

interface TrailSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

function buildTrails(n: Noises): TrailSegment[] {
  const segments: TrailSegment[] = [];
  for (const [fromId, toId] of TRAILS) {
    const a = landmarkById(fromId);
    const b = landmarkById(toId);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const steps = Math.max(3, Math.ceil(len / 28));
    let px = a.x;
    let pz = a.z;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const wobble = s === steps ? 0 : 26 * n.misc.fbm(a.x * 0.013 + t * 3.1, b.z * 0.013 - t * 2.3, 2) * Math.sin(t * Math.PI);
      const qx = a.x + dx * t + nx * wobble;
      const qz = a.z + dz * t + nz * wobble;
      segments.push({ ax: px, az: pz, bx: qx, bz: qz });
      px = qx;
      pz = qz;
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Normals & ambient occlusion

function computeNormalsAndAO(heights: Float32Array, progress?: ProgressFn): Uint8Array {
  const res = HEIGHT_RES;
  const out = new Uint8Array(res * res * 4);
  // Summed-area table for multi-scale concavity (cheap large-radius AO).
  const sat = new Float64Array((res + 1) * (res + 1));
  for (let j = 0; j < res; j += 1) {
    let row = 0;
    for (let i = 0; i < res; i += 1) {
      row += heights[j * res + i];
      sat[(j + 1) * (res + 1) + (i + 1)] = sat[j * (res + 1) + (i + 1)] + row;
    }
  }
  const boxMean = (i: number, j: number, r: number): number => {
    const i0 = Math.max(0, i - r);
    const j0 = Math.max(0, j - r);
    const i1 = Math.min(res, i + r + 1);
    const j1 = Math.min(res, j + r + 1);
    const w = res + 1;
    const s = sat[j1 * w + i1] - sat[j0 * w + i1] - sat[j1 * w + i0] + sat[j0 * w + i0];
    return s / ((i1 - i0) * (j1 - j0));
  };
  for (let j = 0; j < res; j += 1) {
    if (progress && j % 128 === 0) progress('Shading the hills', j / res);
    for (let i = 0; i < res; i += 1) {
      const k = j * res + i;
      const hl = heights[j * res + Math.max(0, i - 1)];
      const hr = heights[j * res + Math.min(res - 1, i + 1)];
      const hu = heights[Math.max(0, j - 1) * res + i];
      const hd = heights[Math.min(res - 1, j + 1) * res + i];
      let nx = (hl - hr) * 0.5;
      let ny = 1;
      let nz = (hu - hd) * 0.5;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const h = heights[k];
      const o1 = clamp01((boxMean(i, j, 2) - h) / 1.2);
      const o2 = clamp01((boxMean(i, j, 7) - h) / 4.5);
      const o3 = clamp01((boxMean(i, j, 22) - h) / 13);
      const ao = clamp(1 - (0.3 * o1 + 0.34 * o2 + 0.3 * o3), 0.2, 1);
      out[k * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      out[k * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[k * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[k * 4 + 3] = Math.round(ao * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fields at 2 m: water level, masks, packed biome weights

function computeFields(
  n: Noises,
  heights: Float32Array,
  normals: Uint8Array,
  biome: Float32Array,
  erosionDelta: Float32Array,
  lakes: LakeData[],
  rivers: RiverData[],
  riverHit: RiverHit,
  trails: TrailSegment[],
): { water: Float32Array; masks: Uint8Array; biomeBytes: Uint8Array } {
  const res = FIELD_RES;
  const water = new Float32Array(res * res);
  const masks = new Uint8Array(res * res * 8);
  const biomeBytes = new Uint8Array(res * res * BIOME_COUNT);

  // Trail distance field.
  const trailDist = new Float32Array(res * res).fill(1e9);
  for (const seg of trails) {
    const reach = 6;
    const i0 = Math.max(0, Math.floor((Math.min(seg.ax, seg.bx) - reach + WORLD_HALF) / FIELD_CELL));
    const i1 = Math.min(res - 1, Math.ceil((Math.max(seg.ax, seg.bx) + reach + WORLD_HALF) / FIELD_CELL));
    const j0 = Math.max(0, Math.floor((Math.min(seg.az, seg.bz) - reach + WORLD_HALF) / FIELD_CELL));
    const j1 = Math.min(res - 1, Math.ceil((Math.max(seg.az, seg.bz) + reach + WORLD_HALF) / FIELD_CELL));
    for (let j = j0; j <= j1; j += 1) {
      const z = -WORLD_HALF + (j + 0.5) * FIELD_CELL;
      for (let i = i0; i <= i1; i += 1) {
        const x = -WORLD_HALF + (i + 0.5) * FIELD_CELL;
        const d = pointSegmentDistance(x, z, seg.ax, seg.az, seg.bx, seg.bz);
        const k = j * res + i;
        if (d < trailDist[k]) trailDist[k] = d;
      }
    }
  }

  for (let j = 0; j < res; j += 1) {
    const z = -WORLD_HALF + (j + 0.5) * FIELD_CELL;
    for (let i = 0; i < res; i += 1) {
      const x = -WORLD_HALF + (i + 0.5) * FIELD_CELL;
      const k = j * res + i;
      const h = heightAt(heights, x, z);
      // Height-grid index for per-sample lookups.
      const hk = Math.round(z + WORLD_HALF) * HEIGHT_RES + Math.round(x + WORLD_HALF);
      const hkc = clamp(hk, 0, HEIGHT_RES * HEIGHT_RES - 1);

      // Water surface.
      let level = 0;
      for (const lake of lakes) {
        const d = Math.hypot(x - lake.x, z - lake.z);
        if (d < lakeRadiusAt(lake, x, z) + 22) level = Math.max(level, lake.level);
      }
      if (riverHit.dist[hkc] < riverHit.halfWidth[hkc] + 1.5) level = Math.max(level, riverHit.surface[hkc]);
      water[k] = level;

      // Biome weights → bytes (normalized to 255).
      let total = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) total += biome[k * BIOME_COUNT + b];
      let assigned = 0;
      let maxB = 0;
      for (let b = 0; b < BIOME_COUNT; b += 1) {
        const v = Math.round((biome[k * BIOME_COUNT + b] / total) * 255);
        biomeBytes[k * BIOME_COUNT + b] = v;
        assigned += v;
        if (biome[k * BIOME_COUNT + b] > biome[k * BIOME_COUNT + maxB]) maxB = b;
      }
      biomeBytes[k * BIOME_COUNT + maxB] = clamp(biomeBytes[k * BIOME_COUNT + maxB] + (255 - assigned), 0, 255);

      const wDrown = biome[k * BIOME_COUNT + BIOME.Drownfen] / total;
      const wFrost = biome[k * BIOME_COUNT + BIOME.Frostveil] / total;
      const ny = normals[hkc * 4 + 1] / 255 * 2 - 1;
      const slope = 1 - ny; // 0 flat .. ~1 vertical

      const path = 1 - smoothstep(0.9, 2.6 + 0.6 * n.detail.noise(x / 14, z / 14), trailDist[k]);
      const underwater = h < level - 0.05;
      const sand = underwater ? 0 : smoothstep(2.9, 0.7, h) * (1 - wDrown) * (1 - smoothstep(0.25, 0.5, slope));
      let wet = wDrown * smoothstep(2.6, 0.2, h);
      if (!underwater && level > 0.1 && h < level + 1.2) wet = Math.max(wet, smoothstep(level + 1.2, level + 0.1, h));
      const riverD = riverHit.dist[hkc] - riverHit.halfWidth[hkc];
      if (riverD < 4 && riverD > -0.5) wet = Math.max(wet, 1 - smoothstep(0, 4, riverD));

      const delta = sampleCoarse(erosionDelta, x, z);
      const deposit = smoothstep(0.05, 0.9, delta);
      const carve = smoothstep(-0.05, -1.4, delta);

      const snowline = 138 + 26 * n.misc.fbm(x / 180, z / 180, 3);
      const snow = clamp01(wFrost * 1.6 - 0.35) * smoothstep(snowline - 22, snowline + 8, h) * (1 - smoothstep(0.45, 0.72, slope));

      const o = k * 8;
      masks[o + MASK.path] = Math.round(clamp01(path) * 255);
      masks[o + MASK.sand] = Math.round(clamp01(sand) * 255);
      masks[o + MASK.wet] = Math.round(clamp01(wet) * 255);
      masks[o + MASK.cave] = 0;
      masks[o + MASK.deposit] = Math.round(deposit * 255);
      masks[o + MASK.carve] = Math.round(carve * 255);
      masks[o + MASK.forest] = 0;
      masks[o + MASK.snow] = Math.round(snow * 255);
    }
  }
  void rivers;
  return { water, masks, biomeBytes };
}

// ---------------------------------------------------------------------------

export function generateWorld(progress?: ProgressFn): WorldFields {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const stats: Record<string, number> = {};
  const n = new Noises();

  progress?.('Mapping the biomes', 0);
  let t = now();
  const biome = computeBiomeField(n);
  stats.biomeMs = now() - t;

  t = now();
  const coarse = computeBaseHeights(n, biome, progress);
  stats.baseHeightsMs = now() - t;

  t = now();
  const erosionDelta = applyErosion(coarse, biome, progress);
  stats.erosionMs = now() - t;

  t = now();
  const heights = upsampleHeights(n, coarse, biome, progress);
  stats.upsampleMs = now() - t;

  progress?.('Filling the lakes', 0);
  t = now();
  const lakes = carveLakes(n, heights);
  const rivers = RIVERS.map((def) => buildRiver(n, def, heights, lakes));
  progress?.('Running the rivers', 0.5);
  const riverHit = carveRivers(n, heights, rivers);
  stats.waterMs = now() - t;

  flattenPads(n, heights);
  const trails = buildTrails(n);

  t = now();
  const normals = computeNormalsAndAO(heights, progress);
  stats.normalsMs = now() - t;

  progress?.('Surveying the ground', 0);
  t = now();
  const { water, masks, biomeBytes } = computeFields(n, heights, normals, biome, erosionDelta, lakes, rivers, riverHit, trails);
  stats.fieldsMs = now() - t;

  const landmarks: LandmarkPlacement[] = LANDMARKS.map((lm) => ({
    id: lm.id,
    x: lm.x,
    y: heightAt(heights, lm.x, lm.z),
    z: lm.z,
  }));

  stats.totalMs = now() - t0;
  progress?.('Done', 1);
  return {
    version: GEN_VERSION,
    heights,
    normals,
    biome: biomeBytes,
    masks,
    water,
    rivers,
    lakes,
    landmarks,
    stats,
  };
}

export type { BiomeId };
