import * as THREE from 'three';
import { AERIAL_SAMPLE } from '../atmosphere/atmosphereGlsl';
import { CLOUD_SHADOW_GLSL, CLOUD_UNIFORMS } from '../clouds/cloudGlsl';

// Every lit or fogged material in STILLWILD runs through this module:
//  * the fog chunks are replaced with physically based aerial perspective
//    (froxel LUT) plus exponential height fog, shared by reference so one
//    uniform update reaches every material;
//  * material-specific shader patches (wind, terrain, dissolve…) compose in a
//    deterministic order with a matching program cache key;
//  * cascaded shadow setup (CSM) is chained rather than overwritten.

export type ShaderObject = THREE.WebGLProgramParametersWithUniforms;

export interface ShaderPatch {
  key: string;
  apply(shader: ShaderObject, material: THREE.Material): void;
}

/** Shared uniform objects. Assigned once by `installAtmosphereChunks`. */
export const sharedUniforms: Record<string, THREE.IUniform> = {};

/**
 * Caves (see world/Caves): spheres along the active cave where sun and sky
 * cannot reach. Registered up front so every program gets them.
 */
export const CAVE_SPHERES = 28;
sharedUniforms.uCaveSpheres = { value: Array.from({ length: CAVE_SPHERES }, () => new THREE.Vector4()) };
sharedUniforms.uCaveWeights = { value: new Array<number>(CAVE_SPHERES).fill(0) };
sharedUniforms.uCaveCount = { value: 0 };
/**
 * Texture LOD bias: while the scene renders below the display's resolution
 * (dynamic resolution, temporal upscaling), textures are sampled as sharp as
 * the display needs, not as blurry as the smaller render would pick.
 */
sharedUniforms.uMipBias = { value: 0 };

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmoViewPos;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vAtmoViewPos = mvPosition.xyz;
#endif
`;

export const ATMO_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uAerialLUT;
uniform float uAerialMaxDistance;
uniform float uAerialIntensity;
uniform vec2 uResolution;
uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform vec3 uFogColorAmbient;
uniform vec3 uFogColorSun;
uniform vec3 uLightDir;
uniform vec4 uCaveSpheres[${CAVE_SPHERES}];
uniform float uCaveWeights[${CAVE_SPHERES}];
uniform int uCaveCount;
${CLOUD_UNIFORMS}
${AERIAL_SAMPLE}
${CLOUD_SHADOW_GLSL}

// How deep inside a cave a point is: 0 outside .. 1 far from daylight.
float atmoCaveDark(vec3 worldPos) {
  float dark = 0.0;
  for (int i = 0; i < ${CAVE_SPHERES}; i++) {
    if (i >= uCaveCount) break;
    vec4 s = uCaveSpheres[i];
    vec3 e = worldPos - s.xyz;
    float d = length(vec3(e.x, e.y / 0.75, e.z));
    dark = max(dark, uCaveWeights[i] * (1.0 - smoothstep(s.w * 1.35, s.w * 1.7, d)));
  }
  return dark;
}

// Inside the open volume of a cave (the terrain is cut away here).
float atmoCaveInside(vec3 worldPos) {
  for (int i = 0; i < ${CAVE_SPHERES}; i++) {
    if (i >= uCaveCount) break;
    vec4 s = uCaveSpheres[i];
    // Mouth spheres reach a little wider so the hillside opens cleanly;
    // nothing below the tunnel floor is ever cut.
    vec3 e = worldPos - s.xyz;
    if (length(vec3(e.x, e.y / 0.75, e.z)) < s.w * 1.02 && worldPos.y > s.y - s.w * 0.8) return 1.0;
  }
  return 0.0;
}

// Direct sun/moon visibility beyond shadow maps: moving cloud shadows, and
// no sun at all underground.
float atmoSunVisibility(vec3 viewPos) {
  vec3 worldPos = (viewPos - viewMatrix[3].xyz) * mat3(viewMatrix);
  return atmoCloudShadow(worldPos, uLightDir) * (1.0 - atmoCaveDark(worldPos));
}

float atmoPhaseHG(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

// Exponential height fog integrated along the view ray.
float atmoHeightFog(vec3 camPos, vec3 worldPos, float dist) {
  if (uFogDensity <= 0.0) return 0.0;
  float dy = worldPos.y - camPos.y;
  float base = uFogDensity * exp(-uFogFalloff * (camPos.y - uFogHeight));
  float k = uFogFalloff * dy;
  float integral = abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0;
  return 1.0 - exp(-base * dist * integral);
}

vec3 applyAtmosphere(vec3 color, vec3 viewPos) {
  float dist = length(viewPos);
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec4 ap = sampleAerialLUT(uAerialLUT, suv, dist, uAerialMaxDistance);
  vec3 worldPos = (viewPos - viewMatrix[3].xyz) * mat3(viewMatrix);
  float cave = atmoCaveDark(worldPos);
  color = color * mix(ap.a, 1.0, cave) + ap.rgb * uAerialIntensity * (1.0 - cave);
  vec3 rayDir = normalize(worldPos - cameraPosition);
  float fog = atmoHeightFog(cameraPosition, worldPos, dist) * (1.0 - cave);
  vec3 fogColor = uFogColorAmbient + uFogColorSun * atmoPhaseHG(dot(rayDir, uSunDir), 0.55) * 4.0;
  return mix(color, fogColor, fog);
}
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmoViewPos;
  ${ATMO_FRAGMENT_PARS}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vAtmoViewPos);
#endif
`;

