import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/math';
import type { LakeData, RiverData } from '../../world/gen/generateWorld';
import { SEA_LEVEL, WORLD_HALF, WORLD_SIZE } from '../../world/WorldConfig';
import type { WorldData } from '../../world/WorldData';
import { createFullscreenMaterial, FullscreenPass } from '../FullscreenPass';
import { addPatch, replaceOnce } from '../materials/MaterialPatches';
import type { QualitySettings } from '../Quality';
import { LAYER_TRANSPARENT } from '../RenderPipeline';
import { CASCADES, WaveCascades } from './WaveCascades';
import {
  FOAM_BAKE_FRAG,
  WATER_BEGIN_VERTEX,
  WATER_FRAGMENT_MAIN,
  WATER_FRAGMENT_PARS,
  WATER_OUTGOING,
  WATER_VERTEX_PARS,
} from './waterGlsl';
import { ICE_FRAGMENT_MAIN, ICE_FRAGMENT_PARS, ICE_VERTEX_PARS, ICE_WORLDPOS } from './iceGlsl';

const INFO_RES = 512;
const INFO_CELL = WORLD_SIZE / INFO_RES;

export const WATER_KIND = { sea: 0, lake: 1, river: 2 } as const;

/** What the player (or camera) finds at a point on the water. */
export interface WaterSample {
  /** Surface height including waves; -Infinity when there is no water. */
  surface: number;
  depth: number;
  kind: number;
  flowX: number;
  flowZ: number;
  frozen: boolean;
  hot: boolean;
  turbidity: number;
}

interface SeaInfo {
  /** Signed distance to the coast in meters (positive offshore). */
  distance: Float32Array;
  ocean: Uint8Array;
  gradX: Float32Array;
  gradZ: Float32Array;
  texture: THREE.DataTexture;
}

// Felzenszwalb & Huttenlocher exact squared Euclidean distance transform (1D pass).
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (in cells) from every cell to the nearest cell where `feature` is set. */
function distanceTransform(feature: Uint8Array, res: number): Float32Array {
  const INF = 1e20;
  const grid = new Float64Array(res * res);
  for (let k = 0; k < res * res; k += 1) grid[k] = feature[k] ? 0 : INF;
  const f = new Float64Array(res);
  const d = new Float64Array(res);
  const v = new Int32Array(res);
  const z = new Float64Array(res + 1);
  for (let x = 0; x < res; x += 1) {
    for (let y = 0; y < res; y += 1) f[y] = grid[y * res + x];
    edt1d(f, res, d, v, z);
    for (let y = 0; y < res; y += 1) grid[y * res + x] = d[y];
  }
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y += 1) {
    for (let x = 0; x < res; x += 1) f[x] = grid[y * res + x];
    edt1d(f, res, d, v, z);
    for (let x = 0; x < res; x += 1) out[y * res + x] = Math.sqrt(d[x]);
  }
  return out;
}

function computeSeaInfo(world: WorldData): SeaInfo {
  const res = INFO_RES;
  const land = new Uint8Array(res * res);
  const water = new Uint8Array(res * res);
  for (let j = 0; j < res; j += 1) {
    const z = -WORLD_HALF + (j + 0.5) * INFO_CELL;
    for (let i = 0; i < res; i += 1) {
      const x = -WORLD_HALF + (i + 0.5) * INFO_CELL;
      const k = j * res + i;
      const isLand = world.heightAt(x, z) > SEA_LEVEL || world.waterLevelAt(x, z) > 0.08;
      land[k] = isLand ? 1 : 0;
      water[k] = isLand ? 0 : 1;
    }
  }
  // Ocean = sea cells connected to the map edge; the rest are landlocked pools.
  const ocean = new Uint8Array(res * res);
  const stack: number[] = [];
  for (let i = 0; i < res; i += 1) {
    for (const k of [i, (res - 1) * res + i, i * res, i * res + res - 1]) {
      if (water[k] && !ocean[k]) {
        ocean[k] = 1;
        stack.push(k);
      }
    }
  }
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const i = k % res;
    const j = (k - i) / res;
    const visit = (n: number) => {
      if (water[n] && !ocean[n]) {
        ocean[n] = 1;
        stack.push(n);
      }
    };
    if (i > 0) visit(k - 1);
    if (i < res - 1) visit(k + 1);
    if (j > 0) visit(k - res);
    if (j < res - 1) visit(k + res);
  }
  const toLand = distanceTransform(land, res);
  const toWater = distanceTransform(water, res);
  const distance = new Float32Array(res * res);
  for (let k = 0; k < res * res; k += 1) {
    distance[k] = water[k] ? (toLand[k] - 0.5) * INFO_CELL : -(toWater[k] - 0.5) * INFO_CELL;
  }
  const gradX = new Float32Array(res * res);
  const gradZ = new Float32Array(res * res);
  const data = new Uint16Array(res * res * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const k = j * res + i;
      const gx = distance[j * res + Math.min(res - 1, i + 1)] - distance[j * res + Math.max(0, i - 1)];
      const gz = distance[Math.min(res - 1, j + 1) * res + i] - distance[Math.max(0, j - 1) * res + i];
      const len = Math.hypot(gx, gz) || 1;
      gradX[k] = gx / len;
      gradZ[k] = gz / len;
      data[k * 4] = toHalf(clamp(distance[k], -500, 500));
      data[k * 4 + 1] = toHalf(ocean[k] || land[k] ? 1 : 0);
      data[k * 4 + 2] = toHalf(gradX[k]);
      data[k * 4 + 3] = toHalf(gradZ[k]);
    }
  }
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { distance, ocean, gradX, gradZ, texture };
}

