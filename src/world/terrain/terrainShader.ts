import { FIELD_RES, HEIGHT_RES, WORLD_HALF, WORLD_SIZE } from '../WorldConfig';
import { LAYER_COUNT } from '../../render/terrain/terrainLayers';

// Vertex: CDLOD node placement with geomorphing to the parent grid.
export const TERRAIN_VERTEX_PARS = /* glsl */ `
attribute vec3 aNode; // origin x, origin z, lod level
uniform sampler2D uHeightTex;
uniform vec3 uCdlodCamera;
uniform float uGridN;
uniform float uBaseSize;
uniform vec2 uMorph[10];
varying vec3 vTerrainPos;
varying float vMorphK;

float terrainHeightAt(vec2 w) {
  vec2 idx = w + ${WORLD_HALF.toFixed(1)};
  ivec2 ic = ivec2(clamp(idx, vec2(0.0), vec2(${(HEIGHT_RES - 1).toFixed(1)})));
  float h = texelFetch(uHeightTex, ic, 0).r;
  vec2 outside = max(abs(w) - ${(WORLD_HALF - 1).toFixed(1)}, vec2(0.0));
  float o = max(outside.x, outside.y);
  if (o > 0.0) h = mix(h, -70.0, smoothstep(0.0, 450.0, o));
  return h;
}
`;

export const TERRAIN_BEGIN_VERTEX = /* glsl */ `
  vec2 gridPos = position.xz;
  float lodLevel = aNode.z;
  float nodeSize = uBaseSize * exp2(lodLevel);
  vec2 worldXZ = aNode.xy + gridPos * nodeSize;
  vec2 morph = uMorph[int(lodLevel + 0.5)];
  float camDist = distance(worldXZ, uCdlodCamera.xz);
  float morphK = clamp((camDist - morph.x) / (morph.y - morph.x), 0.0, 1.0);
  vec2 fracPart = fract(gridPos * uGridN * 0.5) * 2.0 / uGridN;
  gridPos -= fracPart * morphK;
  worldXZ = aNode.xy + gridPos * nodeSize;
  vec3 transformed = vec3(worldXZ.x, terrainHeightAt(worldXZ), worldXZ.y);
  vTerrainPos = transformed;
  vMorphK = morphK;
`;

// Fragment: layer selection, sampling and blending.
export const TERRAIN_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uTerrainNormal;
uniform sampler2D uBiomeA;
uniform sampler2D uBiomeB;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uWaterLevel;
uniform sampler2DArray uLayerAlbedo;
uniform sampler2DArray uLayerNormal;
uniform float uLayerTile[${LAYER_COUNT}];
uniform float uLayerHeightBias[${LAYER_COUNT}];
uniform vec2 uLayerStretch[${LAYER_COUNT}];
uniform float uWetness;
uniform float uSnowCover;
uniform float uTerrainTime;
uniform float uDetailDistance;
varying vec3 vTerrainPos;
varying float vMorphK;

#define L_MEADOW 0
#define L_DRY 1
#define L_FOREST 2
#define L_MOSS 3
#define L_DIRT 4
#define L_MUD 5
#define L_GRANITE 6
#define L_BASALT 7
#define L_SAND 8
#define L_GRAVEL 9
#define L_SNOW 10
#define L_ASH 11
#define L_LIME 12
#define L_GLASS 13

float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tFbm(vec2 p) { return tNoise(p) * 0.5 + tNoise(p * 2.03 + 7.1) * 0.3 + tNoise(p * 4.1 - 3.7) * 0.2; }

