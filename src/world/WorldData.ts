import * as THREE from 'three';
import { clamp } from '../core/math';
import { BIOME_COUNT, FIELD_CELL, FIELD_RES, HEIGHT_RES, WORLD_HALF, type BiomeId } from './WorldConfig';
import { MASK, type LakeData, type LandmarkPlacement, type RiverData, type WorldFields } from './gen/generateWorld';

/**
 * Main-thread view of the generated world: exact physics queries plus the
 * GPU textures the terrain, water and vegetation shaders sample.
 *
 * Height queries interpolate on the same triangulation the terrain mesh uses
 * at LOD 0 (diagonal from (i+1, j) to (i, j+1)), so feet never float or sink.
 */
export class WorldData {
  readonly heights: Float32Array;
  readonly normals: Uint8Array;
  readonly biome: Uint8Array;
  readonly masks: Uint8Array;
  readonly water: Float32Array;
  readonly rivers: RiverData[];
  readonly lakes: LakeData[];
  readonly landmarks: LandmarkPlacement[];

  readonly heightTexture: THREE.DataTexture;
  readonly normalTexture: THREE.DataTexture;
  readonly biomeTextureA: THREE.DataTexture;
  readonly biomeTextureB: THREE.DataTexture;
  readonly maskTextureA: THREE.DataTexture;
  readonly maskTextureB: THREE.DataTexture;
  readonly waterTexture: THREE.DataTexture;