interface BodyAttributes {
  positions: number[];
  body: number[];
  flow: number[];
  kind: number[];
  indices: number[];
}

function newBody(): BodyAttributes {
  return { positions: [], body: [], flow: [], kind: [], indices: [] };
}

function toGeometry(b: BodyAttributes): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  const normals = new Float32Array(b.positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(b.body, 4));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(b.flow, 4));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(b.kind, 2));
  const count = b.positions.length / 3;
  g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(b.indices, 1) : new THREE.Uint16BufferAttribute(b.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Camera-centred grid warped so vertex spacing grows with distance (crack-free). */
function buildSeaGeometry(n: number, innerSpacing: number, extent: number): THREE.BufferGeometry {
  const h = 2 / (n - 1);
  const target = (extent * h) / innerSpacing;
  // Solve (e^a - 1) / a = target for the warp exponent.
  let lo = 0.01;
  let hi = 40;
  for (let it = 0; it < 80; it += 1) {
    const mid = (lo + hi) / 2;
    if ((Math.exp(mid) - 1) / mid > target) hi = mid;
    else lo = mid;
  }
  const alpha = (lo + hi) / 2;
  const c = innerSpacing / (h * alpha);
  const b = newBody();
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = -1 + i * h;
      const v = -1 + j * h;
      const r = Math.hypot(u, v);
      const R = Math.min(extent, c * (Math.exp(alpha * r) - 1));
      const x = r > 0 ? (u / r) * R : 0;
      const z = r > 0 ? (v / r) * R : 0;
      b.positions.push(x, SEA_LEVEL, z);
      b.body.push(1, 1, 0.12, 0);
      b.flow.push(0, 0, 0, innerSpacing * Math.exp(alpha * Math.min(r, 1.2)));
      b.kind.push(WATER_KIND.sea, SEA_LEVEL);
    }
  }
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      const bb = a + 1;
      const cc = a + n;
      const d = cc + 1;
      // Alternate diagonals so the warp stays symmetric.
      if ((i + j) % 2 === 0) b.indices.push(a, cc, bb, bb, cc, d);
      else b.indices.push(a, cc, d, a, d, bb);
    }
  }
  return toGeometry(b);
}

interface LakeLook {
  chop: number;
  turbidity: number;
  milky: number;
}

function lakeLook(lake: LakeData): LakeLook {
  if (lake.hot) return { chop: 0.02, turbidity: 0.15, milky: 1 };
  if (lake.id === 'mirror') return { chop: 0.075, turbidity: 0.1, milky: 0 };
  if (lake.id === 'poppy_pond') return { chop: 0.05, turbidity: 0.45, milky: 0 };
  return { chop: 0.08, turbidity: 0.25, milky: 0 };
}

function buildLakeGeometry(lake: LakeData): THREE.BufferGeometry {
  const half = lake.radius * 1.35 + 26;
  const cell = lake.radius < 30 ? 2 : 4;
  const n = Math.ceil((half * 2) / cell) + 1;
  const look = lakeLook(lake);
  const b = newBody();
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      b.positions.push(lake.x - half + i * cell, lake.level, lake.z - half + j * cell);
      b.body.push(0, look.chop, look.turbidity, look.milky);
      b.flow.push(0, 0, 0, cell);
      b.kind.push(WATER_KIND.lake, lake.level);
    }
  }
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      b.indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  return toGeometry(b);
}

