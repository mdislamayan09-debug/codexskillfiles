import * as THREE from 'three';
import { LAYER, LAYER_TILE_METERS } from '../terrain/terrainLayers';
import { addPatch, replaceOnce } from '../materials/MaterialPatches';
import type { TerrainMaterialBaker } from '../terrain/TerrainMaterialBaker';

// Materials for rocks and small props. Rocks sample the same baked ground
// layers as terrain cliffs (triplanar, world space) so boulders, scree and
// rock faces read as one geology; moss, snow and lichen settle on top by
// orientation and biome.

const ROCK_VERTEX_PARS = /* glsl */ `
attribute float aAo;
attribute vec4 aRock;
varying vec3 vRockPos;
varying vec3 vRockN;
varying float vRockAo;
varying vec4 vRockParams;
`;

const ROCK_VERTEX = /* glsl */ `
{
  mat4 rockModel = modelMatrix;
#ifdef USE_INSTANCING
  rockModel = modelMatrix * instanceMatrix;
#endif
  vRockPos = (rockModel * vec4(transformed, 1.0)).xyz;
  vRockN = normalize(mat3(rockModel) * objectNormal);
  vRockAo = aAo;
  vRockParams = aRock;
}
`;

const ROCK_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uGroundAlbedo;
uniform sampler2DArray uGroundNormal;
uniform float uRockTile;
varying vec3 vRockPos;
varying vec3 vRockN;
varying float vRockAo;
varying vec4 vRockParams;

float rockHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float rockNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x), mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x), mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Triplanar sample of one ground layer: albedo+height, normal (world), roughness, cavity.
void rockTriplanar(float layer, vec3 P, vec3 N, float tile, out vec4 albedo, out vec3 wn, out vec2 ra) {
  vec3 w = pow(abs(N), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec2 uvX = P.zy / tile;
  vec2 uvY = P.xz / tile;
  vec2 uvZ = P.xy / tile;
  vec4 aX = texture(uGroundAlbedo, vec3(uvX, layer));
  vec4 aY = texture(uGroundAlbedo, vec3(uvY, layer));
  vec4 aZ = texture(uGroundAlbedo, vec3(uvZ, layer));
  albedo = aX * w.x + aY * w.y + aZ * w.z;
  vec4 nX = texture(uGroundNormal, vec3(uvX, layer));
  vec4 nY = texture(uGroundNormal, vec3(uvY, layer));
  vec4 nZ = texture(uGroundNormal, vec3(uvZ, layer));
  // Whiteout-blended tangent normals swizzled into world space.
  vec2 tX = nX.xy * 2.0 - 1.0;
  vec2 tY = nY.xy * 2.0 - 1.0;
  vec2 tZ = nZ.xy * 2.0 - 1.0;
  vec3 wX = vec3(tX.xy + N.zy, abs(N.x));
  vec3 wY = vec3(tY.xy + N.xz, abs(N.y));
  vec3 wZ = vec3(tZ.xy + N.xy, abs(N.z));
  vec3 s = sign(N);
  wn = normalize(vec3(wX.z * s.x, wX.y, wX.x) * w.x + vec3(wY.x, wY.z * s.y, wY.y) * w.y + vec3(wZ.x, wZ.y, wZ.z * s.z) * w.z);
  ra = nX.ba * w.x + nY.ba * w.y + nZ.ba * w.z;
}
`;

const ROCK_FRAGMENT = /* glsl */ `
vec3 rockN = normalize(vRockN);
float rockLayer = vRockParams.x;
float rockMoss = vRockParams.y;
float rockSnow = vRockParams.z;
float rockTint = vRockParams.w;
vec4 rAlb; vec3 rN; vec2 rRA;
rockTriplanar(rockLayer, vRockPos, rockN, uRockTile, rAlb, rN, rRA);
vec3 rockAlbedo = rAlb.rgb;
float rockRough = rRA.x;
float rockCav = rRA.y;
// Mineral banding and colour drift.
float band = rockNoise(vec3(vRockPos.x * 0.35, vRockPos.y * 3.2, vRockPos.z * 0.35));
rockAlbedo *= mix(vec3(0.92, 0.95, 1.0), vec3(1.08, 1.02, 0.94), band * 0.6 + rockTint * 0.4);
// Lichen rosettes on exposed faces.
float lich = smoothstep(0.72, 0.82, rockNoise(vRockPos * 2.3 + 11.0)) * smoothstep(-0.2, 0.6, rockN.y) * (1.0 - rockSnow);
rockAlbedo = mix(rockAlbedo, mix(vec3(0.55, 0.52, 0.28), vec3(0.62, 0.36, 0.12), step(0.5, rockHash(floor(vRockPos * 2.3)))), lich * 0.55);
// Moss drapes over the tops in damp biomes.
float mossMask = rockMoss * smoothstep(0.15, 0.75, rockN.y + (rockNoise(vRockPos * 1.3) - 0.5) * 0.7);
if (mossMask > 0.01) {
  vec4 mA; vec3 mN; vec2 mRA;
  rockTriplanar(${LAYER.moss.toFixed(1)}, vRockPos, rockN, 1.6, mA, mN, mRA);
  rockAlbedo = mix(rockAlbedo, mA.rgb, mossMask);
  rN = normalize(mix(rN, mN, mossMask));
  rockRough = mix(rockRough, mRA.x, mossMask);
}
float snowMask = rockSnow * smoothstep(0.35, 0.7, rockN.y + (rockNoise(vRockPos * 0.9) - 0.5) * 0.4);
if (snowMask > 0.01) {
  rockAlbedo = mix(rockAlbedo, vec3(0.88, 0.91, 0.95), snowMask);
  rN = normalize(mix(rN, rockN, snowMask * 0.7));
  rockRough = mix(rockRough, 0.55, snowMask);
}
float rockOcc = vRockAo * mix(1.0, rockCav, 0.7);
diffuseColor.rgb = rockAlbedo;
`;

export function createRockMaterial(baker: TerrainMaterialBaker): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  material.name = 'rock';
  const uniforms = {
    uGroundAlbedo: { value: baker.albedoHeight.texture },
    uGroundNormal: { value: baker.normalRough.texture },
    uRockTile: { value: 2.6 },
  };
  addPatch(material, {
    key: 'rock-v1',
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${ROCK_VERTEX_PARS}`, 'rock-vpars');
      vs = replaceOnce(vs, '#include <project_vertex>', `#include <project_vertex>\n${ROCK_VERTEX}`, 'rock-vertex');
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = replaceOnce(fs, '#include <common>', `#include <common>\n${ROCK_FRAGMENT_PARS}`, 'rock-fpars');
      fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${ROCK_FRAGMENT}`, 'rock-main');
      fs = replaceOnce(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(rockRough, 0.3, 1.0);', 'rock-rough');
      fs = replaceOnce(fs, '#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(rN, 0.0)).xyz);', 'rock-normal');
      fs = replaceOnce(
        fs,
        '#include <aomap_fragment>',
        `reflectedLight.indirectDiffuse *= rockOcc;\nreflectedLight.indirectSpecular *= rockOcc;\nreflectedLight.directDiffuse *= mix(1.0, rockOcc, 0.5);`,
        'rock-ao',
      );
      shader.fragmentShader = fs;
    },
  });
  return material;
}

/** Rock layer ids for the aRock attribute. */
export const ROCK_LAYERS = {
  granite: LAYER.granite,
  basalt: LAYER.basalt,
  limestone: LAYER.limestone,
} as const;

export const ROCK_TILE = LAYER_TILE_METERS[LAYER.granite];

// ---------------------------------------------------------------------------
// Small props: vertex-coloured PBR with a little procedural grain.

const PROP_VERTEX_PARS = /* glsl */ `
varying vec3 vPropPos;
`;

const PROP_VERTEX = /* glsl */ `
{
  mat4 propModel = modelMatrix;
#ifdef USE_INSTANCING
  propModel = modelMatrix * instanceMatrix;
#endif
  vPropPos = (propModel * vec4(transformed, 1.0)).xyz;
}
`;

const PROP_FRAGMENT_PARS = /* glsl */ `
varying vec3 vPropPos;
float propHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float propNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(propHash(i), propHash(i + vec3(1, 0, 0)), f.x), mix(propHash(i + vec3(0, 1, 0)), propHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(propHash(i + vec3(0, 0, 1)), propHash(i + vec3(1, 0, 1)), f.x), mix(propHash(i + vec3(0, 1, 1)), propHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const PROP_FRAGMENT = /* glsl */ `
float propGrain = propNoise(vPropPos * 38.0) * 0.6 + propNoise(vPropPos * 9.0) * 0.4;
diffuseColor.rgb *= 0.82 + 0.36 * propGrain;
`;

export function createPropMaterial(options: { roughness?: number; side?: THREE.Side; metalness?: number } = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
  });
  material.name = 'prop';
  addPatch(material, {
    key: 'prop-v1',
    apply(shader) {
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${PROP_VERTEX_PARS}`, 'prop-vpars');
      vs = replaceOnce(vs, '#include <project_vertex>', `#include <project_vertex>\n${PROP_VERTEX}`, 'prop-vertex');
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = replaceOnce(fs, '#include <common>', `#include <common>\n${PROP_FRAGMENT_PARS}`, 'prop-fpars');
      fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${PROP_FRAGMENT}`, 'prop-main');
      shader.fragmentShader = fs;
    },
  });
  return material;
}