  constructor(fields: WorldFields) {
    this.heights = fields.heights;
    this.normals = fields.normals;
    this.biome = fields.biome;
    this.masks = fields.masks;
    this.water = fields.water;
    this.rivers = fields.rivers;
    this.lakes = fields.lakes;
    this.landmarks = fields.landmarks;

    this.heightTexture = new THREE.DataTexture(this.heights, HEIGHT_RES, HEIGHT_RES, THREE.RedFormat, THREE.FloatType);
    this.heightTexture.minFilter = THREE.NearestFilter;
    this.heightTexture.magFilter = THREE.NearestFilter;
    this.heightTexture.needsUpdate = true;

    this.normalTexture = new THREE.DataTexture(this.normals, HEIGHT_RES, HEIGHT_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.normalTexture.magFilter = THREE.LinearFilter;
    this.normalTexture.generateMipmaps = true;
    this.normalTexture.needsUpdate = true;

    const split = (source: Uint8Array, stride: number, offset: number): Uint8Array => {
      const out = new Uint8Array(FIELD_RES * FIELD_RES * 4);
      for (let k = 0; k < FIELD_RES * FIELD_RES; k += 1) {
        out[k * 4] = source[k * stride + offset];
        out[k * 4 + 1] = source[k * stride + offset + 1];
        out[k * 4 + 2] = source[k * stride + offset + 2];
        out[k * 4 + 3] = source[k * stride + offset + 3];
      }
      return out;
    };
    const fieldTexture = (data: Uint8Array): THREE.DataTexture => {
      const tex = new THREE.DataTexture(data, FIELD_RES, FIELD_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    };
    this.biomeTextureA = fieldTexture(split(this.biome, BIOME_COUNT, 0));
    this.biomeTextureB = fieldTexture(split(this.biome, BIOME_COUNT, 4));
    this.maskTextureA = fieldTexture(split(this.masks, 8, 0));
    this.maskTextureB = fieldTexture(split(this.masks, 8, 4));

    this.waterTexture = new THREE.DataTexture(this.water, FIELD_RES, FIELD_RES, THREE.RedFormat, THREE.FloatType);
    this.waterTexture.minFilter = THREE.LinearFilter;
    this.waterTexture.magFilter = THREE.LinearFilter;
    this.waterTexture.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Height

  /** Exact terrain height (matches the LOD-0 triangulation). */
  heightAt(x: number, z: number): number {
    const fx = clamp(x + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const fz = clamp(z + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * HEIGHT_RES + i;
    const h = this.heights;
    const ha = h[k];
    const hb = h[k + 1];
    const hc = h[k + HEIGHT_RES];
    const hd = h[k + HEIGHT_RES + 1];
    if (tx + tz <= 1) return ha + (hb - ha) * tx + (hc - ha) * tz;
    return hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
  }

  /** Smooth (bilinear) height for placement and AI where exact facets don't matter. */
  heightSmooth(x: number, z: number): number {
    const fx = clamp(x + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const fz = clamp(z + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * HEIGHT_RES + i;
    const h = this.heights;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + HEIGHT_RES] * (1 - tx) + h[k + HEIGHT_RES + 1] * tx) * tz;
  }

  /** Surface normal from the exact triangle under (x, z). */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const fx = clamp(x + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const fz = clamp(z + WORLD_HALF, 0, HEIGHT_RES - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const k = j * HEIGHT_RES + i;
    const h = this.heights;
    const ha = h[k];
    const hb = h[k + 1];
    const hc = h[k + HEIGHT_RES];
    const hd = h[k + HEIGHT_RES + 1];
    if (fx - i + (fz - j) <= 1) out.set(ha - hb, 1, ha - hc);
    else out.set(hc - hd, 1, hb - hd);
    return out.normalize();
  }

  /** Smooth normal (bilinear filtered normal field). */
  smoothNormalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 1.5;
    const hl = this.heightSmooth(x - e, z);
    const hr = this.heightSmooth(x + e, z);
    const hu = this.heightSmooth(x, z - e);
    const hd = this.heightSmooth(x, z + e);
    return out.set(hl - hr, 2 * e, hu - hd).normalize();
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    const e = 1;
    const dx = (this.heightSmooth(x + e, z) - this.heightSmooth(x - e, z)) / (2 * e);
    const dz = (this.heightSmooth(x, z + e) - this.heightSmooth(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  // -------------------------------------------------------------------------
  // Fields

  private fieldIndex(x: number, z: number): { i: number; j: number; tx: number; tz: number } {
    const fx = clamp((x + WORLD_HALF) / FIELD_CELL - 0.5, 0, FIELD_RES - 1.001);
    const fz = clamp((z + WORLD_HALF) / FIELD_CELL - 0.5, 0, FIELD_RES - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    return { i, j, tx: fx - i, tz: fz - j };
  }

  /** Water surface height at (x, z) — sea level where no lake or river. */
  waterLevelAt(x: number, z: number): number {
    const { i, j, tx, tz } = this.fieldIndex(x, z);
    const w = this.water;
    const k = j * FIELD_RES + i;
    // Nearest-max avoids lowering a river surface at its banks.
    const a = w[k];
    const b = w[k + 1];
    const c = w[k + FIELD_RES];
    const d = w[k + FIELD_RES + 1];
    const bil = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    return Math.max(bil, Math.min(Math.max(a, b, c, d), bil + 0.4));
  }

  /** Water depth (positive when the ground is under water). */
  waterDepthAt(x: number, z: number): number {
    return this.waterLevelAt(x, z) - this.heightAt(x, z);
  }

  biomeWeights(x: number, z: number, out: Float32Array): Float32Array {
    const { i, j, tx, tz } = this.fieldIndex(x, z);
    const b = this.biome;
    const k00 = (j * FIELD_RES + i) * BIOME_COUNT;
    const k10 = k00 + BIOME_COUNT;
    const k01 = k00 + FIELD_RES * BIOME_COUNT;
    const k11 = k01 + BIOME_COUNT;
    for (let c = 0; c < BIOME_COUNT; c += 1) {
      out[c] = ((b[k00 + c] * (1 - tx) + b[k10 + c] * tx) * (1 - tz) + (b[k01 + c] * (1 - tx) + b[k11 + c] * tx) * tz) / 255;
    }
    return out;
  }

  private readonly biomeScratch = new Float32Array(BIOME_COUNT);

  dominantBiome(x: number, z: number): BiomeId {
    const w = this.biomeWeights(x, z, this.biomeScratch);
    let best = 0;
    for (let c = 1; c < BIOME_COUNT; c += 1) if (w[c] > w[best]) best = c;
    return best as BiomeId;
  }

  maskAt(x: number, z: number, channel: number): number {
    const { i, j, tx, tz } = this.fieldIndex(x, z);
    const m = this.masks;
    const k00 = (j * FIELD_RES + i) * 8 + channel;
    const k10 = k00 + 8;
    const k01 = k00 + FIELD_RES * 8;
    const k11 = k01 + 8;
    return ((m[k00] * (1 - tx) + m[k10] * tx) * (1 - tz) + (m[k01] * (1 - tx) + m[k11] * tx) * tz) / 255;
  }

  isPath(x: number, z: number): boolean {
    return this.maskAt(x, z, MASK.path) > 0.45;
  }

  // -------------------------------------------------------------------------
  // Raycasting

  /**
   * Marches a ray against the terrain. Returns distance or -1.
   * Coarse steps then bisection; good to ~2 cm.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number, out?: THREE.Vector3): number {
    let t = 0;
    let prevT = 0;
    let step = 0.5;
    let above = origin.y - this.heightAt(origin.x, origin.z) >= 0;
    if (!above) return 0;
    while (t < maxDistance) {
      prevT = t;
      t = Math.min(maxDistance, t + step);
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const gap = y - this.heightAt(x, z);
      if (gap < 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 14; i += 1) {
          const mid = (lo + hi) * 0.5;
          const my = origin.y + dir.y * mid;
          if (my - this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid) < 0) hi = mid;
          else lo = mid;
        }
        if (out) out.copy(dir).multiplyScalar(hi).add(origin);
        return hi;
      }
      // Larger steps when far above the ground.
      step = clamp(gap * 0.5, 0.25, 8);
      above = true;
    }
    return -1;
  }

  landmark(id: string): LandmarkPlacement {
    const found = this.landmarks.find((l) => l.id === id);
    if (!found) throw new Error(`Unknown landmark placement: ${id}`);
    return found;
  }

  dispose(): void {
    for (const tex of [this.heightTexture, this.normalTexture, this.biomeTextureA, this.biomeTextureB, this.maskTextureA, this.maskTextureB, this.waterTexture]) {
      tex.dispose();
    }
  }
}