function buildRiverGeometry(river: RiverData): THREE.BufferGeometry {
  const p = river.points;
  const count = river.count;
  const S = 6;
  const across = 7;
  const b = newBody();
  const length = p[(count - 1) * S + 4];
  for (let i = 0; i < count; i += 1) {
    const o = i * S;
    const prev = Math.max(0, i - 1) * S;
    const next = Math.min(count - 1, i + 1) * S;
    let tx = p[next] - p[prev];
    let tz = p[next + 1] - p[prev + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    const run = Math.max(1, p[next + 4] - p[prev + 4]);
    const slope = Math.max(0, (p[prev + 2] - p[next + 2]) / run);
    const fall = p[o + 5];
    const speed = clamp(0.8 + slope * 55 + fall * 2.5, 0.6, 5);
    const white = clamp((slope - 0.02) * 22 + fall * 1.2, 0, 1);
    const along = p[o + 4];
    // Tuck the ribbon under the lake / sea it joins so surfaces never fight.
    const endDrop = 0.14 * (1 - smoothstep(0, 14, along)) * (river.fromLake ? 1 : 0) + 0.14 * (1 - smoothstep(0, 14, length - along));
    const hw = p[o + 3] + 3.2;
    const surface = p[o + 2] - endDrop;
    for (let c = 0; c < across; c += 1) {
      const s = -1 + (2 * c) / (across - 1);
      const core = 1 - 0.55 * s * s;
      b.positions.push(p[o] + nx * s * hw, surface, p[o + 1] + nz * s * hw);
      b.body.push(0, 0.28, river.warm ? 0.2 : 0.32, river.warm ? 0.3 : 0);
      b.flow.push(tx * speed * core, tz * speed * core, white * (0.55 + 0.45 * core), 3);
      b.kind.push(WATER_KIND.river, p[o + 2]);
    }
  }
  for (let i = 0; i < count - 1; i += 1) {
    for (let c = 0; c < across - 1; c += 1) {
      const a = i * across + c;
      const d = a + across;
      b.indices.push(a, d, a + 1, a + 1, d, d + 1);
    }
  }
  return toGeometry(b);
}

export interface WaterUniforms {
  [name: string]: THREE.IUniform;
}

export class WaterSystem {
  readonly group = new THREE.Group();
  readonly waves: WaveCascades;
  readonly material: THREE.MeshPhysicalMaterial;
  readonly iceMaterial: THREE.MeshStandardMaterial;
  readonly uniforms: WaterUniforms;
  readonly foamTarget: THREE.WebGLRenderTarget;
  /** Sea state: significant wave height in meters of the open-sea swell. */
  seaState = 0.9;
  private readonly sea: THREE.Mesh;
  private readonly info: SeaInfo;
  private readonly innerSpacing: number;
  private readonly amplitudes = [0, 0, 0];

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly world: WorldData,
    quality: QualitySettings,
  ) {
    this.waves = new WaveCascades(quality.waveResolution, quality.wavesPerCascade);
    this.info = computeSeaInfo(world);

    this.foamTarget = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.UnsignedByteType,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.foamTarget.texture.anisotropy = 4;
    const bake = new FullscreenPass(createFullscreenMaterial({ fragmentShader: FOAM_BAKE_FRAG }));
    bake.render(renderer, this.foamTarget);
    renderer.setRenderTarget(null);
    bake.dispose();

    this.uniforms = {
      uWaterInfo: { value: this.info.texture },
      uWaterLevel: { value: world.waterTexture },
      uCascadeSize: { value: this.waves.sizes },
      uCascadeAmp: { value: new THREE.Vector3(1, 2.4, 4.0) },
      uSeaState: { value: this.seaState },
      uShoreAmp: { value: 1 },
      uWaterTime: { value: 0 },
      uDisp0: { value: this.waves.displacement(0) },
      uDisp1: { value: this.waves.displacement(1) },
      uDisp2: { value: this.waves.displacement(2) },
      uDispTexels: { value: quality.waveResolution },
      uDer0: { value: this.waves.derivatives(0) },
      uDer1: { value: this.waves.derivatives(1) },
      uDer2: { value: this.waves.derivatives(2) },
      uFoamTex: { value: this.foamTarget.texture },
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uCamNear: { value: 0.1 },
      uCamFar: { value: 1000 },
      uFoamJacobian: { value: 0.62 },
      uSkyClamp: { value: 24 },
      uWaterLightColor: { value: new THREE.Color() },
      uWaterLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uUnderwaterView: { value: 0 },
      uCascadeSlopeVar: { value: this.waves.slopeVariance() },
      uCascadeMinWave: { value: new THREE.Vector3(...CASCADES.map((c) => c.minWavelength)) },
      uCascadeMaxWave: { value: new THREE.Vector3(...CASCADES.map((c) => c.maxWavelength)) },
    };

    this.material = this.createMaterial(quality.waterReflectionSteps);
    this.iceMaterial = this.createIceMaterial();

    this.innerSpacing = quality.waterGrid >= 256 ? 0.35 : quality.waterGrid >= 200 ? 0.45 : 0.6;
    this.sea = new THREE.Mesh(buildSeaGeometry(quality.waterGrid, this.innerSpacing, quality.farPlane * 0.97), this.material);
    this.sea.frustumCulled = false;
    this.sea.name = 'sea';
    this.addWaterMesh(this.sea);

    for (const lake of world.lakes) {
      if (lake.frozen) {
        const ice = new THREE.Mesh(buildLakeGeometry(lake), this.iceMaterial);
        ice.name = `ice:${lake.id}`;
        ice.receiveShadow = true;
        this.group.add(ice);
        continue;
      }
      const mesh = new THREE.Mesh(buildLakeGeometry(lake), this.material);
      mesh.name = `lake:${lake.id}`;
      this.addWaterMesh(mesh);
    }
    for (const river of world.rivers) {
      const mesh = new THREE.Mesh(buildRiverGeometry(river), this.material);
      mesh.name = `river:${river.id}`;
      this.addWaterMesh(mesh);
    }
  }

  private addWaterMesh(mesh: THREE.Mesh): void {
    mesh.layers.set(LAYER_TRANSPARENT);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
  }

  private createMaterial(ssrSteps: number): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0,
      ior: 1.333,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    material.name = 'water';
    const uniforms = this.uniforms;
    const debug = Number(new URLSearchParams(globalThis.location?.search ?? '').get('waterDebug') ?? 0);
    addPatch(material, {
      key: `water-${ssrSteps}-${debug}`,
      apply(shader) {
        Object.assign(shader.uniforms, uniforms);
        shader.defines = { ...(shader.defines ?? {}), WATER_SSR_STEPS: ssrSteps, WATER_DEBUG: debug };
        let vs = shader.vertexShader;
        vs = replaceOnce(vs, '#include <common>', `#include <common>\n${WATER_VERTEX_PARS}`, 'water-vpars');
        vs = replaceOnce(vs, '#include <begin_vertex>', WATER_BEGIN_VERTEX, 'water-begin');
        shader.vertexShader = vs;
        let fs = shader.fragmentShader;
        fs = replaceOnce(fs, '#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${WATER_FRAGMENT_PARS}`, 'water-fpars');
        fs = replaceOnce(fs, '#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>\n${WATER_FRAGMENT_MAIN}`, 'water-main');
        fs = replaceOnce(fs, '#include <color_fragment>', 'diffuseColor.rgb = wAlbedo;\ndiffuseColor.a = wAlpha;', 'water-color');
        fs = replaceOnce(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;', 'water-rough');
        fs = replaceOnce(fs, '#include <normal_fragment_maps>', 'normal = wNV;', 'water-normal');
        fs = replaceOnce(fs, '#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance = mix(radiance, wReflection.rgb, wReflection.a);', 'water-reflect');
        fs = replaceOnce(fs, '#include <opaque_fragment>', `${WATER_OUTGOING}\n#include <opaque_fragment>`, 'water-out');
        shader.fragmentShader = fs;
      },
    });
    return material;
  }

  private createIceMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0 });
    material.name = 'ice';
    const uniforms = this.uniforms;
    addPatch(material, {
      key: 'lake-ice',
      apply(shader) {
        shader.uniforms.uWaterLevel = uniforms.uWaterLevel;
        shader.uniforms.uFoamTex = uniforms.uFoamTex;
        let vs = shader.vertexShader;
        vs = replaceOnce(vs, '#include <common>', `#include <common>\n${ICE_VERTEX_PARS}`, 'ice-vpars');
        vs = replaceOnce(vs, '#include <worldpos_vertex>', `#include <worldpos_vertex>\n${ICE_WORLDPOS}`, 'ice-worldpos');
        shader.vertexShader = vs;
        let fs = shader.fragmentShader;
        fs = replaceOnce(fs, '#include <common>', `#include <common>\n${ICE_FRAGMENT_PARS}`, 'ice-fpars');
        fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${ICE_FRAGMENT_MAIN}`, 'ice-main');
        fs = replaceOnce(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = iceRough;', 'ice-rough');
        fs = replaceOnce(fs, '#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(iceNormal, 0.0)).xyz);', 'ice-normal');
        shader.fragmentShader = fs;
      },
    });
    return material;
  }

  /** Per-frame: advance waves, follow the camera, bind the opaque frame. */
  update(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    time: number,
    scene: { color: THREE.Texture; depth: THREE.Texture },
    light: { direction: THREE.Vector3; color: THREE.Color; intensity: number },
  ): void {
    this.waves.update(renderer, time);
    const u = this.uniforms;
    u.uWaterTime.value = time;
    u.uSeaState.value = this.seaState;
    u.uShoreAmp.value = 0.55 + 0.5 * this.seaState;
    u.uFoamJacobian.value = 0.5 + 0.12 * this.seaState;
    u.uSceneColor.value = scene.color;
    u.uSceneDepth.value = scene.depth;
    u.uCamNear.value = camera.near;
    u.uCamFar.value = camera.far;
    (u.uWaterLightDir.value as THREE.Vector3).copy(light.direction);
    (u.uWaterLightColor.value as THREE.Color).copy(light.color).multiplyScalar(light.intensity);
    const s = this.innerSpacing * 2;
    this.sea.position.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
    this.sea.updateMatrixWorld();
  }

  private infoAt(x: number, z: number): { distance: number; ocean: number } {
    const fi = clamp((x + WORLD_HALF) / INFO_CELL - 0.5, 0, INFO_RES - 1);
    const fj = clamp((z + WORLD_HALF) / INFO_CELL - 0.5, 0, INFO_RES - 1);
    const k = Math.round(fj) * INFO_RES + Math.round(fi);
    return { distance: this.info.distance[k], ocean: this.info.ocean[k] };
  }

  /** Signed distance to the coastline (m): positive over open water, negative inland. */
  shoreDistance(x: number, z: number): number {
    return this.infoAt(x, z).distance;
  }

  /** Water at a world point (for swimming, buoyancy, camera and audio). */
  sample(x: number, z: number, out: WaterSample): WaterSample {
    const ground = this.world.heightAt(x, z);
    const level = this.world.waterLevelAt(x, z);
    out.flowX = 0;
    out.flowZ = 0;
    out.frozen = false;
    out.hot = false;
    out.turbidity = 0.12;
    out.kind = WATER_KIND.sea;
    let surface = level;
    if (level > 0.08) {
      const lake = this.world.lakes.find((l) => Math.abs(l.level - level) < 0.3 && Math.hypot(x - l.x, z - l.z) < l.radius * 1.4 + 22);
      if (lake) {
        out.kind = WATER_KIND.lake;
        out.frozen = lake.frozen;
        out.hot = lake.hot;
        out.turbidity = lakeLook(lake).turbidity;
        this.amplitudes[0] = 0;
        this.amplitudes[1] = lakeLook(lake).chop * 2.4;
        this.amplitudes[2] = 0;
        surface += lake.frozen ? 0 : this.waves.heightAt(x, z, this.amplitudes);
      } else {
        out.kind = WATER_KIND.river;
        out.turbidity = 0.32;
        this.riverFlow(x, z, out);
      }
    } else {
      const info = this.infoAt(x, z);
      const swell = info.ocean * smoothstep(1, 42, info.distance) * this.seaState;
      this.amplitudes[0] = swell;
      this.amplitudes[1] = (info.ocean ? 1 : 0.25) * 2.4;
      this.amplitudes[2] = 0;
      if (!info.ocean) out.turbidity = 0.9;
      surface += this.waves.heightAt(x, z, this.amplitudes);
    }
    out.surface = surface;
    out.depth = surface - ground;
    if (out.depth <= 0) out.surface = -Infinity;
    return out;
  }

  private riverFlow(x: number, z: number, out: WaterSample): void {
    let best = Infinity;
    for (const river of this.world.rivers) {
      const p = river.points;
      for (let i = 0; i < river.count - 1; i += 1) {
        const o = i * 6;
        const d = Math.hypot(x - p[o], z - p[o + 1]);
        if (d < best && d < p[o + 3] + 4) {
          best = d;
          const tx = p[o + 6] - p[o];
          const tz = p[o + 7] - p[o + 1];
          const len = Math.hypot(tx, tz) || 1;
          const slope = Math.max(0, (p[o + 2] - p[o + 8]) / len);
          const speed = clamp(0.8 + slope * 55 + p[o + 5] * 2.5, 0.6, 5);
          out.flowX = (tx / len) * speed;
          out.flowZ = (tz / len) * speed;
        }
      }
    }
  }

  get stats(): { seaTriangles: number; bodies: number } {
    const index = this.sea.geometry.getIndex();
    return { seaTriangles: index ? index.count / 3 : 0, bodies: this.group.children.length };
  }

  dispose(): void {
    this.waves.dispose();
    this.foamTarget.dispose();
    this.info.texture.dispose();
    this.material.dispose();
    this.iceMaterial.dispose();
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
  }
}
