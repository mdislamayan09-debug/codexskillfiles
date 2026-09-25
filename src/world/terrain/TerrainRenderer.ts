import * as THREE from 'three';
import { addPatch, replaceOnce } from '../../render/materials/MaterialPatches';
import { LAYER_COUNT, LAYER_HEIGHT_BIAS, LAYER_SIDE_STRETCH, LAYER_TILE_METERS } from '../../render/terrain/terrainLayers';
import type { TerrainMaterialBaker } from '../../render/terrain/TerrainMaterialBaker';
import type { WorldData } from '../WorldData';
import {
  TERRAIN_AO_FRAGMENT,
  TERRAIN_BEGIN_VERTEX,
  TERRAIN_FRAGMENT_PARS,
  TERRAIN_NORMAL_FRAGMENT,
  TERRAIN_ROUGHNESS_FRAGMENT,
  TERRAIN_SURFACE_FRAGMENT,
  TERRAIN_VERTEX_PARS,
} from './terrainShader';

/** Nodes at LOD 0 are this many meters wide; each level doubles. */
const BASE_NODE_SIZE = 32;
/** Root covers 4096 m so the land visibly continues (and sinks) past the Veil. */
const ROOT_LEVEL = 7;
const ROOT_HALF = (BASE_NODE_SIZE * 2 ** ROOT_LEVEL) / 2;
/** Crack-free CDLOD needs range ≥ √2·size / (2m − 1); m = 0.72 → ≥ 3.21·size. */
const RANGE_FACTOR = 3.4;
const MORPH_START = 0.72;
const MAX_NODES = 1400;

export interface TerrainOptions {
  gridN: number;
  detailDistance: number;
  /** Ground layers blended per pixel (4; 3 is cheaper). */
  blendLayers?: number;
}

/**
 * CDLOD terrain (Strugar 2010) rendered as ONE instanced draw call: every
 * selected quadtree node reuses the same N×N grid, placed and geomorphed in
 * the vertex shader from the height texture.
 */
