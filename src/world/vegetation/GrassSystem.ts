import * as THREE from 'three';
import { addPatch, replaceOnce } from '../../render/materials/MaterialPatches';
import type { WorldData } from '../WorldData';
import { HEIGHT_RES, WORLD_HALF, WORLD_SIZE } from '../WorldConfig';

export interface GrassOptions {
  radius: number;
  density: number;
}

interface GrassPatch {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  side: number;
  spacing: number;
  inner: number;
  outer: number;
}

/** Per-biome grass: density (0..1), height range (m), dry fraction, reed-ness. */
const BIOME_GRASS = /* glsl */ `
// density, minH, maxH, dryness
const vec4 GRASS_BIOME[8] = vec4[8](
  vec4(1.00, 0.28, 0.95, 0.25), // Greensward: lush meadow, tall patches
  vec4(0.35, 0.18, 0.45, 0.15), // Hollowpine: sparse understory
  vec4(0.75, 0.22, 0.60, 0.10), // Glasswood
  vec4(0.80, 0.18, 0.55, 0.55), // Coast heath
  vec4(0.10, 0.12, 0.30, 0.90), // Cinderreach: a few dead tufts
  vec4(0.55, 0.10, 0.30, 0.60), // Frostveil alpine
  vec4(0.90, 0.60, 1.60, 0.35), // Drownfen reeds
  vec4(0.70, 0.18, 0.55, 0.70)  // Rim: dry gold
);
`;

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec2 aCell;          // integer cell offset from the patch center
attribute vec4 aBlade;         // per-blade in tuft: offset x/z, yaw offset, height scale
uniform sampler2D uHeightTex;
uniform sampler2D uTerrainNormal;
uniform sampler2D uBiomeA;
uniform sampler2D uBiomeB;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uWaterLevel;
uniform vec3 uGrassCenter;     // snapped patch center (xz) + camera y
uniform float uSpacing;
uniform float uInner;
uniform float uOuter;
uniform float uDensityScale;
uniform float uTime;
uniform vec3 uWind;            // dir.xy, strength
uniform vec4 uPushers[4];      // xyz position, w radius
varying vec3 vGrassColor;
varying float vGrassT;
varying float vGrassDry;
${BIOME_GRASS}

