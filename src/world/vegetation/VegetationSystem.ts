import * as THREE from 'three';
import { Simplex2 } from '../../core/noise';
import { createRng, hash2i } from '../../core/rng';
import type { FoliageTextures } from '../../render/vegetation/foliageTextures';
import { Impostors } from '../../render/vegetation/Impostors';
import {
  createBarkMaterial,
  createLeafMaterial,
  createVegetationDepthMaterial,
  type VegetationShared,
} from '../../render/vegetation/treeMaterials';
import { MASK } from '../gen/generateWorld';
import { BIOME_COUNT, WORLD_HALF, WORLD_SEED } from '../WorldConfig';
import { LANDMARKS } from '../WorldLayout';
import type { WorldData } from '../WorldData';
import { BIOME_FLORA } from './ecology';
import { generateTree, SPECIES, type SpeciesConfig, type TreeMeshes } from './TreeGenerator';
import { LAYER_SHADOW_PROXY } from '../../render/RenderPipeline';

const CELL = 64;
const VARIANTS_TREE = 2;

export interface VegetationOptions {
  lod0Distance: number;
  lod1Distance: number;
  maxDistance: number;
  alphaToCoverage: boolean;
  /** Trees within this distance cast (proxy) shadows. */
  shadowDistance: number;
}

interface Kind {
  index: number;
  species: SpeciesConfig;
  variant: number;
  lod0: TreeMeshes;
  lod1: TreeMeshes;
  bark0: THREE.InstancedMesh;
  leaves0: THREE.InstancedMesh | null;
  bark1: THREE.InstancedMesh;
  leaves1: THREE.InstancedMesh | null;
  shadowBark: THREE.InstancedMesh;
  shadowLeaves: THREE.InstancedMesh | null;
  /** Index into the impostor atlas (one per species). */
  impostor: number;
  n0: number;
  n1: number;
  ns: number;
}

export interface TreeCollider {
  x: number;
  z: number;
  radius: number;
  height: number;
}

interface Cell {
  key: number;
  cx: number;
  cz: number;
  count: number;
  kinds: Uint16Array;
  matrices: Float32Array;
  positions: Float32Array;
  tints: Float32Array;
  colliders: TreeCollider[];
  center: THREE.Vector3;
  radius: number;
}

const LOD0_CAP = 700;
const LOD1_CAP = 4000;
const SHADOW_CAP = 2500;
const IMPOSTOR_CAP = 60000;

