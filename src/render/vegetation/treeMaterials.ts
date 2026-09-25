import * as THREE from 'three';
import { addPatch, replaceOnce } from '../materials/MaterialPatches';
import type { FoliageTextures } from './foliageTextures';

export interface VegetationShared {
  uTime: { value: number };
  uWindDir: { value: THREE.Vector3 };
  uWindStrength: { value: number };
  uSunDirV: { value: THREE.Vector3 };
  uSunColorV: { value: THREE.Color };
}

export function createVegetationShared(sunDir: THREE.Vector3, sunColor: THREE.Color): VegetationShared {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector3(1, 0, 0.3).normalize() },
    uWindStrength: { value: 0.45 },
    uSunDirV: { value: sunDir },
    uSunColorV: { value: sunColor },
  };
}

/** Hierarchical wind: trunk sway ∝ height², branch bob, leaf flutter. */
const WIND_PARS = /* glsl */ `
attribute vec4 aWind; // height01, branch weight, phase, along-branch
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;
vec3 vegetationWind(vec3 p, vec3 n) {
  #ifdef USE_INSTANCING
    vec3 instPos = instanceMatrix[3].xyz;
    vec3 localWind = normalize((vec4(uWindDir, 0.0) * instanceMatrix).xyz);
  #else
    vec3 instPos = vec3(0.0);
    vec3 localWind = uWindDir;
  #endif
  float ph = dot(instPos.xz, vec2(0.037, 0.051));
  float gust = 0.55 + 0.45 * sin(uTime * 0.63 + ph) * sin(uTime * 0.21 + ph * 1.3);
  float h = aWind.x;
  float s = uWindStrength;
  vec3 offset = localWind * (s * gust * h * h * 0.028 * p.y);
  offset += localWind * sin(uTime * 1.3 + ph) * s * h * h * 0.012 * p.y;
  float branch = sin(uTime * 2.1 + aWind.z + ph) * aWind.y * aWind.w * s * 0.16;
  offset.y += branch * 0.6;
  offset += localWind * branch * 0.5;
  float leaf = step(0.7, aWind.y) * sin(uTime * 7.3 + aWind.z * 5.0 + p.x * 3.0 + p.z * 3.0) * s * 0.04;
  offset += n * leaf;
  return p + offset;
}
`;

const COTANGENT = /* glsl */ `
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return mat3(T * invmax, B * invmax, N);
}
`;

/**
 * Far trunks keep about a pixel of width: pushed out along their normals by
 * half a pixel's worth of distance, so a pine on a far ridge still stands on
 * something instead of its crown floating over the skyline.
 */
const BARK_MIN_WIDTH = /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 barkWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
  vec3 barkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  transformed += objectNormal * distance(barkWorld, cameraPosition) * 0.0007;
}
`;

export function createBarkMaterial(shared: VegetationShared, textures: FoliageTextures, barkLayer: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  material.name = `bark-${barkLayer}`;
  const uniforms = {
    ...shared,
    uBark: { value: textures.bark.texture },
    uBarkNormal: { value: textures.barkNormal.texture },
    uBarkLayer: { value: barkLayer },
  };
  addPatch(material, {
    key: 'bark',
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${WIND_PARS}\nvarying vec2 vBarkUv;`, 'bark vpars');
      vs = replaceOnce(vs, '#include <begin_vertex>', `#include <begin_vertex>\ntransformed = vegetationWind(transformed, objectNormal);\nvBarkUv = uv;\n${BARK_MIN_WIDTH}`, 'bark wind');
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = replaceOnce(
        fs,
        '#include <common>',
        `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uBark;\nuniform sampler2DArray uBarkNormal;\nuniform float uBarkLayer;\nvarying vec2 vBarkUv;\n${COTANGENT}`,
        'bark fpars',
      );
      fs = replaceOnce(
        fs,
        '#include <map_fragment>',
        `vec4 barkAlb = texture(uBark, vec3(vBarkUv, uBarkLayer));\nvec4 barkNrm = texture(uBarkNormal, vec3(vBarkUv, uBarkLayer));\ndiffuseColor.rgb = barkAlb.rgb;`,
        'bark map',
      );
      fs = replaceOnce(fs, '#include <roughnessmap_fragment>', 'float roughnessFactor = barkNrm.b;', 'bark rough');
      fs = replaceOnce(
        fs,
        '#include <normal_fragment_maps>',
        `{\n  vec3 tn = vec3(barkNrm.xy * 2.0 - 1.0, 1.0);\n  mat3 tbn = cotangentFrame(normal, -vViewPosition, vBarkUv);\n  normal = normalize(tbn * tn);\n}`,
        'bark normal',
      );
      fs = replaceOnce(
        fs,
        '#include <aomap_fragment>',
        `reflectedLight.indirectDiffuse *= barkNrm.a;\nreflectedLight.indirectSpecular *= barkNrm.a;`,
        'bark ao',
      );
      shader.fragmentShader = fs;
    },
  });
  return material;
}