float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 gHash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Same value noise the terrain shader uses, so grass dryness matches the ground.
float tHashG(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tNoiseG(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHashG(i), tHashG(i + vec2(1.0, 0.0)), u.x), mix(tHashG(i + vec2(0.0, 1.0)), tHashG(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tFbmG(vec2 p) { return tNoiseG(p) * 0.5 + tNoiseG(p * 2.03 + 7.1) * 0.3 + tNoiseG(p * 4.1 - 3.7) * 0.2; }

float grassGroundHeight(vec2 w) {
  vec2 f = clamp(w + ${WORLD_HALF.toFixed(1)}, vec2(0.0), vec2(${(HEIGHT_RES - 1.001).toFixed(3)}));
  ivec2 i = ivec2(floor(f));
  vec2 t = f - vec2(i);
  float ha = texelFetch(uHeightTex, i, 0).r;
  float hb = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float hc = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r;
  float hd = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  if (t.x + t.y <= 1.0) return ha + (hb - ha) * t.x + (hc - ha) * t.y;
  return hd + (hc - hd) * (1.0 - t.x) + (hb - hd) * (1.0 - t.y);
}
`;

const GRASS_BEGIN_VERTEX = /* glsl */ `
  // World cell of this blade: stable as the patch recenters.
  vec2 cellWorld = floor(uGrassCenter.xz / uSpacing) + aCell;
  vec2 jitter = gHash2(cellWorld * 1.37 + 0.5);
  vec2 baseXZ = (cellWorld + jitter) * uSpacing;
  float rnd = gHash(cellWorld * 0.73 + 11.0);
  float rnd2 = gHash(cellWorld * 1.91 - 7.0);
  float distXZ = distance(baseXZ, cameraPosition.xz);
  float tuftYaw = rnd * 37.0;
  vec2 tuftAxis = vec2(cos(tuftYaw), sin(tuftYaw));
  mat2 tuftRot = mat2(tuftAxis.x, tuftAxis.y, -tuftAxis.y, tuftAxis.x);
  vec2 bladeOffset = tuftRot * aBlade.xy * mix(1.0, 1.6, smoothstep(uOuter * 0.3, uOuter, distXZ));
  baseXZ += bladeOffset;

  vec2 fUv = (baseXZ + ${WORLD_HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
  vec2 nUv = (baseXZ + ${WORLD_HALF.toFixed(1)} + 0.5) / ${HEIGHT_RES.toFixed(1)};
  vec4 bA = textureLod(uBiomeA, fUv, 0.0);
  vec4 bB = textureLod(uBiomeB, fUv, 0.0);
  vec4 mA = textureLod(uMaskA, fUv, 0.0);
  vec4 mB = textureLod(uMaskB, fUv, 0.0);
  vec3 tn = normalize(textureLod(uTerrainNormal, nUv, 0.0).xyz * 2.0 - 1.0);
  float waterLevel = textureLod(uWaterLevel, fUv, 0.0).r;

  float weights[8] = float[8](bA.r, bA.g, bA.b, bA.a, bB.r, bB.g, bB.b, bB.a);
  vec4 gp = vec4(0.0);
  for (int b = 0; b < 8; b++) gp += GRASS_BIOME[b] * weights[b];
  float slope = 1.0 - tn.y;
  float patches = smoothstep(0.25, 0.65, gNoise(baseXZ * 0.07) * 0.7 + gNoise(baseXZ * 0.23) * 0.3);
  float density = gp.x * uDensityScale;
  density *= 1.0 - smoothstep(0.2, 0.34, slope);
  density *= 1.0 - smoothstep(0.25, 0.6, mA.r);  // paths
  density *= 1.0 - mA.g;                          // sand
  density *= 1.0 - mB.a;                          // snow
  density *= 1.0 - smoothstep(0.4, 0.9, mB.g) * 0.8; // eroded gravel
  density *= mix(0.55, 1.0, patches);
  // Grass thins in the shade of a closed canopy.
  density *= 1.0 - smoothstep(0.2, 0.9, mB.b) * 0.7;

  float ground = grassGroundHeight(baseXZ);
  float submerged = waterLevel - ground;
  bool reed = bB.b > 0.45;
  if (!reed) density *= 1.0 - smoothstep(-0.25, 0.05, submerged);
  else density *= 1.0 - smoothstep(0.6, 1.2, submerged);

  // Distance thinning (compensated by width) and patch ring bounds.
  float ringFade = smoothstep(uOuter, uOuter * 0.82, distXZ) * smoothstep(uInner - 1.5, uInner, distXZ);
  float thin = mix(1.0, 0.55, smoothstep(uOuter * 0.4, uOuter, distXZ));
  bool alive = rnd < density * thin && ringFade > 0.0;

  float bladeH = mix(gp.y, gp.z, pow(rnd2, 1.4)) * mix(0.7, 1.2, patches) * aBlade.w * ringFade;
  float widthScale = mix(1.0, 1.7, smoothstep(uOuter * 0.3, uOuter, distXZ)) * (reed ? 1.4 : 1.0);
  float yaw = tuftYaw + aBlade.z;
  vec2 facing = vec2(cos(yaw), sin(yaw));
  vec2 outward = length(bladeOffset) > 1e-4 ? normalize(bladeOffset) : facing;

  // Wind: travelling gusts plus per-blade flutter.
  vec2 windDir = normalize(uWind.xy + 1e-4);
  float gust = gNoise(baseXZ * 0.045 - windDir * uTime * 0.9) * 0.75 + gNoise(baseXZ * 0.17 - windDir * uTime * 2.1) * 0.25;
  float flutter = sin(uTime * (2.2 + rnd * 2.5) + rnd * 40.0) * 0.12;
  float windBend = uWind.z * (0.25 + 0.95 * gust) + flutter * uWind.z;
  vec2 bendDir = normalize(windDir + facing * 0.35);
  float lean = 0.18 + rnd2 * 0.35;

  // Push away from nearby movers (player, creatures).
  vec2 push = vec2(0.0);
  for (int p = 0; p < 4; p++) {
    vec4 pu = uPushers[p];
    if (pu.w <= 0.0) continue;
    vec2 d = baseXZ - pu.xz;
    float dl = length(d);
    float k = (1.0 - smoothstep(pu.w * 0.4, pu.w, dl)) * (1.0 - smoothstep(0.5, 2.0, abs(ground - pu.y)));
    push += d / max(dl, 1e-3) * k * 1.4;
  }
  float t = position.y;
  vec2 totalBend = bendDir * windBend + outward * lean + push;
  float bendLen = length(totalBend);
  vec2 bendXZ = totalBend / max(bendLen, 1e-4);
  // Bend along a circular arc: tip angle theta, arc radius H/theta.
  float theta = clamp(bendLen, 1e-3, 1.35);
  float arcR = bladeH / theta;
  float horiz = arcR * (1.0 - cos(theta * t));
  float vert = arcR * sin(theta * t);
  vec2 side = vec2(-facing.y, facing.x);
  vec3 transformed = vec3(baseXZ.x, ground, baseXZ.y);
  transformed.xz += side * position.x * widthScale + bendXZ * horiz;
  transformed.y += vert;
  if (!alive) transformed = vec3(0.0, -1e5, 0.0);
  // Soft normal: mostly sky-facing, tilted with the blade's face and bend.
  vec3 gN = normalize(vec3(0.0, 1.0, 0.0) + vec3(facing.x, 0.0, facing.y) * 0.35 + vec3(bendXZ.x, 0.0, bendXZ.y) * (0.25 * t));
  // Blades are folded along the midrib: each half faces its own way, so
  // one catches the light and the other doesn't.
  float across = position.x > 0.0 ? 1.0 : (position.x < 0.0 ? -1.0 : 0.0);
  gN = normalize(gN + vec3(side.x, 0.0, side.y) * across * 0.55);
  vNormal = normalize(normalMatrix * gN);

  // Color: root to tip, fresh to dry, per-blade variation.
  float nB = smoothstep(0.3, 0.7, tFbmG(baseXZ * 0.012 + 11.0) * 0.7 + tNoiseG(baseXZ * 0.09) * 0.3);
  float dry = clamp(gp.w * 0.6 + nB * 0.55 + (rnd2 - 0.5) * 0.3, 0.0, 1.0);
  float bladeVar = gHash(cellWorld * 3.1 + aBlade.z * 7.0);
  vec3 fresh = mix(vec3(0.09, 0.19, 0.035), vec3(0.24, 0.38, 0.08), bladeVar);
  vec3 parched = mix(vec3(0.34, 0.27, 0.11), vec3(0.55, 0.44, 0.2), bladeVar);
  vec3 glass = vec3(0.2, 0.3, 0.28);
  vec3 tint = mix(fresh, parched, dry);
  tint = mix(tint, glass, bA.b * 0.5);
  vGrassColor = tint;
  vGrassT = t;
  vGrassDry = dry;
`;

const GRASS_NORMAL_VERTEX = /* glsl */ `
  vec3 objectNormal = vec3(0.0, 1.0, 0.0); // replaced per blade in begin_vertex
`;

// Blades are two-sided but keep their sky-leaning normal on both faces.
const GRASS_NORMAL_FRAGMENT = /* glsl */ `
  float faceDirection = 1.0;
  vec3 normal = normalize(vNormal);
  vec3 nonPerturbedNormal = normal;
`;

const GRASS_FRAGMENT_PARS = /* glsl */ `
varying vec3 vGrassColor;
varying float vGrassT;
varying float vGrassDry;
uniform vec3 uSunDirG;
uniform vec3 uSunColorG;
`;

const GRASS_COLOR_FRAGMENT = /* glsl */ `
  diffuseColor.rgb = vGrassColor * mix(0.35, 1.0, smoothstep(0.0, 0.7, vGrassT));
`;

const GRASS_TRANSLUCENCY = /* glsl */ `
  // Backlit blades glow: light through thin leaves toward the viewer.
  {
    vec3 viewDirW = normalize(cameraPosition - vGrassWorld);
    float back = pow(clamp(dot(-viewDirW, uSunDirG), 0.0, 1.0), 3.0);
    float scatter = back * 0.55 + 0.08;
    vec3 trans = diffuseColor.rgb * uSunColorG * scatter * smoothstep(0.1, 1.0, vGrassT) * (1.0 - vGrassDry * 0.4);
    reflectedLight.directDiffuse += trans * max(uSunDirG.y, 0.0) * 2.4;
  }
`;

export class GrassSystem {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly patches: GrassPatch[] = [];
  private readonly center = new THREE.Vector3();

  constructor(
    private readonly world: WorldData,
    sharedSun: { dir: THREE.Vector3; color: THREE.Color },
    private options: GrassOptions,
  ) {
    const pushers = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
    this.uniforms = {
      uHeightTex: { value: world.heightTexture },
      uTerrainNormal: { value: world.normalTexture },
      uBiomeA: { value: world.biomeTextureA },
      uBiomeB: { value: world.biomeTextureB },
      uMaskA: { value: world.maskTextureA },
      uMaskB: { value: world.maskTextureB },
      uWaterLevel: { value: world.waterTexture },
      uGrassCenter: { value: new THREE.Vector3() },
      uSpacing: { value: 0.2 },
      uInner: { value: 0 },
      uOuter: { value: 20 },
      uDensityScale: { value: 1 },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(1, 0.3, 0.35) },
      uPushers: { value: pushers },
      uSunDirG: { value: sharedSun.dir },
      uSunColorG: { value: sharedSun.color },
    };
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
    this.material.name = 'grass';
    this.build();
  }

  private build(): void {
    for (const p of this.patches) {
      this.group.remove(p.mesh);
      p.geometry.dispose();
    }
    this.patches.length = 0;
    const density = Math.max(0.15, this.options.density);
    const nearOuter = Math.min(18, this.options.radius * 0.4);
    this.addPatch(0.34 / Math.sqrt(density), 0, nearOuter, 3, 0.034, 9);
    this.addPatch(0.8 / Math.sqrt(density), nearOuter, this.options.radius, 1, 0.08, 4);
  }

  private addPatch(spacing: number, inner: number, outer: number, segments: number, width: number, blades: number): void {
    const cells = Math.ceil(outer / spacing);
    const offsets: number[] = [];
    for (let z = -cells; z <= cells; z += 1) {
      for (let x = -cells; x <= cells; x += 1) {
        const d = Math.hypot(x * spacing, z * spacing);
        if (d > outer + spacing * 2 || d < inner - spacing * 3) continue;
        offsets.push(x, z);
      }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    const positions: number[] = [];
    const bladeAttr: number[] = [];
    const indices: number[] = [];
    const golden = 2.39996;
    for (let b = 0; b < blades; b += 1) {
      const base = positions.length / 3;
      const angle = b * golden + 0.37;
      const radius = blades === 1 ? 0 : 0.025 + 0.11 * Math.sqrt((b + 0.5) / blades);
      const ox = Math.cos(angle) * radius;
      const oz = Math.sin(angle) * radius;
      const yawOffset = angle + 1.3 * ((b * 0.618) % 1);
      const heightScale = 0.62 + 0.45 * (((b * 0.7548) % 1) ** 1.3) + (b === 0 ? 0.25 : 0);
      for (let sgm = 0; sgm <= segments; sgm += 1) {
        const t = sgm / segments;
        const w = width * (1 - Math.pow(t, 1.3) * 0.9) * 0.5;
        positions.push(-w, t, 0, w, t, 0);
        bladeAttr.push(ox, oz, yawOffset, heightScale, ox, oz, yawOffset, heightScale);
        if (sgm < segments) {
          const a = base + sgm * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      positions.push(0, 1.05, 0);
      bladeAttr.push(ox, oz, yawOffset, heightScale);
      const tip = base + (segments + 1) * 2;
      indices.push(base + segments * 2, base + segments * 2 + 1, tip);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aBlade', new THREE.Float32BufferAttribute(bladeAttr, 4));
    // A normal attribute keeps Three from forcing FLAT_SHADED (which drops vNormal).
    const normals = new Float32Array(positions.length);
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 2));
    geometry.instanceCount = offsets.length / 2;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const material = this.material.clone();
    const uniforms = { ...this.uniforms, uSpacing: { value: spacing }, uInner: { value: inner }, uOuter: { value: outer } };
    addPatch(material, {
      key: 'grass',
      apply(shader) {
        Object.assign(shader.uniforms, uniforms);
        let vs = shader.vertexShader;
        vs = replaceOnce(vs, '#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}\nvarying vec3 vGrassWorld;`, 'grass pars');
        vs = replaceOnce(vs, '#include <beginnormal_vertex>', GRASS_NORMAL_VERTEX, 'grass normal');
        vs = replaceOnce(vs, '#include <begin_vertex>', `${GRASS_BEGIN_VERTEX}\n vGrassWorld = transformed;`, 'grass begin');
        shader.vertexShader = vs;
        let fs = shader.fragmentShader;
        fs = replaceOnce(fs, '#include <common>', `#include <common>\n${GRASS_FRAGMENT_PARS}\nvarying vec3 vGrassWorld;`, 'grass frag pars');
        // No grass over the open mouth of a cave.
        fs = replaceOnce(fs, '#include <map_fragment>', `#ifdef USE_FOG\nif (atmoCaveInside(vGrassWorld) > 0.5) discard;\n#endif\n${GRASS_COLOR_FRAGMENT}`, 'grass color');
        fs = replaceOnce(fs, '#include <normal_fragment_begin>', GRASS_NORMAL_FRAGMENT, 'grass normal frag');
        fs = replaceOnce(fs, '#include <lights_fragment_end>', `#include <lights_fragment_end>\n${GRASS_TRANSLUCENCY}`, 'grass translucency');
        shader.fragmentShader = fs;
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `grass-${inner}`;
    // Before the terrain, so blades hide the ground they stand on from its shader.
    mesh.renderOrder = -25;
    this.group.add(mesh);
    this.patches.push({ mesh, geometry, side: cells, spacing, inner, outer });
  }

  /** Materials that should receive cascaded shadows. */
  get materials(): THREE.Material[] {
    return this.patches.map((p) => p.mesh.material as THREE.Material);
  }

  setOptions(options: GrassOptions): void {
    this.options = options;
    this.build();
  }

  setPusher(index: number, position: THREE.Vector3 | null, radius = 1.1): void {
    const v = (this.uniforms.uPushers.value as THREE.Vector4[])[index];
    if (!position) v.set(0, 0, 0, 0);
    else v.set(position.x, position.y, position.z, radius);
  }

  setWind(dirX: number, dirZ: number, strength: number): void {
    (this.uniforms.uWind.value as THREE.Vector3).set(dirX, dirZ, strength);
  }

  update(camera: THREE.Camera, time: number): void {
    this.center.set(camera.position.x, camera.position.y, camera.position.z);
    this.uniforms.uTime.value = time;
    (this.uniforms.uGrassCenter.value as THREE.Vector3).copy(this.center);
  }

  get worldData(): WorldData {
    return this.world;
  }
}