export class VegetationSystem {
  readonly group = new THREE.Group();
  private readonly kinds: Kind[] = [];
  private readonly kindBySpecies = new Map<string, Kind[]>();
  private readonly cells = new Map<number, Cell>();
  private readonly pending: number[] = [];
  private readonly noise = new Simplex2(WORLD_SEED + 71);
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly clearings: { x: number; z: number; r: number }[] = [];
  private readonly biomeScratch = new Float32Array(BIOME_COUNT);
  readonly materials: THREE.Material[] = [];
  readonly impostors: Impostors;
  stats = { cells: 0, lod0: 0, lod1: 0, impostors: 0, shadows: 0 };
  private impostorKey = '';

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly world: WorldData,
    shared: VegetationShared,
    textures: FoliageTextures,
    private options: VegetationOptions,
  ) {
    for (const lm of LANDMARKS) {
      const r = lm.pad ? lm.pad.radius + 8 : lm.mound ? lm.mound.radius * 0.25 : lm.kind === 'crater' ? 0 : 12;
      if (r > 0) this.clearings.push({ x: lm.x, z: lm.z, r });
    }
    const leafMaterial = createLeafMaterial(shared, textures, options.alphaToCoverage);
    const leafDepth = createVegetationDepthMaterial(shared, textures);
    const barkDepth = createVegetationDepthMaterial(shared, null);
    this.materials.push(leafMaterial);
    const barkMaterials = new Map<number, THREE.MeshStandardMaterial>();

    let index = 0;
    for (const species of Object.values(SPECIES)) {
      const variants = species.shape === 'bush' ? 1 : VARIANTS_TREE;
      const list: Kind[] = [];
      for (let v = 0; v < variants; v += 1) {
        const seed = hash2i(index, v, 1337);
        const lod0 = generateTree(species, { seed, lod: 0 });
        const lod1 = generateTree(species, { seed, lod: 1 });
        let barkMaterial = barkMaterials.get(species.bark);
        if (!barkMaterial) {
          barkMaterial = createBarkMaterial(shared, textures, species.bark);
          barkMaterials.set(species.bark, barkMaterial);
          this.materials.push(barkMaterial);
        }
        const make = (geometry: THREE.BufferGeometry, material: THREE.Material, cap: number, depth: THREE.Material, shadowProxy: boolean) => {
          const mesh = new THREE.InstancedMesh(geometry, material, cap);
          mesh.count = 0;
          mesh.frustumCulled = false;
          // Visible trees never cast; dedicated proxies do (see LAYER_SHADOW_PROXY).
          mesh.castShadow = shadowProxy;
          mesh.receiveShadow = !shadowProxy;
          mesh.customDepthMaterial = depth;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (shadowProxy) mesh.layers.set(LAYER_SHADOW_PROXY);
          this.group.add(mesh);
          return mesh;
        };
        const shadowLod = generateTree(species, { seed, lod: 2 });
        const kind: Kind = {
          index,
          species,
          variant: v,
          lod0,
          lod1,
          bark0: make(lod0.bark, barkMaterial, LOD0_CAP, barkDepth, false),
          leaves0: lod0.leaves ? make(lod0.leaves, leafMaterial, LOD0_CAP, leafDepth, false) : null,
          bark1: make(lod1.bark, barkMaterial, LOD1_CAP, barkDepth, false),
          leaves1: lod1.leaves ? make(lod1.leaves, leafMaterial, LOD1_CAP, leafDepth, false) : null,
          shadowBark: make(shadowLod.bark, barkMaterial, SHADOW_CAP, barkDepth, true),
          shadowLeaves: shadowLod.leaves ? make(shadowLod.leaves, leafMaterial, SHADOW_CAP, leafDepth, true) : null,
          impostor: -1,
          n0: 0,
          n1: 0,
          ns: 0,
        };
        for (const mesh of [kind.leaves0, kind.leaves1]) {
          if (!mesh) continue;
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        }
        list.push(kind);
        this.kinds.push(kind);
        index += 1;
      }
      this.kindBySpecies.set(species.id, list);
    }

    // Impostors: one atlas entry per species (variant 0).
    const sources = [];
    let impostorIndex = 0;
    for (const list of this.kindBySpecies.values()) {
      const k0 = list[0];
      sources.push({
        bark: k0.lod0.bark,
        leaves: k0.lod0.leaves,
        barkLayer: k0.species.bark,
        height: k0.lod0.height,
        width: k0.lod0.canopyRadius * 2,
      });
      for (const k of list) k.impostor = impostorIndex;
      impostorIndex += 1;
    }
    this.impostors = new Impostors(renderer, sources, textures, IMPOSTOR_CAP, options.alphaToCoverage);
    this.materials.push(this.impostors.material);
    this.group.add(this.impostors.mesh);
  }

  // ---------------------------------------------------------------------------
  // Scatter

  private cellKey(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  private pickSpecies(rng: () => number, weights: Float32Array, trees: boolean): string | null {
    let total = 0;
    const options: [string, number][] = [];
    for (let b = 0; b < BIOME_COUNT; b += 1) {
      const w = weights[b];
      if (w < 0.02) continue;
      const flora = BIOME_FLORA[b];
      const list = trees ? flora.trees : flora.shrubs;
      for (const entry of list) {
        const weight = entry.weight * w;
        options.push([entry.species, weight]);
        total += weight;
      }
    }
    if (total <= 0) return null;
    let roll = rng() * total;
    for (const [species, weight] of options) {
      roll -= weight;
      if (roll <= 0) return species;
    }
    return options[options.length - 1][0];
  }

  private generateCell(cx: number, cz: number): Cell {
    const rng = createRng(hash2i(cx, cz, WORLD_SEED + 5));
    const kinds: number[] = [];
    const matrices: number[] = [];
    const positions: number[] = [];
    const tints: number[] = [];
    const colliders: TreeCollider[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const x0 = cx * CELL;
    const z0 = cz * CELL;
    let minY = Infinity;
    let maxY = -Infinity;

    const place = (trees: boolean, spacing: number) => {
      const n = Math.round(CELL / spacing);
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const x = x0 + (i + rng()) * spacing;
          const z = z0 + (j + rng()) * spacing;
          const roll = rng();
          const pickRoll = rng;
          if (Math.abs(x) > WORLD_HALF - 4 || Math.abs(z) > WORLD_HALF - 4) continue;
          const weights = this.world.biomeWeights(x, z, this.biomeScratch);
          const ground = this.world.heightAt(x, z);
          // Density from the blended ecology.
          const v = this.noise.fbm(x / 170, z / 170, 4) * 0.65 * 0.5 + this.noise.noise(x / 55, z / 55) * 0.35 * 0.5 + 0.5;
          let density = 0;
          for (let b = 0; b < BIOME_COUNT; b += 1) {
            const w = weights[b];
            if (w < 0.01) continue;
            const flora = BIOME_FLORA[b];
            const grove = trees ? THREE.MathUtils.smoothstep(v, flora.openness - 0.12, flora.openness + 0.1) : 0.4 + 0.6 * THREE.MathUtils.smoothstep(v, flora.openness - 0.3, flora.openness);
            const line = 1 - THREE.MathUtils.smoothstep(ground, flora.treeline - 25, flora.treeline + 10);
            density += w * grove * (trees ? line : Math.max(0.3, line)) * (trees ? flora.treeDensity : flora.shrubDensity);
          }
          const probability = (density * spacing * spacing) / 100;
          if (roll > probability) continue;
          const slope = this.world.slopeAt(x, z);
          if (slope > (trees ? 0.42 : 0.55)) continue;
          const water = this.world.waterLevelAt(x, z);
          const swamp = weights[6] > 0.45;
          if (ground < water + (swamp ? -0.9 : 0.25)) continue;
          if (this.world.maskAt(x, z, MASK.path) > 0.3) continue;
          if (this.world.maskAt(x, z, MASK.sand) > 0.4 && trees) continue;
          let cleared = false;
          for (const c of this.clearings) {
            const dx = x - c.x;
            const dz = z - c.z;
            if (dx * dx + dz * dz < c.r * c.r) {
              cleared = true;
              break;
            }
          }
          if (cleared) continue;
          const speciesId = this.pickSpecies(pickRoll, weights, trees);
          if (!speciesId) continue;
          const list = this.kindBySpecies.get(speciesId);
          if (!list) continue;
          const kind = list[Math.floor(rng() * list.length) % list.length];
          const scale = 0.78 + rng() * 0.45;
          const yaw = rng() * Math.PI * 2;
          const tilt = (rng() - 0.5) * 0.06;
          p.set(x, ground - 0.12 * scale, z);
          q.setFromAxisAngle(up, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
          s.setScalar(scale);
          m.compose(p, q, s);
          kinds.push(kind.index);
          for (let e = 0; e < 16; e += 1) matrices.push(m.elements[e]);
          positions.push(x, ground, z);
          // Seasonless variation: slightly yellower or bluer foliage per tree.
          const hue = rng();
          tints.push(0.88 + 0.24 * hue, 0.92 + 0.14 * rng(), 0.85 + 0.2 * (1 - hue));
          minY = Math.min(minY, ground);
          maxY = Math.max(maxY, ground + kind.lod0.height * scale);
          if (kind.lod0.trunkRadius > 0) {
            colliders.push({ x, z, radius: kind.lod0.trunkRadius * scale * 1.15, height: kind.lod0.height * scale });
          }
        }
      }
    };
    place(true, 3.6);
    place(false, 2.8);

    const count = kinds.length;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : this.world.heightAt(x0 + CELL / 2, z0 + CELL / 2);
    const halfY = Number.isFinite(minY) ? (maxY - minY) / 2 : 5;
    return {
      key: this.cellKey(cx, cz),
      cx,
      cz,
      count,
      kinds: Uint16Array.from(kinds),
      matrices: Float32Array.from(matrices),
      positions: Float32Array.from(positions),
      tints: Float32Array.from(tints),
      colliders,
      center: new THREE.Vector3(x0 + CELL / 2, cy, z0 + CELL / 2),
      radius: Math.hypot(CELL / 2, CELL / 2, halfY) + 12,
    };
  }

  /** Synchronously generates cells around a point (e.g. at load/teleport). */
  prewarm(x: number, z: number, radius: number): void {
    const c0x = Math.floor((x - radius) / CELL);
    const c1x = Math.floor((x + radius) / CELL);
    const c0z = Math.floor((z - radius) / CELL);
    const c1z = Math.floor((z + radius) / CELL);
    for (let cz = c0z; cz <= c1z; cz += 1) {
      for (let cx = c0x; cx <= c1x; cx += 1) {
        const key = this.cellKey(cx, cz);
        if (!this.cells.has(key)) this.cells.set(key, this.generateCell(cx, cz));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame instance assembly

  update(camera: THREE.PerspectiveCamera): void {
    const opts = this.options;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    // Queue missing cells, nearest first; generate a few per frame.
    const R = opts.maxDistance;
    const c0x = Math.floor((camX - R) / CELL);
    const c1x = Math.floor((camX + R) / CELL);
    const c0z = Math.floor((camZ - R) / CELL);
    const c1z = Math.floor((camZ + R) / CELL);
    this.pending.length = 0;
    for (let cz = c0z; cz <= c1z; cz += 1) {
      for (let cx = c0x; cx <= c1x; cx += 1) {
        const key = this.cellKey(cx, cz);
        if (this.cells.has(key)) continue;
        const dx = (cx + 0.5) * CELL - camX;
        const dz = (cz + 0.5) * CELL - camZ;
        if (dx * dx + dz * dz > (R + CELL) * (R + CELL)) continue;
        this.pending.push(key);
      }
    }
    if (this.pending.length) {
      this.pending.sort((a, b) => this.keyDistance(a, camX, camZ) - this.keyDistance(b, camX, camZ));
      const budget = Math.min(this.pending.length, 3);
      for (let i = 0; i < budget; i += 1) {
        const key = this.pending[i];
        const cx = Math.floor(key / 1024) - 512;
        const cz = (key % 1024) - 512;
        this.cells.set(key, this.generateCell(cx, cz));
      }
    }

    for (const kind of this.kinds) {
      kind.n0 = 0;
      kind.n1 = 0;
      kind.ns = 0;
    }
    const lod0Sq = opts.lod0Distance * opts.lod0Distance;
    const lod1Sq = opts.lod1Distance * opts.lod1Distance;
    const shadowSq = opts.shadowDistance * opts.shadowDistance;
    const maxSq = opts.maxDistance * opts.maxDistance;
    // Impostors are rebuilt only when the camera crosses a 12 m grid or cells arrive.
    const key = `${Math.floor(camX / 12)},${Math.floor(camZ / 12)},${this.cells.size}`;
    const rebuildImpostors = key !== this.impostorKey;
    if (rebuildImpostors) {
      this.impostorKey = key;
      this.impostors.begin();
    }
    let visibleCells = 0;
    for (const cell of this.cells.values()) {
      const dx = cell.center.x - camX;
      const dz = cell.center.z - camZ;
      const cellDist = Math.sqrt(dx * dx + dz * dz) - cell.radius;
      if (cellDist > opts.maxDistance) continue;
      const pos = cell.positions;
      if (cellDist > opts.lod1Distance) {
        // Entirely in impostor range.
        if (!rebuildImpostors) continue;
        for (let i = 0; i < cell.count; i += 1) {
          const ix = pos[i * 3] - camX;
          const iz = pos[i * 3 + 2] - camZ;
          if (ix * ix + iz * iz > maxSq) continue;
          this.pushImpostor(cell, i);
        }
        continue;
      }
      let inFrustum = true;
      if (cellDist > opts.shadowDistance) {
        this.sphere.center.copy(cell.center);
        this.sphere.radius = cell.radius;
        inFrustum = this.frustum.intersectsSphere(this.sphere);
      }
      visibleCells += 1;
      for (let i = 0; i < cell.count; i += 1) {
        const ix = pos[i * 3] - camX;
        const iz = pos[i * 3 + 2] - camZ;
        const d2 = ix * ix + iz * iz;
        const kind = this.kinds[cell.kinds[i]];
        if (d2 < shadowSq && kind.ns < SHADOW_CAP) {
          this.writeInstance(kind.shadowBark, kind.shadowLeaves, kind.ns, cell, i);
          kind.ns += 1;
        }
        if (d2 > lod1Sq) {
          if (rebuildImpostors && d2 < maxSq) this.pushImpostor(cell, i);
          continue;
        }
        if (!inFrustum) continue;
        if (d2 < lod0Sq) {
          if (kind.n0 >= LOD0_CAP) continue;
          this.writeInstance(kind.bark0, kind.leaves0, kind.n0, cell, i);
          kind.n0 += 1;
        } else {
          if (kind.n1 >= LOD1_CAP) continue;
          this.writeInstance(kind.bark1, kind.leaves1, kind.n1, cell, i);
          kind.n1 += 1;
        }
      }
    }
    let lod0 = 0;
    let lod1 = 0;
    let shadows = 0;
    for (const kind of this.kinds) {
      this.finish(kind.bark0, kind.n0);
      this.finish(kind.leaves0, kind.n0);
      this.finish(kind.bark1, kind.n1);
      this.finish(kind.leaves1, kind.n1);
      this.finish(kind.shadowBark, kind.ns);
      this.finish(kind.shadowLeaves, kind.ns);
      lod0 += kind.n0;
      lod1 += kind.n1;
      shadows += kind.ns;
    }
    if (rebuildImpostors) this.impostors.end();
    this.stats = { cells: visibleCells, lod0, lod1, impostors: this.impostors.count, shadows };
  }

  private pushImpostor(cell: Cell, i: number): void {
    const kind = this.kinds[cell.kinds[i]];
    const m = cell.matrices;
    const o = i * 16;
    // Scale is the length of the first basis column; yaw from its x/z.
    const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
    const yaw = Math.atan2(-m[o + 2], m[o]);
    const tint = (cell.tints[i * 3] + cell.tints[i * 3 + 1] + cell.tints[i * 3 + 2]) / 3;
    this.impostors.push(m[o + 12], m[o + 13], m[o + 14], yaw, kind.impostor, sx, tint);
  }

  private keyDistance(key: number, x: number, z: number): number {
    const cx = Math.floor(key / 1024) - 512;
    const cz = (key % 1024) - 512;
    const dx = (cx + 0.5) * CELL - x;
    const dz = (cz + 0.5) * CELL - z;
    return dx * dx + dz * dz;
  }

  private writeInstance(bark: THREE.InstancedMesh, leaves: THREE.InstancedMesh | null, n: number, cell: Cell, i: number): void {
    const src = cell.matrices.subarray(i * 16, i * 16 + 16);
    (bark.instanceMatrix.array as Float32Array).set(src, n * 16);
    if (leaves) {
      (leaves.instanceMatrix.array as Float32Array).set(src, n * 16);
      if (leaves.instanceColor) {
        const colors = leaves.instanceColor.array as Float32Array;
        colors[n * 3] = cell.tints[i * 3];
        colors[n * 3 + 1] = cell.tints[i * 3 + 1];
        colors[n * 3 + 2] = cell.tints[i * 3 + 2];
      }
    }
  }

  private finish(mesh: THREE.InstancedMesh | null, count: number): void {
    if (!mesh) return;
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Trunk colliders within `radius` of (x, z). */
  collidersNear(x: number, z: number, radius: number, out: TreeCollider[]): TreeCollider[] {
    out.length = 0;
    const c0x = Math.floor((x - radius) / CELL);
    const c1x = Math.floor((x + radius) / CELL);
    const c0z = Math.floor((z - radius) / CELL);
    const c1z = Math.floor((z + radius) / CELL);
    for (let cz = c0z; cz <= c1z; cz += 1) {
      for (let cx = c0x; cx <= c1x; cx += 1) {
        const cell = this.cells.get(this.cellKey(cx, cz));
        if (!cell) continue;
        for (const c of cell.colliders) {
          const dx = c.x - x;
          const dz = c.z - z;
          if (dx * dx + dz * dz < (radius + c.radius) * (radius + c.radius)) out.push(c);
        }
      }
    }
    return out;
  }

  setOptions(options: VegetationOptions): void {
    this.options = options;
  }
}
