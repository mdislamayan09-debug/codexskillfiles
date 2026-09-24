import * as THREE from 'three';
import { smoothstep } from '../../core/math';
import { Simplex2 } from '../../core/noise';
import { createRng, hash2i } from '../../core/rng';
import { createPropMaterial, createRockMaterial, ORE, ROCK_LAYERS } from '../../render/props/propMaterials';
import type { TerrainMaterialBaker } from '../../render/terrain/TerrainMaterialBaker';
import { MASK } from '../gen/generateWorld';
import { generateTree, SPECIES } from '../vegetation/TreeGenerator';
import type { VegetationSystem } from '../vegetation/VegetationSystem';
import { BIOME, BIOME_COUNT, WORLD_HALF, WORLD_SEED } from '../WorldConfig';
import type { WorldData } from '../WorldData';
import { LANDMARKS } from '../WorldLayout';
import { plannedCaves } from '../Caves';
import {
  berryGeometry,
  clayGeometry,
  driftwoodGeometry,
  fiberPlantGeometry,
  herbGeometry,
  mushroomGeometry,
  shellGeometry,
  stickGeometry,
} from './PropGeometry';
import { generateRock, type RockKind } from './RockGenerator';

// Streams rocks and gatherable props around the player. Two tiers:
//  * large (64 m cells, long range, three LODs): boulders, crags and
//    mineable rock nodes; they are part of the walkable/climbable ground.
//  * small (32 m cells, ~90 m): sticks, stones, flint, fibre plants, berry
//    bushes, mushrooms, herbs, driftwood, shells and clay.
// Placement is deterministic per cell, shaped by biome, slope, water,
// trails and landmark clearings; harvested props regrow on in-game timers.

export type PropKindId =
  | 'boulder'
  | 'rock_node'
  | 'stone'
  | 'flint'
  | 'stick'
  | 'fiber_plant'
  | 'berry_bush'
  | 'mushroom'
  | 'herb'
  | 'driftwood'
  | 'shell'
  | 'clay';

export const PROP_KINDS: readonly PropKindId[] = ['boulder', 'rock_node', 'stone', 'flint', 'stick', 'fiber_plant', 'berry_bush', 'mushroom', 'herb', 'driftwood', 'shell', 'clay'];

const LARGE_CELL = 64;
const SMALL_CELL = 32;

export interface PropHit {
  id: string;
  kind: PropKindId;
  tier: 0 | 1;
  cellKey: number;
  index: number;
  x: number;
  y: number;
  z: number;
  distance: number;
  /** Ore code of rock nodes (see ORE). */
  ore: number;
  variant: number;
}

interface PropCell {
  key: number;
  tier: 0 | 1;
  count: number;
  kind: Uint8Array;
  variant: Uint8Array;
  pos: Float32Array;
  yaw: Float32Array;
  scale: Float32Array;
  params: Float32Array;
  /** Scaled half-extent x, top height, half-extent z. */
  ext: Float32Array;
  removed: Set<number>;
  center: THREE.Vector3;
  radius: number;
}

interface Bucket {
  mesh: THREE.InstancedMesh;
  rock: THREE.InstancedBufferAttribute | null;
  n: number;
  cap: number;
}

interface VariantMeshes {
  /** One bucket list per LOD (index 0 nearest). Each LOD may be several meshes (bush body + berries). */
  lods: Bucket[][];
  /** Unit-scale extents (x half, top, z half). */
  ext: THREE.Vector3;
}

interface RockCollider {
  x: number;
  z: number;
  y: number;
  rx: number;
  rz: number;
  top: number;
  cos: number;
  sin: number;
  tier: 0 | 1;
  cellKey: number;
  index: number;
}

export interface PropOptions {
  largeRadius: number;
  smallRadius: number;
  lod0: number;
  lod1: number;
}

