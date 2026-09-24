import { WORLD_SIZE } from '../../world/WorldConfig';

// Frozen lake surface: wind-scoured clear ice with trapped bubbles, pressure
// cracks and drifted snow, clipped to the lake by the world water-level field.

export const ICE_VERTEX_PARS = /* glsl */ `
varying vec3 vIceWorld;
`;

export const ICE_WORLDPOS = /* glsl */ `
vIceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const ICE_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uWaterLevel;
uniform sampler2D uFoamTex;
varying vec3 vIceWorld;

vec2 iceHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Distance to the nearest Voronoi edge (pressure cracks).
float iceCracks(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + iceHash(i + g) - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return sqrt(f2) - sqrt(f1);
}
`;

export const ICE_FRAGMENT_MAIN = /* glsl */ `
vec2 icePos = vIceWorld.xz;
float iceLevel = texture2D(uWaterLevel, icePos / ${WORLD_SIZE.toFixed(1)} + 0.5).r;
if (abs(iceLevel - vIceWorld.y) > 0.4) discard;
vec4 iceBroad = texture2D(uFoamTex, icePos / 131.0);
vec4 iceFine = texture2D(uFoamTex, icePos / 17.0);
float iceSnow = smoothstep(0.5, 0.66, iceBroad.a + 0.22 * iceFine.b - 0.04);
float iceCrackA = 1.0 - smoothstep(0.0, 0.035, iceCracks(icePos / 7.0));
float iceCrackB = 1.0 - smoothstep(0.0, 0.05, iceCracks(icePos / 2.3 + 17.0));
float iceCrack = max(iceCrackA, iceCrackB * 0.55) * (1.0 - iceSnow);
float iceBubbles = smoothstep(0.55, 0.9, iceFine.r) * (1.0 - iceSnow);
vec3 iceClear = vec3(0.07, 0.17, 0.22);
vec3 iceWhite = vec3(0.62, 0.74, 0.8);
vec3 iceSnowCol = vec3(0.9, 0.93, 0.97);
vec3 iceCol = mix(iceClear, iceWhite, 0.25 + 0.45 * iceBroad.b);
iceCol = mix(iceCol, vec3(0.8, 0.88, 0.93), iceBubbles * 0.55);
iceCol = mix(iceCol, vec3(0.86, 0.92, 0.96), iceCrack * 0.8);
iceCol = mix(iceCol, iceSnowCol, iceSnow);
diffuseColor.rgb = iceCol;
float iceRough = mix(0.05, 0.62, iceSnow) + iceCrack * 0.25 + iceBubbles * 0.05;
vec2 iceSlope = (vec2(iceFine.g, iceFine.b) - 0.5) * mix(0.05, 0.25, iceSnow) + vec2(iceCrackA - iceCrackB) * 0.03;
vec3 iceNormal = normalize(vec3(iceSlope.x, 1.0, iceSlope.y));
`;