const ATMO_UNIFORM_NAMES = [
  'uAerialLUT',
  'uAerialMaxDistance',
  'uAerialIntensity',
  'uResolution',
  'uSunDir',
  'uFogDensity',
  'uFogHeight',
  'uFogFalloff',
  'uFogColorAmbient',
  'uFogColorSun',
  'uLightDir',
  'uCaveSpheres',
  'uCaveWeights',
  'uCaveCount',
  'uCloudWeather',
  'uCloudOffset',
  'uCloudWeatherScale',
  'uCloudCoverage',
  'uCloudBottom',
  'uCloudTop',
  'uCloudType',
  'uMipBias',
];

export function injectSharedUniforms(shader: ShaderObject, names: readonly string[] = ATMO_UNIFORM_NAMES): void {
  for (const name of names) {
    const uniform = sharedUniforms[name];
    if (uniform) shader.uniforms[name] = uniform;
  }
}

let installed = false;

/** Samples every built-in material map with `uMipBias` (see sharedUniforms). */
function installMipBias(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.common = `${chunks.common}
uniform float uMipBias;
`;
  const maps: [string, string][] = [
    ['map_fragment', 'texture2D( map, vMapUv )'],
    ['normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )'],
    ['roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )'],
    ['metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )'],
    ['emissivemap_fragment', 'texture2D( emissiveMap, vEmissiveMapUv )'],
    ['aomap_fragment', 'texture2D( aoMap, vAoMapUv )'],
  ];
  for (const [name, call] of maps) {
    if (!chunks[name].includes(call)) throw new Error(`Mip bias: ${name} changed (Three.js upgrade?)`);
    chunks[name] = chunks[name].split(call).join(call.replace(' )', ', uMipBias )'));
  }
}

/**
 * Replaces Three's fog with aerial perspective + height fog for every
 * built-in material and makes sure every program receives the shared uniforms.
 */
export function installAtmosphereChunks(uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(sharedUniforms, uniforms);
  if (installed) return;
  installed = true;
  installMipBias();
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
  // Sky light and reflections fade out inside caves too.
  THREE.ShaderChunk.lights_fragment_end += `
#ifdef USE_FOG
{
  vec3 caveWorld = (geometryPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
  float caveK = 1.0 - 0.95 * atmoCaveDark(caveWorld);
  reflectedLight.indirectDiffuse *= caveK;
  reflectedLight.indirectSpecular *= caveK;
}
#endif
`;
  // Default hook for materials without their own patches.
  THREE.Material.prototype.onBeforeCompile = function onBeforeCompile(shader: ShaderObject) {
    injectSharedUniforms(shader);
  };
}

interface PatchState {
  patches: ShaderPatch[];
  csmHook?: (shader: ShaderObject, renderer: THREE.WebGLRenderer) => void;
}