export function createLeafMaterial(shared: VegetationShared, textures: FoliageTextures, alphaToCoverage: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.62,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaToCoverage,
    transparent: false,
  });
  material.name = 'leaves';
  const uniforms = {
    ...shared,
    uFoliage: { value: textures.foliage.texture },
    uFoliageNormal: { value: textures.foliageNormal.texture },
    uAlphaCoverage: { value: alphaToCoverage ? 1 : 0 },
  };
  addPatch(material, {
    key: `leaves-${alphaToCoverage ? 'a2c' : 'test'}`,
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      let vs = shader.vertexShader;
      vs = replaceOnce(
        vs,
        '#include <common>',
        `#include <common>\n${WIND_PARS}\nattribute float aLayer;\nattribute float aShade;\nvarying vec2 vLeafUv;\nvarying float vLeafLayer;\nvarying float vLeafShade;\nvarying vec3 vLeafWorld;`,
        'leaf vpars',
      );
      vs = replaceOnce(
        vs,
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed = vegetationWind(transformed, objectNormal);\nvLeafUv = uv;\nvLeafLayer = aLayer;\nvLeafShade = aShade;`,
        'leaf wind',
      );
      vs = replaceOnce(
        vs,
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>\n{\n  vec4 lw = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n  lw = instanceMatrix * lw;\n  #endif\n  vLeafWorld = (modelMatrix * lw).xyz;\n}`,
        'leaf world',
      );
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = replaceOnce(
        fs,
        '#include <common>',
        `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uFoliage;\nuniform sampler2DArray uFoliageNormal;\nuniform float uAlphaCoverage;\nuniform vec3 uSunDirV;\nuniform vec3 uSunColorV;\nvarying vec2 vLeafUv;\nvarying float vLeafLayer;\nvarying float vLeafShade;\nvarying vec3 vLeafWorld;`,
        'leaf fpars',
      );
      fs = replaceOnce(
        fs,
        '#include <map_fragment>',
        `vec4 leafTex = texture(uFoliage, vec3(vLeafUv, floor(vLeafLayer + 0.5)));
vec4 leafNrm = texture(uFoliageNormal, vec3(vLeafUv, floor(vLeafLayer + 0.5)));
// Needle and leaf cards are mostly empty, so their mips average the
// alpha away and distant crowns go bare. Give coverage back per mip level.
vec2 leafTexel = vLeafUv * vec2(textureSize(uFoliage, 0).xy);
float leafLod = max(0.0, 0.5 * log2(max(dot(dFdx(leafTexel), dFdx(leafTexel)), dot(dFdy(leafTexel), dFdy(leafTexel)))));
float leafAlpha = clamp(leafTex.a * (1.0 + 0.45 * leafLod), 0.0, 1.0);
if (uAlphaCoverage > 0.5) {
  // Sharpened coverage keeps foliage from thinning out in lower mips.
  leafAlpha = clamp((leafAlpha - 0.45) / max(fwidth(leafAlpha), 1e-4) + 0.5, 0.0, 1.0);
  if (leafAlpha < 0.01) discard;
} else if (leafAlpha < 0.45) discard;
// Leaves deep in the crown are darker: less sky, more leaves in the way.
diffuseColor.rgb = leafTex.rgb * mix(0.55, 1.0, vLeafShade);
diffuseColor.a = leafAlpha;`,
        'leaf map',
      );
      fs = replaceOnce(
        fs,
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nnormal = normalize(normal + vec3((leafNrm.xy - 0.5) * 0.6, 0.0));\nvec3 nonPerturbedNormal = normal;`,
        'leaf normal',
      );
      fs = replaceOnce(
        fs,
        '#include <aomap_fragment>',
        `reflectedLight.indirectDiffuse *= leafNrm.a * vLeafShade;\nreflectedLight.indirectSpecular *= leafNrm.a * 0.6 * vLeafShade;`,
        'leaf ao',
      );
      fs = replaceOnce(
        fs,
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  vec3 viewDirW = normalize(cameraPosition - vLeafWorld);
  float back = pow(clamp(dot(-viewDirW, uSunDirV), 0.0, 1.0), 4.0);
  vec3 trans = diffuseColor.rgb * uSunColorV * (back * 1.6 + 0.12) * leafNrm.b * max(uSunDirV.y, 0.0) * 2.2;
  // Sunlight gets into a crown only in flecks.
  reflectedLight.directDiffuse *= mix(0.4, 1.0, vLeafShade);
  reflectedLight.directSpecular *= vLeafShade;
  reflectedLight.directDiffuse += trans * mix(0.5, 1.0, vLeafShade);
}`,
        'leaf translucency',
      );
      shader.fragmentShader = fs;
    },
  });
  return material;
}

/** Shadow-caster materials that match the wind (and leaf cut-outs). */
export function createVegetationDepthMaterial(shared: VegetationShared, textures: FoliageTextures | null): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: textures ? THREE.DoubleSide : THREE.FrontSide });
  const uniforms = { ...shared, uFoliage: { value: textures?.foliage.texture ?? null } };
  const leaves = Boolean(textures);
  addPatch(material, {
    key: leaves ? 'leaf-depth' : 'bark-depth',
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${WIND_PARS}\n${leaves ? 'attribute float aLayer;\nvarying vec2 vLeafUv;\nvarying float vLeafLayer;' : ''}`, 'depth vpars');
      vs = replaceOnce(
        vs,
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed = vegetationWind(transformed, vec3(0.0, 1.0, 0.0));${leaves ? '\nvLeafUv = uv;\nvLeafLayer = aLayer;' : ''}`,
        'depth wind',
      );
      shader.vertexShader = vs;
      if (leaves) {
        let fs = shader.fragmentShader;
        fs = replaceOnce(fs, '#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uFoliage;\nvarying vec2 vLeafUv;\nvarying float vLeafLayer;`, 'depth fpars');
        fs = replaceOnce(fs, '#include <alphatest_fragment>', `if (texture(uFoliage, vec3(vLeafUv, floor(vLeafLayer + 0.5))).a < 0.5) discard;`, 'depth alpha');
        shader.fragmentShader = fs;
      }
    },
  });
  return material;
}