void biomeRules(int b, float wb, float slope, float nA, float nB, float height, inout float w[${LAYER_COUNT}]) {
  if (wb < 0.004) return;
  float rock = smoothstep(0.24, 0.38, slope + (nA - 0.5) * 0.1);
  float bank = smoothstep(0.12, 0.24, slope + (nA - 0.5) * 0.06) * (1.0 - rock);
  float flat_ = max(0.0, 1.0 - rock - bank);
  if (b == 0) {        // Greensward
    w[L_MEADOW] += wb * flat_ * mix(0.85, 0.3, nB);
    w[L_DRY] += wb * flat_ * mix(0.15, 0.7, nB);
    w[L_DIRT] += wb * bank;
    w[L_GRANITE] += wb * rock;
  } else if (b == 1) { // Hollowpine
    w[L_FOREST] += wb * flat_ * mix(0.8, 0.35, nB);
    w[L_MOSS] += wb * (flat_ * mix(0.2, 0.65, nB) + bank * 0.55);
    w[L_DIRT] += wb * bank * 0.45;
    w[L_GRANITE] += wb * rock;
  } else if (b == 2) { // Glasswood
    w[L_GLASS] += wb * flat_ * mix(0.7, 0.3, nB);
    w[L_MEADOW] += wb * flat_ * mix(0.3, 0.7, nB);
    w[L_LIME] += wb * (rock + bank * 0.6);
    w[L_DIRT] += wb * bank * 0.4;
  } else if (b == 3) { // Coast
    w[L_DRY] += wb * flat_ * mix(0.7, 0.35, nB);
    w[L_MEADOW] += wb * flat_ * mix(0.3, 0.65, nB);
    w[L_GRAVEL] += wb * bank * 0.5;
    w[L_DIRT] += wb * bank * 0.5;
    w[L_BASALT] += wb * rock;
  } else if (b == 4) { // Cinderreach
    w[L_ASH] += wb * flat_ * mix(0.75, 0.35, nB);
    w[L_BASALT] += wb * (flat_ * mix(0.25, 0.65, nB) + rock + bank * 0.5);
    w[L_DIRT] += wb * bank * 0.5;
  } else if (b == 5) { // Frostveil
    float alpine = 1.0 - smoothstep(118.0, 160.0, height + (nA - 0.5) * 30.0);
    w[L_DRY] += wb * flat_ * alpine * mix(0.6, 0.3, nB);
    w[L_MEADOW] += wb * flat_ * alpine * mix(0.4, 0.2, nB);
    w[L_SNOW] += wb * flat_ * (1.0 - alpine) + wb * flat_ * alpine * nB * 0.5;
    w[L_GRAVEL] += wb * bank * 0.5;
    w[L_GRANITE] += wb * (rock + bank * 0.5);
  } else if (b == 6) { // Drownfen
    w[L_MUD] += wb * flat_ * mix(0.65, 0.3, nB);
    w[L_MOSS] += wb * flat_ * mix(0.35, 0.7, nB);
    w[L_DIRT] += wb * (bank + rock * 0.5);
    w[L_GRANITE] += wb * rock * 0.5;
  } else {             // Rim
    w[L_DRY] += wb * flat_ * mix(0.65, 0.3, nB);
    w[L_DIRT] += wb * flat_ * mix(0.35, 0.3, nB);
    w[L_MEADOW] += wb * flat_ * mix(0.0, 0.4, nB);
    w[L_GRAVEL] += wb * bank * 0.6;
    w[L_LIME] += wb * (rock + bank * 0.4);
  }
}

// Anti-tiling (after Inigo Quilez "texture repetition" #3): two offset lookups
// blended by a low-frequency variation value shared by every layer.
struct TileVariant { vec2 offA; vec2 offB; float blend; };

TileVariant tileVariant(vec2 worldXZ) {
  float k = tNoise(worldXZ * 0.035);
  float index = k * 8.0;
  float i = floor(index);
  float f = fract(index);
  TileVariant tv;
  tv.offA = sin(vec2(3.0, 7.0) * i);
  tv.offB = sin(vec2(3.0, 7.0) * (i + 1.0));
  tv.blend = smoothstep(0.2, 0.8, f);
  return tv;
}