const TMP_M = new THREE.Matrix4();
const TMP_Q = new THREE.Quaternion();
const TMP_S = new THREE.Vector3();
const TMP_P = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class PropSystem {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = [];
  stats = { large: 0, small: 0, instances: 0 };

  private readonly variants = new Map<PropKindId, VariantMeshes[]>();
  private readonly buckets: Bucket[] = [];
  private readonly cells: [Map<number, PropCell>, Map<number, PropCell>] = [new Map(), new Map()];
  private readonly colliders = new Map<number, RockCollider[]>();
  private readonly noise = new Simplex2(WORLD_SEED + 91);
  private readonly biomeScratch = new Float32Array(BIOME_COUNT);
  private readonly clearings: { x: number; z: number; r: number }[] = [];
  private readonly regrowAt = new Map<string, number>();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private lastBuild = new THREE.Vector3(1e9, 0, 0);
  private dirty = true;

  constructor(
    private readonly world: WorldData,
    baker: TerrainMaterialBaker,
    vegetation: VegetationSystem,
    private options: PropOptions,
  ) {
    for (const lm of LANDMARKS) {
      const r = lm.pad ? lm.pad.radius + 6 : 10;
      this.clearings.push({ x: lm.x, z: lm.z, r });
    }
    for (const cave of plannedCaves(world)) {
      for (const n of cave.nodes.slice(0, 4)) this.clearings.push({ x: n.x, z: n.z, r: n.r * 2.2 });
    }
    const rock = createRockMaterial(baker);
    const prop = createPropMaterial();
    const propTwoSided = createPropMaterial({ side: THREE.DoubleSide, roughness: 0.75 });
    const berry = createPropMaterial({ roughness: 0.3 });
    this.materials.push(rock, prop, propTwoSided, berry);

    const rockVariant = (kind: PropKindId, seed: number, shape: RockKind, details: number[], cap: number[]) => {
      const lods: Bucket[][] = [];
      let ext = new THREE.Vector3(1, 1, 1);
      details.forEach((detail, lod) => {
        const r = generateRock({ seed, kind: shape, detail });
        if (lod === 0) ext = new THREE.Vector3(r.extents.x, r.top, r.extents.z);
        lods.push([this.bucket(r.geometry, rock, cap[lod], true, kind === 'boulder' || kind === 'rock_node')]);
      });
      return { lods, ext };
    };
    const simple = (geometry: THREE.BufferGeometry, material: THREE.Material, cap: number, shadow = true): VariantMeshes => {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox as THREE.Box3;
      const ext = new THREE.Vector3(Math.max(-box.min.x, box.max.x), box.max.y, Math.max(-box.min.z, box.max.z));
      return { lods: [[this.bucket(geometry, material, cap, false, shadow)]], ext };
    };

    const boulderShapes: RockKind[] = ['boulder', 'boulder', 'crag', 'boulder', 'slab', 'crag', 'boulder', 'slab'];
    this.variants.set(
      'boulder',
      boulderShapes.map((shape, i) => rockVariant('boulder', 900 + i, shape, [7, 3, 1], [260, 900, 3000])),
    );
    this.variants.set(
      'rock_node',
      (['boulder', 'crag', 'boulder'] as RockKind[]).map((shape, i) => rockVariant('rock_node', 1300 + i, shape, [6, 2], [120, 400])),
    );
    this.variants.set(
      'stone',
      [0, 1, 2, 3].map((i) => rockVariant('stone', 1500 + i, 'pebble', [2], [600])),
    );
    this.variants.set(
      'flint',
      [0, 1, 2].map((i) => rockVariant('flint', 1600 + i, 'shard', [2], [300])),
    );
    this.variants.set('stick', [0, 1, 2, 3].map((i) => simple(stickGeometry(1700 + i), prop, 600)));
    this.variants.set('fiber_plant', [0, 1, 2].map((i) => simple(fiberPlantGeometry(1800 + i), propTwoSided, 500)));
    this.variants.set('mushroom', [0, 1, 2].map((i) => simple(mushroomGeometry(1900 + i), prop, 400, false)));
    this.variants.set(
      'herb',
      [0.28, 0.52, 0.42].map((hue, i) => simple(herbGeometry(2000 + i, hue), propTwoSided, 400, false)),
    );
    this.variants.set('driftwood', [0, 1].map((i) => simple(driftwoodGeometry(2100 + i), prop, 200)));
    this.variants.set('shell', [0, 1, 2].map((i) => simple(shellGeometry(2200 + i), prop, 300, false)));
    this.variants.set('clay', [0, 1].map((i) => simple(clayGeometry(2300 + i), prop, 120, false)));

    // Berry bushes: a shrub body (shared vegetation materials) plus berries.
    const bushes: VariantMeshes[] = [];
    for (let i = 0; i < 2; i += 1) {
      const body = generateTree(SPECIES.shrub, { seed: 2400 + i, lod: 1 });
      const anchors: THREE.Vector3[] = [];
      const leafPos = body.leaves?.getAttribute('position');
      if (leafPos) {
        const rng = createRng(2450 + i);
        for (let k = 0; k < 14; k += 1) {
          const v = Math.floor(rng() * leafPos.count);
          anchors.push(new THREE.Vector3(leafPos.getX(v), leafPos.getY(v), leafPos.getZ(v)).multiplyScalar(1.04));
        }
      }
      const barkMesh = this.bucket(body.bark, vegetation.barkMaterial(SPECIES.shrub.bark), 220, false, true);
      barkMesh.mesh.customDepthMaterial = vegetation.barkDepth;
      const lod: Bucket[] = [barkMesh];
      if (body.leaves) {
        const leaves = this.bucket(body.leaves, vegetation.leafMaterial, 220, false, true);
        leaves.mesh.customDepthMaterial = vegetation.leafDepth;
        lod.push(leaves);
      }
      const berries = this.bucket(berryGeometry(2460 + i, anchors, i === 0 ? new THREE.Color(0.55, 0.05, 0.08) : new THREE.Color(0.12, 0.1, 0.35)), berry, 220, false, false);
      lod.push(berries);
      bushes.push({ lods: [lod], ext: new THREE.Vector3(body.canopyRadius, body.height, body.canopyRadius) });
    }
    this.variants.set('berry_bush', bushes);
  }

  private bucket(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number, rock: boolean, shadow: boolean): Bucket {
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    let attr: THREE.InstancedBufferAttribute | null = null;
    if (rock) {
      attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aRock', attr);
    }
    this.group.add(mesh);
    const b: Bucket = { mesh, rock: attr, n: 0, cap };
    this.buckets.push(b);
    return b;
  }

  setOptions(options: PropOptions): void {
    this.options = options;
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Scatter

  private cellKey(cx: number, cz: number): number {
    return (cx + 1024) * 2048 + (cz + 1024);
  }

  private cleared(x: number, z: number): boolean {
    for (const c of this.clearings) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  private generate(tier: 0 | 1, cx: number, cz: number): PropCell {
    const size = tier === 0 ? LARGE_CELL : SMALL_CELL;
    const rng = createRng(hash2i(cx, cz, WORLD_SEED + 211 + tier * 17));
    const kinds: number[] = [];
    const variants: number[] = [];
    const pos: number[] = [];
    const yaw: number[] = [];
    const scale: number[] = [];
    const params: number[] = [];
    const ext: number[] = [];
    const world = this.world;
    const x0 = cx * size;
    const z0 = cz * size;
    let minY = Infinity;
    let maxY = -Infinity;

    const add = (kind: PropKindId, variant: number, x: number, z: number, s: number, rot: number, p: [number, number, number, number], sink = 0) => {
      const y = world.heightAt(x, z) - sink * s;
      const v = (this.variants.get(kind) as VariantMeshes[])[variant];
      kinds.push(PROP_KINDS.indexOf(kind));
      variants.push(variant);
      pos.push(x, y, z);
      yaw.push(rot);
      scale.push(s);
      params.push(...p);
      ext.push(v.ext.x * s, v.ext.y * s, v.ext.z * s);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + v.ext.y * s);
    };

    const scatter = (_kind: PropKindId, spacing: number, density: (x: number, z: number, w: Float32Array, slope: number, ground: number, water: number) => number, place: (x: number, z: number, w: Float32Array, slope: number) => void) => {
      const n = Math.max(1, Math.round(size / spacing));
      const step = size / n;
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const x = x0 + (i + rng()) * step;
          const z = z0 + (j + rng()) * step;
          const roll = rng();
          if (Math.abs(x) > WORLD_HALF - 6 || Math.abs(z) > WORLD_HALF - 6) continue;
          const ground = world.heightAt(x, z);
          const water = world.waterLevelAt(x, z);
          const w = world.biomeWeights(x, z, this.biomeScratch);
          const slope = world.slopeAt(x, z);
          const d = density(x, z, w, slope, ground, water);
          if (d <= 0 || roll > d) continue;
          if (this.cleared(x, z)) continue;
          place(x, z, w, slope);
        }
      }
    };

    const dryLand = (ground: number, water: number) => ground > water + 0.15;
    const path = (x: number, z: number) => world.maskAt(x, z, MASK.path);

    if (tier === 0) {
      // Boulders: talus below steep ground, clusters on open land.
      scatter(
        'boulder',
        11,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water + 0.4) && ground < -2) return 0;
          if (path(x, z) > 0.3) return 0;
          const cluster = smoothstep(0.1, 0.6, this.noise.fbm(x / 140, z / 140, 3) * 0.5 + 0.5);
          const base =
            w[BIOME.Greensward] * 0.05 +
            w[BIOME.Hollowpine] * 0.1 +
            w[BIOME.Glasswood] * 0.07 +
            w[BIOME.Coast] * 0.09 +
            w[BIOME.Cinderreach] * 0.16 +
            w[BIOME.Frostveil] * 0.2 +
            w[BIOME.Drownfen] * 0.03 +
            w[BIOME.Rim] * 0.18;
          return base * (0.35 + cluster * 1.3) * (1 + Math.min(slope, 0.8) * 2.5);
        },
        (x, z, w, slope) => {
          const p = this.rockParams(x, z, w, 0);
          const big = rng() < 0.08 ? 1.8 + rng() * 0.9 : 0.5 + rng() * 1.05;
          const variant = slope > 0.45 ? (rng() < 0.5 ? 2 : 5) : Math.floor(rng() * 8);
          add('boulder', variant, x, z, big, rng() * Math.PI * 2, p, 0.12);
          // Satellites.
          const sat = rng() < 0.4 ? 1 + Math.floor(rng() * 3) : 0;
          for (let k = 0; k < sat; k += 1) {
            const a = rng() * Math.PI * 2;
            const r = big * (1.4 + rng() * 1.6);
            const sx = x + Math.cos(a) * r;
            const sz = z + Math.sin(a) * r;
            if (world.waterLevelAt(sx, sz) > world.heightAt(sx, sz) + 0.5) continue;
            add('boulder', Math.floor(rng() * 8), sx, sz, big * (0.25 + rng() * 0.35), rng() * Math.PI * 2, this.rockParams(sx, sz, w, 0), 0.1);
          }
        },
      );
      // Mineable nodes (ore by biome).
      scatter(
        'rock_node',
        18,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || path(x, z) > 0.2) return 0;
          const rocky = w[BIOME.Cinderreach] * 0.16 + w[BIOME.Frostveil] * 0.12 + w[BIOME.Rim] * 0.12 + w[BIOME.Hollowpine] * 0.06 + w[BIOME.Glasswood] * 0.08 + w[BIOME.Greensward] * 0.05 + w[BIOME.Coast] * 0.04;
          return rocky * (1 + Math.min(slope, 0.6) * 2);
        },
        (x, z, w) => {
          const ore = this.oreFor(w, rng());
          add('rock_node', Math.floor(rng() * 3), x, z, 0.45 + rng() * 0.2, rng() * Math.PI * 2, this.rockParams(x, z, w, ore), 0.08);
        },
      );
    } else {
      // Loose stones, more along rivers, beaches and slopes.
      scatter(
        'stone',
        7,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water)) return 0;
          const wet = world.maskAt(x, z, MASK.wet);
          return 0.045 + wet * 0.08 + Math.min(slope, 0.6) * 0.1 + w[BIOME.Rim] * 0.05 + w[BIOME.Cinderreach] * 0.04;
        },
        (x, z, w) => add('stone', Math.floor(rng() * 4), x, z, 0.09 + rng() * 0.05, rng() * Math.PI * 2, this.rockParams(x, z, w, 0), 0.05),
      );
      scatter(
        'flint',
        12,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water)) return 0;
          return 0.035 + world.maskAt(x, z, MASK.wet) * 0.08 + w[BIOME.Coast] * 0.05 + Math.min(slope, 0.5) * 0.06;
        },
        (x, z, w) => add('flint', Math.floor(rng() * 3), x, z, 0.07 + rng() * 0.035, rng() * Math.PI * 2, [ROCK_LAYERS.basalt, 0, 0, ORE.obsidian + 0.5 * w[0]], 0.1),
      );
      scatter(
        'stick',
        6,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || slope > 0.5 || path(x, z) > 0.5) return 0;
          return w[BIOME.Hollowpine] * 0.16 + w[BIOME.Greensward] * 0.05 + w[BIOME.Glasswood] * 0.06 + w[BIOME.Rim] * 0.04 + w[BIOME.Drownfen] * 0.05 + w[BIOME.Coast] * 0.02;
        },
        (x, z) => add('stick', Math.floor(rng() * 4), x, z, 0.85 + rng() * 0.35, rng() * Math.PI * 2, [0, 0, 0, 0]),
      );
      scatter(
        'fiber_plant',
        7,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || slope > 0.4 || path(x, z) > 0.3 || world.maskAt(x, z, MASK.sand) > 0.4) return 0;
          return w[BIOME.Greensward] * 0.1 + w[BIOME.Rim] * 0.06 + w[BIOME.Drownfen] * 0.1 + w[BIOME.Hollowpine] * 0.02 + w[BIOME.Coast] * 0.03;
        },
        (x, z) => add('fiber_plant', Math.floor(rng() * 3), x, z, 0.8 + rng() * 0.45, rng() * Math.PI * 2, [0, 0, 0, 0]),
      );
      scatter(
        'berry_bush',
        12,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water + 0.3) || slope > 0.35 || path(x, z) > 0.2) return 0;
          return w[BIOME.Greensward] * 0.05 + w[BIOME.Hollowpine] * 0.045 + w[BIOME.Rim] * 0.03 + w[BIOME.Glasswood] * 0.02;
        },
        (x, z) => add('berry_bush', rng() < 0.6 ? 0 : 1, x, z, 0.75 + rng() * 0.3, rng() * Math.PI * 2, [0, 0, 0, 0]),
      );
      scatter(
        'mushroom',
        8,
        (_x, _z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || slope > 0.45) return 0;
          return w[BIOME.Hollowpine] * 0.09 + w[BIOME.Drownfen] * 0.06 + w[BIOME.Greensward] * 0.012 + w[BIOME.Glasswood] * 0.02;
        },
        (x, z) => add('mushroom', Math.floor(rng() * 3), x, z, 0.9 + rng() * 0.5, rng() * Math.PI * 2, [0, 0, 0, 0]),
      );
      scatter(
        'herb',
        9,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || slope > 0.45 || path(x, z) > 0.3) return 0;
          return w[BIOME.Greensward] * 0.035 + w[BIOME.Hollowpine] * 0.04 + w[BIOME.Frostveil] * 0.03 + w[BIOME.Rim] * 0.025;
        },
        (x, z, w) => {
          // 0 yarrow (meadow), 1 moonmoss (Hollowpine), 2 frostmint (Frostveil).
          const variant = w[BIOME.Frostveil] > 0.45 ? 2 : w[BIOME.Hollowpine] > 0.45 ? 1 : 0;
          add('herb', variant, x, z, 0.9 + rng() * 0.4, rng() * Math.PI * 2, [0, 0, 0, 0]);
        },
      );
      scatter(
        'driftwood',
        13,
        (x, z, _w, _slope, ground, water) => {
          if (!dryLand(ground, water) || ground > 2.6) return 0;
          return world.maskAt(x, z, MASK.sand) * 0.12;
        },
        (x, z) => add('driftwood', Math.floor(rng() * 2), x, z, 0.85 + rng() * 0.4, rng() * Math.PI * 2, [0, 0, 0, 0], 0.03),
      );
      scatter(
        'shell',
        6,
        (x, z, w, _slope, ground, water) => {
          if (!dryLand(ground, water) || ground > 1.8) return 0;
          return world.maskAt(x, z, MASK.sand) * 0.07 * w[BIOME.Coast];
        },
        (x, z) => add('shell', Math.floor(rng() * 3), x, z, 0.8 + rng() * 0.6, rng() * Math.PI * 2, [0, 0, 0, 0]),
      );
      scatter(
        'clay',
        15,
        (x, z, w, slope, ground, water) => {
          if (!dryLand(ground, water) || slope > 0.3) return 0;
          const wet = world.maskAt(x, z, MASK.wet);
          return wet * 0.12 * (1 - w[BIOME.Frostveil]) * (1 - world.maskAt(x, z, MASK.sand));
        },
        (x, z) => add('clay', Math.floor(rng() * 2), x, z, 0.8 + rng() * 0.5, rng() * Math.PI * 2, [0, 0, 0, 0], 0.02),
      );
    }

    const count = kinds.length;
    const cell: PropCell = {
      key: this.cellKey(cx, cz),
      tier,
      count,
      kind: Uint8Array.from(kinds),
      variant: Uint8Array.from(variants),
      pos: Float32Array.from(pos),
      yaw: Float32Array.from(yaw),
      scale: Float32Array.from(scale),
      params: Float32Array.from(params),
      ext: Float32Array.from(ext),
      removed: new Set(),
      center: new THREE.Vector3(x0 + size / 2, Number.isFinite(minY) ? (minY + maxY) / 2 : 0, z0 + size / 2),
      radius: Math.hypot(size / 2, size / 2, Number.isFinite(minY) ? (maxY - minY) / 2 + 4 : 4),
    };
    for (const [id] of this.regrowAt) {
      const [t, k, i] = id.split(':').map(Number);
      if (t === tier && k === cell.key) cell.removed.add(i);
    }
    if (tier === 0) this.indexColliders(cell);
    return cell;
  }

  private rockParams(x: number, z: number, w: Float32Array, ore: number): [number, number, number, number] {
    let layer: number = ROCK_LAYERS.granite;
    if (w[BIOME.Cinderreach] > 0.4 || w[BIOME.Drownfen] > 0.5) layer = ROCK_LAYERS.basalt;
    else if (w[BIOME.Coast] > 0.45 || w[BIOME.Glasswood] > 0.5) layer = ROCK_LAYERS.limestone;
    const moss = Math.min(1, w[BIOME.Hollowpine] * 0.95 + w[BIOME.Drownfen] * 0.85 + w[BIOME.Greensward] * 0.35 + w[BIOME.Rim] * 0.35 + w[BIOME.Coast] * 0.12 + w[BIOME.Glasswood] * 0.2);
    const snow = Math.max(this.world.maskAt(x, z, MASK.snow), w[BIOME.Frostveil] * 0.55);
    const tint = Math.min(0.99, Math.abs(this.noise.noise(x / 60, z / 60)));
    return [layer, moss * (ore ? 0.3 : 1), snow, ore + tint];
  }

  private oreFor(w: Float32Array, roll: number): number {
    if (w[BIOME.Cinderreach] > 0.4) return roll < 0.35 ? ORE.iron : roll < 0.55 ? ORE.coal : roll < 0.75 ? ORE.sulfur : roll < 0.88 ? ORE.obsidian : ORE.none;
    if (w[BIOME.Frostveil] > 0.4) return roll < 0.4 ? ORE.silver : roll < 0.6 ? ORE.iron : ORE.none;
    if (w[BIOME.Glasswood] > 0.4) return roll < 0.55 ? ORE.songstone : ORE.none;
    if (w[BIOME.Rim] > 0.4) return roll < 0.35 ? ORE.iron : roll < 0.45 ? ORE.songstone : ORE.none;
    if (w[BIOME.Hollowpine] > 0.4) return roll < 0.2 ? ORE.iron : ORE.none;
    return roll < 0.12 ? ORE.iron : ORE.none;
  }

  private indexColliders(cell: PropCell): void {
    for (let i = 0; i < cell.count; i += 1) {
      const x = cell.pos[i * 3];
      const z = cell.pos[i * 3 + 2];
      const rx = cell.ext[i * 3] * 0.9;
      const rz = cell.ext[i * 3 + 2] * 0.9;
      const top = cell.ext[i * 3 + 1] * 0.96;
      if (top < 0.25) continue;
      const c: RockCollider = {
        x,
        z,
        y: cell.pos[i * 3 + 1],
        rx,
        rz,
        top,
        cos: Math.cos(cell.yaw[i]),
        sin: Math.sin(cell.yaw[i]),
        tier: cell.tier,
        cellKey: cell.key,
        index: i,
      };
      const r = Math.max(rx, rz);
      for (let bz = Math.floor((z - r) / 8); bz <= Math.floor((z + r) / 8); bz += 1) {
        for (let bx = Math.floor((x - r) / 8); bx <= Math.floor((x + r) / 8); bx += 1) {
          const key = (bx + 4096) * 8192 + (bz + 4096);
          let list = this.colliders.get(key);
          if (!list) {
            list = [];
            this.colliders.set(key, list);
          }
          list.push(c);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queries

  /** Top of any boulder/rock node covering (x, z), or -Infinity. */
  heightAt(x: number, z: number): number {
    const list = this.colliders.get((Math.floor(x / 8) + 4096) * 8192 + (Math.floor(z / 8) + 4096));
    if (!list) return -Infinity;
    let best = -Infinity;
    for (const c of list) {
      const dx = x - c.x;
      const dz = z - c.z;
      // Local frame of the rock (yaw about Y).
      const lx = (dx * c.cos - dz * c.sin) / c.rx;
      const lz = (dx * c.sin + dz * c.cos) / c.rz;
      const r2 = lx * lx + lz * lz;
      if (r2 >= 1) continue;
      if (this.cells[c.tier].get(c.cellKey)?.removed.has(c.index)) continue;
      const h = c.y + c.top * Math.sqrt(1 - Math.pow(r2, 1.35));
      if (h > best) best = h;
    }
    return best;
  }

  /** The gatherable prop the ray points at (with a little aim assist). */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): PropHit | null {
    let best: PropHit | null = null;
    let bestScore = Infinity;
    for (const tier of [0, 1] as const) {
      const size = tier === 0 ? LARGE_CELL : SMALL_CELL;
      const c0x = Math.floor((origin.x - maxDistance) / size);
      const c1x = Math.floor((origin.x + maxDistance) / size);
      const c0z = Math.floor((origin.z - maxDistance) / size);
      const c1z = Math.floor((origin.z + maxDistance) / size);
      for (let cz = c0z; cz <= c1z; cz += 1) {
        for (let cx = c0x; cx <= c1x; cx += 1) {
          const cell = this.cells[tier].get(this.cellKey(cx, cz));
          if (!cell) continue;
          for (let i = 0; i < cell.count; i += 1) {
            const kind = PROP_KINDS[cell.kind[i]];
            if (kind === 'boulder' || cell.removed.has(i)) continue;
            const ex = cell.ext[i * 3];
            const top = cell.ext[i * 3 + 1];
            const radius = Math.max(0.28, Math.max(ex, cell.ext[i * 3 + 2]) * 0.9, top * 0.5);
            const cxw = cell.pos[i * 3] - origin.x;
            const cyw = cell.pos[i * 3 + 1] + top * 0.5 - origin.y;
            const czw = cell.pos[i * 3 + 2] - origin.z;
            const along = cxw * dir.x + cyw * dir.y + czw * dir.z;
            if (along < 0 || along > maxDistance + radius) continue;
            const px = cxw - dir.x * along;
            const py = cyw - dir.y * along;
            const pz = czw - dir.z * along;
            const miss = Math.sqrt(px * px + py * py + pz * pz);
            // Tiny pickups get a generous cone.
            const allowance = radius + 0.12 + along * 0.05;
            if (miss > allowance) continue;
            const score = along + miss * 3;
            if (score < bestScore) {
              bestScore = score;
              best = {
                id: `${tier}:${cell.key}:${i}`,
                kind,
                tier,
                cellKey: cell.key,
                index: i,
                x: cell.pos[i * 3],
                y: cell.pos[i * 3 + 1],
                z: cell.pos[i * 3 + 2],
                distance: along,
                ore: Math.floor(cell.params[i * 4 + 3]),
                variant: cell.variant[i],
              };
            }
          }
        }
      }
    }
    return best;
  }

  /** Nearest unharvested prop of a kind (tests, tutorials, AI). */
  findNearest(kind: PropKindId, x: number, z: number, radius = 80): { x: number; y: number; z: number; top: number } | null {
    let best: { x: number; y: number; z: number; top: number } | null = null;
    let bestD = radius * radius;
    const k = PROP_KINDS.indexOf(kind);
    for (const cells of this.cells) {
      for (const cell of cells.values()) {
        for (let i = 0; i < cell.count; i += 1) {
          if (cell.kind[i] !== k || cell.removed.has(i)) continue;
          const d = (cell.pos[i * 3] - x) ** 2 + (cell.pos[i * 3 + 2] - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: cell.pos[i * 3], y: cell.pos[i * 3 + 1], z: cell.pos[i * 3 + 2], top: cell.ext[i * 3 + 1] };
          }
        }
      }
    }
    return best;
  }

  /** Hide a prop until `regrowHour` (in-game total hours). */
  harvest(hit: PropHit, regrowHour: number): void {
    const cell = this.cells[hit.tier].get(hit.cellKey);
    cell?.removed.add(hit.index);
    this.regrowAt.set(hit.id, regrowHour);
    this.dirty = true;
  }

  tick(totalHours: number): void {
    if (this.regrowAt.size === 0) return;
    for (const [id, hour] of this.regrowAt) {
      if (hour > totalHours) continue;
      this.regrowAt.delete(id);
      const [tier, key, index] = id.split(':').map(Number);
      this.cells[tier as 0 | 1].get(key)?.removed.delete(index);
      this.dirty = true;
    }
  }

  serialize(): [string, number][] {
    return [...this.regrowAt.entries()];
  }

  load(entries: [string, number][]): void {
    this.regrowAt.clear();
    for (const cells of this.cells) for (const cell of cells.values()) cell.removed.clear();
    for (const [id, hour] of entries) {
      this.regrowAt.set(id, hour);
      const [tier, key, index] = id.split(':').map(Number);
      this.cells[tier as 0 | 1].get(key)?.removed.add(index);
    }
    this.dirty = true;
  }

  /** Generate everything around a point now (spawn / teleport). */
  prewarm(x: number, z: number): void {
    for (const tier of [0, 1] as const) {
      const size = tier === 0 ? LARGE_CELL : SMALL_CELL;
      const r = tier === 0 ? Math.min(this.options.largeRadius, 260) : this.options.smallRadius;
      for (let cz = Math.floor((z - r) / size); cz <= Math.floor((z + r) / size); cz += 1) {
        for (let cx = Math.floor((x - r) / size); cx <= Math.floor((x + r) / size); cx += 1) {
          const key = this.cellKey(cx, cz);
          if (!this.cells[tier].has(key)) this.cells[tier].set(key, this.generate(tier, cx, cz));
        }
      }
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Per-frame

  update(camera: THREE.PerspectiveCamera): void {
    const cam = camera.position;
    // Stream missing cells, nearest first, a few per frame.
    let budget = 3;
    for (const tier of [1, 0] as const) {
      const size = tier === 0 ? LARGE_CELL : SMALL_CELL;
      const r = tier === 0 ? this.options.largeRadius : this.options.smallRadius;
      const missing: [number, number, number][] = [];
      for (let cz = Math.floor((cam.z - r) / size); cz <= Math.floor((cam.z + r) / size); cz += 1) {
        for (let cx = Math.floor((cam.x - r) / size); cx <= Math.floor((cam.x + r) / size); cx += 1) {
          if (this.cells[tier].has(this.cellKey(cx, cz))) continue;
          const dx = (cx + 0.5) * size - cam.x;
          const dz = (cz + 0.5) * size - cam.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > (r + size) * (r + size)) continue;
          missing.push([d2, cx, cz]);
        }
      }
      missing.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz] of missing) {
        if (budget <= 0) break;
        this.cells[tier].set(this.cellKey(cx, cz), this.generate(tier, cx, cz));
        budget -= 1;
        this.dirty = true;
      }
    }

    const moved = cam.distanceToSquared(this.lastBuild) > 9;
    if (!moved && !this.dirty) return;
    this.lastBuild.copy(cam);
    this.dirty = false;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const b of this.buckets) b.n = 0;
    const lod0 = this.options.lod0 * this.options.lod0;
    const lod1 = this.options.lod1 * this.options.lod1;
    let large = 0;
    let small = 0;
    for (const tier of [0, 1] as const) {
      const r = tier === 0 ? this.options.largeRadius : this.options.smallRadius;
      const r2 = r * r;
      for (const cell of this.cells[tier].values()) {
        const dx = cell.center.x - cam.x;
        const dz = cell.center.z - cam.z;
        if (Math.sqrt(dx * dx + dz * dz) - cell.radius > r) continue;
        this.sphere.center.copy(cell.center);
        this.sphere.radius = cell.radius;
        // Keep nearby cells regardless of view so shadows don't pop.
        if (dx * dx + dz * dz > 120 * 120 && !this.frustum.intersectsSphere(this.sphere)) continue;
        for (let i = 0; i < cell.count; i += 1) {
          const kindId = PROP_KINDS[cell.kind[i]];
          const removed = cell.removed.has(i);
          if (removed && kindId !== 'berry_bush') continue;
          const ix = cell.pos[i * 3] - cam.x;
          const iz = cell.pos[i * 3 + 2] - cam.z;
          const d2 = ix * ix + iz * iz;
          if (d2 > r2) continue;
          const variant = (this.variants.get(kindId) as VariantMeshes[])[cell.variant[i]];
          const lodIndex = variant.lods.length === 1 ? 0 : d2 < lod0 ? 0 : d2 < lod1 || variant.lods.length === 2 ? 1 : 2;
          const lod = variant.lods[Math.min(lodIndex, variant.lods.length - 1)];
          TMP_P.set(cell.pos[i * 3], cell.pos[i * 3 + 1], cell.pos[i * 3 + 2]);
          TMP_Q.setFromAxisAngle(UP, cell.yaw[i]);
          TMP_S.setScalar(cell.scale[i]);
          TMP_M.compose(TMP_P, TMP_Q, TMP_S);
          for (let b = 0; b < lod.length; b += 1) {
            // Picked berry bushes keep their body, lose the berries (last bucket).
            if (removed && b === lod.length - 1) continue;
            const bucket = lod[b];
            if (bucket.n >= bucket.cap) continue;
            TMP_M.toArray(bucket.mesh.instanceMatrix.array as Float32Array, bucket.n * 16);
            if (bucket.rock) {
              const a = bucket.rock.array as Float32Array;
              a[bucket.n * 4] = cell.params[i * 4];
              a[bucket.n * 4 + 1] = cell.params[i * 4 + 1];
              a[bucket.n * 4 + 2] = cell.params[i * 4 + 2];
              a[bucket.n * 4 + 3] = cell.params[i * 4 + 3];
            }
            bucket.n += 1;
          }
          if (tier === 0) large += 1;
          else small += 1;
        }
      }
    }
    for (const b of this.buckets) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      if (b.n > 0) {
        b.mesh.instanceMatrix.clearUpdateRanges();
        b.mesh.instanceMatrix.addUpdateRange(0, b.n * 16);
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.rock) {
          b.rock.clearUpdateRanges();
          b.rock.addUpdateRange(0, b.n * 4);
          b.rock.needsUpdate = true;
        }
      }
    }
    this.stats = { large, small, instances: large + small };
  }
}