export class TerrainRenderer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly nodeAttr: THREE.InstancedBufferAttribute;
  private readonly ranges: number[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private count = 0;
  private camX = 0;
  private camZ = 0;
  private cullDistance = 30;
  selectedNodes = 0;

  constructor(
    private readonly world: WorldData,
    baker: TerrainMaterialBaker,
    private options: TerrainOptions,
  ) {
    for (let level = 0; level <= ROOT_LEVEL; level += 1) this.ranges.push(RANGE_FACTOR * BASE_NODE_SIZE * 2 ** level);

    this.geometry = new THREE.InstancedBufferGeometry();
    this.buildGrid(options.gridN);
    this.nodeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aNode', this.nodeAttr);
    this.geometry.instanceCount = 0;

    const morph: THREE.Vector2[] = [];
    for (let level = 0; level < 10; level += 1) {
      const range = this.ranges[Math.min(level, ROOT_LEVEL)];
      morph.push(new THREE.Vector2(range * MORPH_START, range));
    }

    this.uniforms = {
      uHeightTex: { value: world.heightTexture },
      uCdlodCamera: { value: new THREE.Vector3() },
      uGridN: { value: options.gridN },
      uBaseSize: { value: BASE_NODE_SIZE },
      uMorph: { value: morph },
      uTerrainNormal: { value: world.normalTexture },
      uBiomeA: { value: world.biomeTextureA },
      uBiomeB: { value: world.biomeTextureB },
      uMaskA: { value: world.maskTextureA },
      uMaskB: { value: world.maskTextureB },
      uWaterLevel: { value: world.waterTexture },
      uLayerAlbedo: { value: baker.albedoHeight.texture },
      uLayerNormal: { value: baker.normalRough.texture },
      uLayerTile: { value: LAYER_TILE_METERS.slice(0, LAYER_COUNT) },
      uLayerHeightBias: { value: LAYER_HEIGHT_BIAS.slice(0, LAYER_COUNT) },
      uLayerStretch: { value: LAYER_SIDE_STRETCH.slice(0, LAYER_COUNT).map(([a, b]) => new THREE.Vector2(a, b)) },
      uWetness: { value: 0 },
      uSnowCover: { value: 0 },
      uTerrainTime: { value: 0 },
      uDetailDistance: { value: options.detailDistance },
    };

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    this.material.name = 'terrain';
    this.material.defines = { TERRAIN_BLEND: options.blendLayers ?? 4 };
    const uniforms = this.uniforms;
    addPatch(this.material, {
      key: 'terrain-cdlod',
      apply(shader) {
        Object.assign(shader.uniforms, uniforms);
        let vs = shader.vertexShader;
        vs = replaceOnce(vs, '#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`, 'terrain vertex pars');
        vs = replaceOnce(vs, '#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);', 'terrain normal');
        vs = replaceOnce(vs, '#include <begin_vertex>', TERRAIN_BEGIN_VERTEX, 'terrain begin');
        shader.vertexShader = vs;
        let fs = shader.fragmentShader;
        fs = replaceOnce(fs, '#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`, 'terrain fragment pars');
        fs = replaceOnce(fs, '#include <map_fragment>', TERRAIN_SURFACE_FRAGMENT, 'terrain surface');
        fs = replaceOnce(fs, '#include <roughnessmap_fragment>', TERRAIN_ROUGHNESS_FRAGMENT, 'terrain roughness');
        fs = replaceOnce(fs, '#include <normal_fragment_begin>', TERRAIN_NORMAL_FRAGMENT, 'terrain normal');
        fs = replaceOnce(fs, '#include <normal_fragment_maps>', '', 'terrain normal maps');
        fs = replaceOnce(fs, '#include <aomap_fragment>', TERRAIN_AO_FRAGMENT, 'terrain ao');
        shader.fragmentShader = fs;
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'terrain';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  private buildGrid(n: number): void {
    const positions = new Float32Array((n + 1) * (n + 1) * 3);
    let p = 0;
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        positions[p++] = i / n;
        positions[p++] = 0;
        positions[p++] = j / n;
      }
    }
    const indices = new Uint32Array(n * n * 6);
    let q = 0;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        // Diagonal b–c, matching WorldData.heightAt.
        indices[q++] = a;
        indices[q++] = c;
        indices[q++] = b;
        indices[q++] = b;
        indices[q++] = c;
        indices[q++] = d;
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  }

  setOptions(options: TerrainOptions): void {
    if (options.gridN !== this.options.gridN) {
      this.buildGrid(options.gridN);
      this.uniforms.uGridN.value = options.gridN;
    }
    this.uniforms.uDetailDistance.value = options.detailDistance;
    this.options = options;
  }

  /**
   * Nodes closer than this are never frustum culled (the ground under your
   * feet). The terrain casts no shadows, so nothing behind the view is needed.
   */
  setCullDistance(distance: number): void {
    this.cullDistance = distance;
  }

  update(camera: THREE.PerspectiveCamera, time: number): void {
    camera.updateMatrixWorld();
    this.camX = camera.position.x;
    this.camZ = camera.position.z;
    (this.uniforms.uCdlodCamera.value as THREE.Vector3).copy(camera.position);
    this.uniforms.uTerrainTime.value = time;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.count = 0;
    this.select(-ROOT_HALF, -ROOT_HALF, ROOT_LEVEL);
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.addUpdateRange(0, this.count * 3);
    this.geometry.instanceCount = this.count;
    this.selectedNodes = this.count;
  }

  private nodeDistance(x: number, z: number, size: number): number {
    const dx = Math.max(x - this.camX, 0, this.camX - (x + size));
    const dz = Math.max(z - this.camZ, 0, this.camZ - (z + size));
    return Math.sqrt(dx * dx + dz * dz);
  }

  private visible(x: number, z: number, size: number, distance: number): boolean {
    if (distance < this.cullDistance) return true;
    this.box.min.set(x, -200, z);
    this.box.max.set(x + size, 1200, z + size);
    return this.frustum.intersectsBox(this.box);
  }

  private add(x: number, z: number, level: number): void {
    if (this.count >= MAX_NODES) return;
    const size = BASE_NODE_SIZE * 2 ** level;
    if (!this.visible(x, z, size, this.nodeDistance(x, z, size))) return;
    const a = this.nodeAttr.array as Float32Array;
    a[this.count * 3] = x;
    a[this.count * 3 + 1] = z;
    a[this.count * 3 + 2] = level;
    this.count += 1;
  }

  /** Strugar's selection: returns false when the node is outside its LOD range. */
  private select(x: number, z: number, level: number): boolean {
    const size = BASE_NODE_SIZE * 2 ** level;
    const distance = this.nodeDistance(x, z, size);
    if (distance > this.ranges[level]) return false;
    if (!this.visible(x, z, size, distance)) return true;
    if (level === 0) {
      this.add(x, z, 0);
      return true;
    }
    if (distance > this.ranges[level - 1]) {
      this.add(x, z, level);
      return true;
    }
    const half = size / 2;
    for (let c = 0; c < 4; c += 1) {
      const cx = x + (c & 1) * half;
      const cz = z + (c >> 1) * half;
      // Children beyond the finer range are drawn at this level's resolution
      // (their vertices are fully morphed, so they match this LOD exactly).
      if (!this.select(cx, cz, level - 1)) this.add(cx, cz, level - 1);
    }
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  get worldData(): WorldData {
    return this.world;
  }
}