vec3 unpackNormal(vec4 t) {
  vec2 xy = t.xy * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

// Samples one layer. Top projection with anti-tiling on gentle ground,
// biplanar (dominant axes) on steep ground. Returns albedo+height; writes
// perturbed world normal and roughness/ao.
// Derivatives are passed in (computed in uniform control flow in main):
// dFdx inside per-pixel branches is undefined in GLSL.
vec4 sampleLayer(int layer, vec3 pos, vec3 N, float steep, TileVariant tv, TileVariant tvS, vec3 dpdx, vec3 dpdy, out vec3 wn, out vec2 roughAo) {
  float tile = uLayerTile[layer];
  float fl = float(layer);
  if (steep < 0.5) {
    vec2 uv = pos.xz / tile;
    vec2 dx = dpdx.xz / tile;
    vec2 dy = dpdy.xz / tile;
    vec4 a = textureGrad(uLayerAlbedo, vec3(uv + tv.offA, fl), dx, dy);
    vec4 b = textureGrad(uLayerAlbedo, vec3(uv + tv.offB, fl), dx, dy);
    vec4 alb = mix(a, b, tv.blend);
    vec4 nt = textureGrad(uLayerNormal, vec3(uv + tv.offA, fl), dx, dy);
    vec3 tn = unpackNormal(nt);
    // Whiteout blend on the Y plane, swizzled to world.
    vec3 n = vec3(tn.xy + N.xz, abs(tn.z) * N.y);
    wn = normalize(n.xzy);
    roughAo = nt.ba;
    return alb;
  }
  // Biplanar: Y plane plus the dominant horizontal axis.
  vec3 an = abs(N);
  bool useX = an.x > an.z;
  // Faces are stretched along each rock's grain and get their own
  // anti-tiling (varying with height too), so cliffs never read as tiles.
  vec2 st = uLayerStretch[layer];
  vec2 uvY = pos.xz / tile;
  vec2 uvS = (useX ? pos.zy : pos.xy) / tile * st;
  vec2 dYx = dpdx.xz / tile;
  vec2 dYy = dpdy.xz / tile;
  vec2 dSx = (useX ? dpdx.zy : dpdx.xy) / tile * st;
  vec2 dSy = (useX ? dpdy.zy : dpdy.xy) / tile * st;
  vec4 aY = textureGrad(uLayerAlbedo, vec3(uvY + tv.offA, fl), dYx, dYy);
  vec4 aSa = textureGrad(uLayerAlbedo, vec3(uvS + tvS.offA, fl), dSx, dSy);
  vec4 aSb = textureGrad(uLayerAlbedo, vec3(uvS + tvS.offB, fl), dSx, dSy);
  vec4 aS = mix(aSa, aSb, tvS.blend);
  vec4 nY = textureGrad(uLayerNormal, vec3(uvY + tv.offA, fl), dYx, dYy);
  vec4 nS = textureGrad(uLayerNormal, vec3(uvS + (tvS.blend < 0.5 ? tvS.offA : tvS.offB), fl), dSx, dSy);
  float wY = pow(an.y, 3.0);
  float wS = pow(useX ? an.x : an.z, 3.0);
  float sum = wY + wS + 1e-4;
  wY /= sum;
  wS /= sum;
  vec3 tY = unpackNormal(nY);
  vec3 tS = unpackNormal(nS);
  vec3 nYw = vec3(tY.xy + N.xz, abs(tY.z) * N.y).xzy;
  vec3 nSw;
  if (useX) {
    tS.x *= sign(N.x);
    nSw = vec3(tS.xy + N.zy, abs(tS.z) * N.x).zyx;
  } else {
    tS.x *= -sign(N.z);
    nSw = vec3(tS.xy + N.xy, abs(tS.z) * N.z);
  }
  wn = normalize(nYw * wY + nSw * wS);
  roughAo = nY.ba * wY + nS.ba * wS;
  return aY * wY + aS * wS;
}
`;

/** Replaces <map_fragment>: computes the full ground surface. */
export const TERRAIN_SURFACE_FRAGMENT = /* glsl */ `
  #ifdef USE_FOG
  if (atmoCaveInside(vTerrainPos) > 0.5) discard;
  #endif
  vec3 tPos = vTerrainPos;
  vec3 tDpdx = dFdx(tPos);
  vec3 tDpdy = dFdy(tPos);
  vec2 nUv = (tPos.xz + ${WORLD_HALF.toFixed(1)} + 0.5) / ${HEIGHT_RES.toFixed(1)};
  vec2 fUv = (tPos.xz + ${WORLD_HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
  vec4 nTex = texture2D(uTerrainNormal, nUv);
  vec3 tN = normalize(nTex.xyz * 2.0 - 1.0);
  float terrainAO = nTex.a;
  float slope = 1.0 - tN.y;
  vec4 bA = texture2D(uBiomeA, fUv);
  vec4 bB = texture2D(uBiomeB, fUv);
  vec4 mA = texture2D(uMaskA, fUv); // path, sand, wet, cave
  vec4 mB = texture2D(uMaskB, fUv); // deposit, carve, forest, snow
  float waterLevel = texture2D(uWaterLevel, fUv).r;
  float camDist = length(vViewPosition);

  float nA = tFbm(tPos.xz * 0.045);
  float nB = smoothstep(0.3, 0.7, tFbm(tPos.xz * 0.012 + 11.0) * 0.7 + tNoise(tPos.xz * 0.09) * 0.3);

  float lw[${LAYER_COUNT}];
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] = 0.0;
  biomeRules(0, bA.r, slope, nA, nB, tPos.y, lw);
  biomeRules(1, bA.g, slope, nA, nB, tPos.y, lw);
  biomeRules(2, bA.b, slope, nA, nB, tPos.y, lw);
  biomeRules(3, bA.a, slope, nA, nB, tPos.y, lw);
  biomeRules(4, bB.r, slope, nA, nB, tPos.y, lw);
  biomeRules(5, bB.g, slope, nA, nB, tPos.y, lw);
  biomeRules(6, bB.b, slope, nA, nB, tPos.y, lw);
  biomeRules(7, bB.a, slope, nA, nB, tPos.y, lw);

  float lsum = 0.0;
  for (int i = 0; i < ${LAYER_COUNT}; i++) lsum += lw[i];
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] /= max(lsum, 1e-4);

  float gentle = 1.0 - smoothstep(0.3, 0.5, slope);
  // Erosion: exposed gravel in carved channels, silt where sediment settled.
  float carve = mB.g * gentle;
  float deposit = mB.r * gentle;
  // Masks override the biome palette.
  float path = mA.r * gentle;
  float sand = mA.g;
  float wetMask = mA.b;
  float snowMask = max(mB.a, uSnowCover * smoothstep(0.55, 0.85, tN.y) * smoothstep(0.35, 0.6, nA + 0.2));
  float underwater = smoothstep(-0.02, 0.25, waterLevel - tPos.y);

  // Strong erosion channels expose gravel; settled sediment is fertile ground.
  carve = smoothstep(0.35, 0.95, carve);
  deposit = smoothstep(0.3, 1.0, deposit);
  float keep = (1.0 - carve * 0.6);
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= keep;
  lw[L_GRAVEL] += carve * 0.4;
  lw[L_DIRT] += carve * 0.2;
  float fertile = deposit * (bA.r + bA.g * 0.5 + bB.a * 0.5);
  lw[L_MEADOW] += fertile * 0.6;

  float pk = 1.0 - path;
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= pk;
  lw[L_DIRT] += path * 0.65;
  lw[L_GRAVEL] += path * 0.35;

  float sk = 1.0 - sand;
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= sk;
  lw[L_SAND] += sand;

  float wk = 1.0 - wetMask * 0.8;
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= wk;
  lw[L_MUD] += wetMask * 0.8;

  float snowK = snowMask * (1.0 - smoothstep(0.45, 0.62, slope));
  for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= 1.0 - snowK;
  lw[L_SNOW] += snowK;

  if (underwater > 0.0) {
    for (int i = 0; i < ${LAYER_COUNT}; i++) lw[i] *= 1.0 - underwater;
    float sea = step(waterLevel, 0.05);
    lw[L_SAND] += underwater * sea * 0.7;
    lw[L_GRAVEL] += underwater * (sea * 0.3 + (1.0 - sea) * 0.6);
    lw[L_MUD] += underwater * (1.0 - sea) * 0.4;
  }

  // Pick the four strongest layers.
  int li[4];
  float lv[4];
  for (int k = 0; k < 4; k++) {
    int best = 0;
    float bestW = -1.0;
    for (int i = 0; i < ${LAYER_COUNT}; i++) {
      bool used = false;
      for (int q = 0; q < 4; q++) { if (q < k && li[q] == i) used = true; }
      if (!used && lw[i] > bestW) { bestW = lw[i]; best = i; }
    }
    li[k] = best;
    lv[k] = max(bestW, 0.0);
  }

  vec3 surfAlbedo = vec3(0.0);
  vec3 surfNormal = tN;
  float surfRough = 0.85;
  float surfAO = 1.0;
  float steep = step(0.34, slope);

  if (camDist < uDetailDistance) {
    TileVariant tv = tileVariant(tPos.xz);
    TileVariant tvS = tileVariant(tPos.xz * 0.61 + vec2(tPos.y * 0.83, -tPos.y * 0.47));
    vec4 al[4];
    vec3 wn[4];
    vec2 ra[4];
    float hmax = -1.0;
    float hb[4];
    for (int k = 0; k < 4; k++) {
      if (lv[k] <= 0.001) { al[k] = vec4(0.0); wn[k] = tN; ra[k] = vec2(0.85, 1.0); hb[k] = -1.0; continue; }
      al[k] = sampleLayer(li[k], tPos, tN, steep, tv, tvS, tDpdx, tDpdy, wn[k], ra[k]);
      hb[k] = al[k].a * uLayerHeightBias[li[k]] + lv[k];
      hmax = max(hmax, hb[k]);
    }
    float bw[4];
    float bsum = 0.0;
    for (int k = 0; k < 4; k++) {
      bw[k] = max(hb[k] - (hmax - 0.18), 0.0) * step(0.001, lv[k]);
      bsum += bw[k];
    }
    vec3 nsum = vec3(0.0);
    surfRough = 0.0;
    surfAO = 0.0;
    for (int k = 0; k < 4; k++) {
      float wk2 = bw[k] / max(bsum, 1e-5);
      surfAlbedo += al[k].rgb * wk2;
      nsum += wn[k] * wk2;
      surfRough += ra[k].x * wk2;
      surfAO += ra[k].y * wk2;
    }
    surfNormal = normalize(nsum);
    // Fade toward the far-field look so the transition is invisible.
    float far = smoothstep(uDetailDistance * 0.6, uDetailDistance, camDist);
    vec3 farAlbedo = vec3(0.0);
    for (int k = 0; k < 4; k++) farAlbedo += textureLod(uLayerAlbedo, vec3(0.5, 0.5, float(li[k])), 12.0).rgb * lv[k];
    surfAlbedo = mix(surfAlbedo, farAlbedo / max(lv[0] + lv[1] + lv[2] + lv[3], 1e-4), far);
    surfNormal = normalize(mix(surfNormal, tN, far));
    surfAO = mix(surfAO, 1.0, far);
  } else {
    for (int k = 0; k < 4; k++) surfAlbedo += textureLod(uLayerAlbedo, vec3(0.5, 0.5, float(li[k])), 12.0).rgb * lv[k];
    surfAlbedo /= max(lv[0] + lv[1] + lv[2] + lv[3], 1e-4);
    surfRough = 0.88;
  }

  // Macro variation breaks up large uniform areas.
  float macro = tFbm(tPos.xz * 0.0065) * 0.65 + tFbm(tPos.xz * 0.028 + 3.0) * 0.35;
  surfAlbedo *= 0.8 + 0.4 * macro;
  surfAlbedo = mix(surfAlbedo, surfAlbedo * vec3(1.06, 1.0, 0.9), smoothstep(0.55, 0.8, tNoise(tPos.xz * 0.004 + 5.0)) * 0.6);

  // Wetness from rain and water margins; puddles gather in hollows.
  float wet = max(uWetness * smoothstep(0.2, 0.7, tN.y), wetMask * 0.7);
  wet = max(wet, smoothstep(0.6, 0.0, tPos.y - waterLevel) * (1.0 - underwater));
  float porosity = 1.0 - smoothstep(0.35, 0.6, lw[L_GRANITE] + lw[L_BASALT] + lw[L_LIME]) * 0.4;
  surfAlbedo *= mix(1.0, 0.52, wet * porosity);
  surfRough = mix(surfRough, 0.22, wet * 0.85);
  float puddle = uWetness * smoothstep(0.62, 0.9, 1.0 - terrainAO + (1.0 - nA) * 0.4) * smoothstep(0.93, 0.99, tN.y);
  surfNormal = normalize(mix(surfNormal, tN, puddle));
  surfRough = mix(surfRough, 0.03, puddle);
  surfAlbedo *= 1.0 - puddle * 0.3;

  // Snow sparkle: occasional near-mirror micro facets.
  float sparkle = step(0.985, tHash(floor(tPos.xz * 18.0))) * lw[L_SNOW];
  surfRough = mix(surfRough, 0.08, sparkle);

  // Underwater: caustics near the surface, darker further down.
  if (underwater > 0.0) {
    float depthW = max(0.0, waterLevel - tPos.y);
    vec2 cp = tPos.xz * 0.35;
    float c1 = tNoise(cp + vec2(uTerrainTime * 0.4, uTerrainTime * 0.23));
    float c2 = tNoise(cp * 1.7 - vec2(uTerrainTime * 0.31, uTerrainTime * 0.37));
    float caustic = pow(1.0 - abs(c1 - c2), 8.0);
    surfAlbedo *= mix(1.0, 0.7 + caustic * 1.4 * exp(-depthW * 0.35), underwater);
  }

  diffuseColor.rgb = surfAlbedo;
`;

export const TERRAIN_ROUGHNESS_FRAGMENT = /* glsl */ `
  float roughnessFactor = clamp(surfRough, 0.03, 1.0);
`;

export const TERRAIN_NORMAL_FRAGMENT = /* glsl */ `
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
  vec3 normal = normalize((viewMatrix * vec4(surfNormal, 0.0)).xyz);
  vec3 nonPerturbedNormal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);
`;

export const TERRAIN_AO_FRAGMENT = /* glsl */ `
  float ambientOcclusion = terrainAO * surfAO;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
  #endif
`;

export const TERRAIN_CONSTANTS = { FIELD_RES };