const patchStates = new WeakMap<THREE.Material, PatchState>();

function rebuildHook(material: THREE.Material, state: PatchState): void {
  material.onBeforeCompile = (shader, renderer) => {
    state.csmHook?.call(material, shader, renderer);
    injectSharedUniforms(shader);
    for (const patch of state.patches) patch.apply(shader, material);
  };
  const key = state.patches.map((p) => p.key).join('|') + (state.csmHook ? '|csm' : '');
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
}

/** Adds a shader patch to a material (idempotent per key). */
export function addPatch(material: THREE.Material, patch: ShaderPatch): void {
  let state = patchStates.get(material);
  if (!state) {
    state = { patches: [] };
    patchStates.set(material, state);
  }
  if (state.patches.some((p) => p.key === patch.key)) return;
  state.patches.push(patch);
  rebuildHook(material, state);
}

/** Captures the hook CSM.setupMaterial installed so later patches chain it. */
export function adoptCsmHook(material: THREE.Material): void {
  let state = patchStates.get(material);
  if (!state) {
    state = { patches: [] };
    patchStates.set(material, state);
  }
  state.csmHook = material.onBeforeCompile as PatchState['csmHook'];
  rebuildHook(material, state);
}

// Three's own lights_fragment_begin, captured before CSM swaps in its copy.
const CORE_LIGHTS_FRAGMENT_BEGIN = THREE.ShaderChunk.lights_fragment_begin;
const INCIDENT_LIGHT_DECL = 'IncidentLight directLight;';

/**
 * CSM ships an older lights_fragment_begin that never initialises the
 * split-sum DFG term or the multi-scattering compensation. Without them every
 * CSM material loses its image-based specular and its direct specular goes to
 * zero. Graft the missing block from the core chunk back in.
 */
function repairCsmLightsChunk(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('material.dfg')) return;
  const start = CORE_LIGHTS_FRAGMENT_BEGIN.indexOf('#ifdef STANDARD');
  const end = CORE_LIGHTS_FRAGMENT_BEGIN.indexOf(INCIDENT_LIGHT_DECL);
  if (start < 0 || end < 0 || end < start || !chunk.includes(INCIDENT_LIGHT_DECL)) {
    throw new Error('Could not repair CSM lights chunk (Three.js chunk changed?)');
  }
  const block = CORE_LIGHTS_FRAGMENT_BEGIN.slice(start, end);
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(INCIDENT_LIGHT_DECL, `${block}\n${INCIDENT_LIGHT_DECL}`);
}

const DIR_LIGHT_INFO = /getDirectionalLightInfo\(\s*directionalLights?(?:\[\s*\w+\s*\])?\s*,\s*directLight\s*\);/g;

/**
 * Multiplies every directional light by atmospheric visibility (cloud
 * shadows). Must run after CSM injects its lights chunk (and again whenever a
 * new CSM instance re-injects it).
 */
export function patchDirectionalLightVisibility(): void {
  repairCsmLightsChunk();
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('atmoSunVisibility')) return;
  let count = 0;
  let patched = chunk.replace(DIR_LIGHT_INFO, (match) => {
    count += 1;
    return `${match}\n#ifdef USE_FOG\n\tdirectLight.color *= atmoSunVis;\n#endif\n`;
  });
  if (count === 0) throw new Error('Could not patch directional light visibility (Three.js chunk changed?)');
  // Every cascade is a light of its own: work the visibility out once per
  // pixel rather than once per cascade.
  const anchor = 'vec3 geometryPosition = - vViewPosition;';
  if (!patched.includes(anchor)) throw new Error('Could not find geometryPosition in lights_fragment_begin (Three.js chunk changed?)');
  patched = patched.replace(anchor, `${anchor}\n#ifdef USE_FOG\n\tfloat atmoSunVis = atmoSunVisibility( geometryPosition );\n#endif`);
  THREE.ShaderChunk.lights_fragment_begin = patched;
}

/** Replace exactly one occurrence of `search` in shader source or throw (catches Three upgrades). */
export function replaceOnce(source: string, search: string, replacement: string, label: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Shader patch "${label}" could not find: ${search.slice(0, 60)}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}
