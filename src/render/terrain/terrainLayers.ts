// Ground material layers baked on the GPU at startup. Index order is shared
// with the terrain shader (see terrainShader.ts) — never reorder.

export const LAYER = {
  meadow: 0,
  dryGrass: 1,
  forestFloor: 2,
  moss: 3,
  dirt: 4,
  mud: 5,
  granite: 6,
  basalt: 7,
  sand: 8,
  gravel: 9,
  snow: 10,
  ash: 11,
  limestone: 12,
  glassSand: 13,
} as const;

export const LAYER_COUNT = 14;

/** World meters covered by one texture tile, per layer. */
export const LAYER_TILE_METERS = [3.2, 3.4, 4, 3.2, 3, 3.4, 7, 7, 4.5, 2.6, 5.5, 4.5, 7, 4.2];

/** Normal strength when converting height to normals, per layer. */
export const LAYER_NORMAL_STRENGTH = [1.2, 1.3, 1.6, 1.5, 1.8, 1.0, 2.4, 2.2, 1.1, 2.2, 0.8, 1.6, 2.0, 1.7];

/** Height-blend sharpness contribution (how strongly height wins transitions). */
export const LAYER_HEIGHT_BIAS = [0.3, 0.3, 0.35, 0.45, 0.25, 0.1, 0.8, 0.8, 0.15, 0.6, 0.4, 0.25, 0.7, 0.4];

export const NOISE_LIB = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

// Tileable gradient noise: period in lattice units.
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash22(mod(i, per)) * 2.0 - 1.0;
  vec2 g10 = hash22(mod(i + vec2(1.0, 0.0), per)) * 2.0 - 1.0;
  vec2 g01 = hash22(mod(i + vec2(0.0, 1.0), per)) * 2.0 - 1.0;
  vec2 g11 = hash22(mod(i + vec2(1.0, 1.0), per)) * 2.0 - 1.0;
  float a = dot(g00, f);
  float b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0));
  float d = dot(g11, f - vec2(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float pfbm(vec2 p, vec2 per, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    sum += amp * pnoise(p, per);
    norm += amp;
    p *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return sum / norm;
}

float pridged(vec2 p, vec2 per, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    float n = 1.0 - abs(pnoise(p, per));
    sum += amp * n * n;
    norm += amp;
    p *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return sum / norm;
}

// Tileable Voronoi: x = F1, y = F2, z = cell hash, w unused. jitter 0..1.
vec4 pvoronoi(vec2 p, vec2 per, float jitter) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 cell = mod(i + g, per);
      vec2 o = 0.5 + (hash22(cell) - 0.5) * jitter;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hash12(cell * 1.37 + 0.71); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec4(sqrt(f1), sqrt(f2), id, 0.0);
}

// Cell-local coordinates for scattering shapes (needles, leaves, shards).
vec4 pcell(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 cell = mod(i, per);
  return vec4(fract(p) - 0.5, cell);
}

mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }

float segmentDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
`;

/** Pass A: albedo (sRGB target) + height (alpha). */
export const BAKE_ALBEDO_FRAG = /* glsl */ `
precision highp float;
uniform int uLayer;
varying vec2 vUv;
${NOISE_LIB}

// Scattered thin strokes (grass blades / needles / straw) inside cells.
float strokes(vec2 uv, float freq, float len, float width, float seed, out float shade) {
  float best = 0.0;
  shade = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 p = uv * freq + vec2(float(k) * 0.37 + seed, float(k) * 0.61);
    vec4 c = pcell(p, vec2(freq));
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 cell = mod(c.zw + g, vec2(freq));
        vec3 h = hash32(cell + seed * 17.0 + float(k) * 3.1);
        vec2 center = g + (h.xy - 0.5) * 0.8;
        float ang = h.z * 6.2831;
        vec2 dir = vec2(cos(ang), sin(ang)) * len * (0.6 + 0.4 * h.x);
        float d = segmentDist(c.xy, center - dir, center + dir);
        float s = 1.0 - smoothstep(width * 0.3, width, d);
        if (s > best) { best = s; shade = h.y; }
      }
    }
  }
  return best;
}

void layerMeadow(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 3.0, vec2(3.0), 4);
  float clump = pfbm(uv * 14.0, vec2(14.0), 3);
  float shade;
  float blades = strokes(uv, 34.0, 0.34, 0.09, 1.0, shade);
  float clover = smoothstep(0.25, 0.1, pvoronoi(uv * 46.0, vec2(46.0), 1.0).x) * step(0.55, hash12(floor(uv * 46.0)));
  h = 0.35 + 0.18 * clump + 0.35 * blades + 0.12 * clover;
  vec3 dark = vec3(0.045, 0.075, 0.025);
  vec3 mid = vec3(0.12, 0.19, 0.05);
  vec3 lite = vec3(0.26, 0.33, 0.1);
  vec3 straw = vec3(0.34, 0.3, 0.14);
  col = mix(dark, mid, smoothstep(-0.3, 0.4, clump));
  col = mix(col, mix(lite, straw, shade * 0.6), blades * 0.75);
  col = mix(col, vec3(0.1, 0.18, 0.06), clover * 0.8);
  float soil = smoothstep(-0.28, -0.46, low);
  col = mix(col, vec3(0.16, 0.12, 0.08), soil * 0.8);
  h = mix(h, 0.2, soil * 0.6);
  col *= 0.85 + 0.3 * (0.5 + 0.5 * low);
}

void layerDryGrass(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 4.0, vec2(4.0), 4);
  float shade;
  float straw = strokes(uv, 30.0, 0.42, 0.08, 7.0, shade);
  float shade2;
  float straw2 = strokes(uv, 52.0, 0.3, 0.07, 3.0, shade2);
  h = 0.3 + 0.15 * low + 0.35 * straw + 0.2 * straw2;
  vec3 soil = vec3(0.17, 0.13, 0.08);
  vec3 a = vec3(0.42, 0.34, 0.17);
  vec3 b = vec3(0.28, 0.24, 0.12);
  col = mix(soil, mix(a, b, shade), max(straw, straw2 * 0.8));
  col = mix(col, vec3(0.2, 0.22, 0.1), smoothstep(0.2, 0.5, low) * 0.4);
}

void layerForestFloor(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 5.0, vec2(5.0), 4);
  float shade;
  float needles = strokes(uv, 40.0, 0.4, 0.05, 11.0, shade);
  float shadeB;
  float needlesB = strokes(uv, 23.0, 0.45, 0.045, 5.0, shadeB);
  // Fallen leaves: ellipses scattered in cells.
  vec4 lv = pvoronoi(uv * 12.0, vec2(12.0), 1.0);
  vec2 lc = uv * 12.0;
  vec4 cell = pcell(lc, vec2(12.0));
  vec3 lh = hash32(cell.zw + 5.0);
  vec2 lp = rot2(lh.z * 6.28) * (cell.xy - (lh.xy - 0.5) * 0.4);
  float leaf = 1.0 - smoothstep(0.8, 1.0, length(lp * vec2(3.2, 6.0)));
  leaf *= step(0.45, lh.x);
  float moss = smoothstep(0.1, 0.45, pfbm(uv * 3.0 + 3.1, vec2(3.0), 4));
  h = 0.25 + 0.2 * low + 0.25 * needles + 0.2 * needlesB + 0.3 * leaf + 0.15 * moss;
  vec3 soil = vec3(0.06, 0.045, 0.03);
  vec3 needleCol = mix(vec3(0.24, 0.12, 0.06), vec3(0.34, 0.2, 0.1), shade);
  vec3 leafCol = mix(vec3(0.22, 0.12, 0.05), vec3(0.3, 0.26, 0.08), lh.y);
  col = soil;
  col = mix(col, needleCol * 0.8, needlesB * 0.8);
  col = mix(col, needleCol, needles * 0.85);
  col = mix(col, leafCol, leaf);
  col = mix(col, vec3(0.06, 0.1, 0.03), moss * 0.55);
  col *= 0.8 + 0.35 * (0.5 + 0.5 * low);
  lv.x += 0.0;
}

void layerMoss(vec2 uv, out vec3 col, out float h) {
  vec4 v = pvoronoi(uv * 9.0, vec2(9.0), 0.9);
  float cushion = 1.0 - v.x * v.x;
  float fine = pfbm(uv * 60.0, vec2(60.0), 3);
  float mid = pfbm(uv * 18.0, vec2(18.0), 3);
  h = 0.3 + 0.35 * cushion + 0.12 * fine + 0.15 * mid;
  col = mix(vec3(0.035, 0.07, 0.015), vec3(0.14, 0.22, 0.04), smoothstep(0.2, 0.9, cushion + fine * 0.3));
  col = mix(col, vec3(0.22, 0.26, 0.07), smoothstep(0.55, 0.85, fine + 0.3) * 0.5);
  col *= 0.8 + 0.4 * v.z;
}

void layerDirt(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 4.0, vec2(4.0), 5);
  float grain = pfbm(uv * 48.0, vec2(48.0), 2);
  vec4 pebA = pvoronoi(uv * 16.0, vec2(16.0), 0.9);
  float stoneA = smoothstep(0.42, 0.18, pebA.x) * step(0.6, pebA.z);
  vec4 pebB = pvoronoi(uv * 38.0, vec2(38.0), 0.9);
  float stoneB = smoothstep(0.38, 0.2, pebB.x) * step(0.5, pebB.z);
  float crack = smoothstep(0.03, 0.0, pvoronoi(uv * 7.0, vec2(7.0), 1.0).y - pvoronoi(uv * 7.0, vec2(7.0), 1.0).x) * smoothstep(-0.1, 0.3, low);
  h = 0.35 + 0.15 * low + 0.05 * grain + 0.45 * stoneA * (1.0 - pebA.x * 2.0) + 0.25 * stoneB - 0.2 * crack;
  col = mix(vec3(0.13, 0.09, 0.06), vec3(0.24, 0.18, 0.12), 0.5 + 0.5 * low);
  col *= 0.9 + 0.2 * grain;
  vec3 stoneCol = mix(vec3(0.22, 0.2, 0.18), vec3(0.36, 0.32, 0.27), pebA.z);
  col = mix(col, stoneCol, stoneA);
  col = mix(col, stoneCol * 0.9, stoneB * 0.8);
  col *= 1.0 - crack * 0.5;
}

void layerMud(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 3.0, vec2(3.0), 5);
  float ripple = pnoise(uv * vec2(6.0, 40.0), vec2(6.0, 40.0));
  float puddle = smoothstep(-0.05, -0.25, low);
  h = 0.45 + 0.25 * low + 0.03 * ripple;
  col = mix(vec3(0.055, 0.042, 0.03), vec3(0.12, 0.09, 0.06), 0.5 + 0.5 * low);
  col = mix(col, vec3(0.035, 0.03, 0.025), puddle);
  float grass = strokes(uv, 20.0, 0.35, 0.05, 23.0, ripple);
  col = mix(col, vec3(0.1, 0.12, 0.05), grass * 0.35 * (1.0 - puddle));
}

void layerGranite(vec2 uv, out vec3 col, out float h) {
  // Irregular blocks, not tiles: fractures on domain-warped coordinates at
  // two scales. Blocks sit at slightly different depths with rounded edges;
  // only some joints open into cracks, and their width wanders.
  vec2 warp = vec2(pfbm(uv * 2.0 + 1.7, vec2(2.0), 4), pfbm(uv * 2.0 - 4.1, vec2(2.0), 4));
  vec2 wuv = uv + warp * 0.1;
  vec4 v = pvoronoi(wuv * 4.0, vec2(4.0), 1.0);
  vec4 s = pvoronoi(wuv * 13.0 + 0.37, vec2(13.0), 1.0);
  float block = v.z;
  float edge = v.y - v.x;
  float bevel = smoothstep(0.0, 0.14, edge);
  float open = smoothstep(0.1, 0.55, pnoise(wuv * 6.0 + block * 3.0, vec2(6.0)) * 0.5 + 0.5);
  float crack = (1.0 - smoothstep(0.0, 0.02 + 0.035 * open, edge)) * (0.25 + 0.75 * open);
  float chip = (1.0 - smoothstep(0.0, 0.045, s.y - s.x)) * step(0.45, s.z);
  float large = pfbm(uv * 1.5, vec2(1.5), 4);
  float detail = pfbm(uv * 24.0, vec2(24.0), 4);
  float micro = pfbm(uv * 90.0, vec2(90.0), 2);
  float strata = pnoise(vec2(uv.y * 30.0 + pnoise(uv * 4.0, vec2(4.0)) * 2.0, 0.5), vec2(30.0, 1.0));
  h = 0.5 + 0.16 * large + 0.14 * (block - 0.5) * bevel + 0.08 * bevel + 0.1 * detail + 0.04 * micro - 0.32 * crack - 0.07 * chip;
  vec3 base = mix(vec3(0.19, 0.185, 0.17), vec3(0.36, 0.345, 0.32), 0.5 + 0.5 * detail);
  // Each block weathers a little differently; large-scale staining ties them together.
  base *= 0.9 + 0.16 * block + 0.1 * large;
  float stain = smoothstep(0.2, 0.7, pfbm(uv * 3.0 + 5.0, vec2(3.0), 4));
  base = mix(base, base * vec3(0.78, 0.72, 0.64), stain * 0.45);
  // Mineral speckle.
  float speck = hash12(floor(uv * 256.0));
  base = mix(base, vec3(0.52, 0.48, 0.45), step(0.93, speck) * 0.6);
  base = mix(base, vec3(0.07, 0.07, 0.07), step(speck, 0.05) * 0.5);
  base *= 1.0 + 0.08 * strata;
  // Lichen crusts, thicker on the upper faces of blocks.
  float lichen = smoothstep(0.35, 0.55, pfbm(uv * 7.0 + 9.0, vec2(7.0), 5)) * (0.5 + 0.5 * bevel);
  vec3 lichenCol = mix(vec3(0.38, 0.38, 0.28), vec3(0.4, 0.33, 0.14), hash12(vec2(block * 37.0, 3.0)));
  col = mix(base, lichenCol, lichen * 0.55);
  col *= 1.0 - crack * 0.62 - chip * 0.12;
}

void layerBasalt(vec2 uv, out vec3 col, out float h) {
  vec4 v = pvoronoi(uv * vec2(6.0, 6.0), vec2(6.0), 0.35);
  float joint = 1.0 - smoothstep(0.0, 0.07, v.y - v.x);
  vec4 ves = pvoronoi(uv * 55.0, vec2(55.0), 1.0);
  float pit = smoothstep(0.22, 0.1, ves.x) * step(0.55, ves.z);
  float detail = pfbm(uv * 20.0, vec2(20.0), 4);
  h = 0.55 + 0.15 * v.z + 0.1 * detail - 0.4 * joint - 0.15 * pit;
  col = mix(vec3(0.035, 0.035, 0.038), vec3(0.1, 0.1, 0.105), 0.5 + 0.5 * detail);
  col *= 0.85 + 0.3 * v.z;
  float rust = smoothstep(0.4, 0.7, pfbm(uv * 5.0 + 2.0, vec2(5.0), 4));
  col = mix(col, vec3(0.16, 0.08, 0.04), rust * 0.35);
  col *= 1.0 - joint * 0.6 - pit * 0.4;
}

void layerSand(vec2 uv, out vec3 col, out float h) {
  float warp = pfbm(uv * 3.0, vec2(3.0), 3);
  float ripples = sin((uv.x * 0.6 + uv.y) * 6.2831 * 14.0 + warp * 5.0);
  float grain = pfbm(uv * 120.0, vec2(120.0), 2);
  float low = pfbm(uv * 2.0, vec2(2.0), 3);
  h = 0.5 + 0.12 * ripples + 0.05 * grain + 0.15 * low;
  col = mix(vec3(0.42, 0.35, 0.24), vec3(0.6, 0.52, 0.38), 0.5 + 0.5 * low);
  col *= 0.93 + 0.14 * grain + 0.04 * ripples;
  vec4 shell = pvoronoi(uv * 70.0, vec2(70.0), 1.0);
  col = mix(col, vec3(0.8, 0.76, 0.68), smoothstep(0.12, 0.05, shell.x) * step(0.8, shell.z));
}

void layerGravel(vec2 uv, out vec3 col, out float h) {
  vec4 a = pvoronoi(uv * 22.0, vec2(22.0), 1.0);
  vec4 b = pvoronoi(uv * 40.0 + 0.5, vec2(40.0), 1.0);
  float stoneA = 1.0 - smoothstep(0.1, 0.48, a.x);
  float stoneB = 1.0 - smoothstep(0.1, 0.45, b.x);
  float gap = smoothstep(0.08, 0.0, a.y - a.x);
  h = max(stoneA * (0.6 + 0.4 * a.z), stoneB * 0.7 * (0.5 + 0.5 * b.z)) - gap * 0.3;
  vec3 ca = mix(vec3(0.2, 0.19, 0.17), vec3(0.42, 0.38, 0.33), a.z);
  ca = mix(ca, vec3(0.3, 0.22, 0.16), step(0.8, hash12(vec2(a.z, 3.0))));
  vec3 cb = mix(vec3(0.18, 0.17, 0.16), vec3(0.35, 0.33, 0.3), b.z);
  col = stoneA > stoneB * 0.7 ? ca : cb;
  col *= 0.7 + 0.3 * h;
  col = mix(col, vec3(0.07, 0.06, 0.05), gap * 0.7);
}

void layerSnow(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 2.5, vec2(2.5), 5);
  float wind = pnoise(uv * vec2(3.0, 18.0) + low, vec2(3.0, 18.0));
  float fine = pfbm(uv * 40.0, vec2(40.0), 2);
  h = 0.5 + 0.3 * low + 0.07 * wind + 0.02 * fine;
  col = mix(vec3(0.72, 0.77, 0.85), vec3(0.9, 0.92, 0.95), 0.5 + 0.5 * low);
  col *= 0.97 + 0.04 * fine;
}

void layerAsh(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 3.0, vec2(3.0), 5);
  vec4 cin = pvoronoi(uv * 26.0, vec2(26.0), 1.0);
  float cinder = smoothstep(0.35, 0.12, cin.x) * step(0.45, cin.z);
  float grain = pfbm(uv * 90.0, vec2(90.0), 2);
  h = 0.4 + 0.2 * low + 0.35 * cinder + 0.04 * grain;
  col = mix(vec3(0.05, 0.046, 0.045), vec3(0.14, 0.13, 0.125), 0.5 + 0.5 * low);
  col = mix(col, vec3(0.03, 0.028, 0.028), cinder * 0.8);
  float sulfur = smoothstep(0.55, 0.75, pfbm(uv * 4.0 + 7.0, vec2(4.0), 4));
  col = mix(col, vec3(0.42, 0.36, 0.08), sulfur * 0.35);
  col *= 0.9 + 0.2 * grain;
}

void layerLimestone(vec2 uv, out vec3 col, out float h) {
  vec4 v = pvoronoi(uv * 3.5, vec2(3.5), 1.0);
  float facet = v.x * 0.5;
  vec4 pits = pvoronoi(uv * 30.0, vec2(30.0), 1.0);
  float pit = smoothstep(0.25, 0.08, pits.x) * step(0.6, pits.z);
  float detail = pfbm(uv * 16.0, vec2(16.0), 5);
  float crack = 1.0 - smoothstep(0.0, 0.04, v.y - v.x);
  h = 0.55 + 0.15 * detail - 0.2 * facet - 0.25 * pit - 0.3 * crack;
  col = mix(vec3(0.42, 0.39, 0.33), vec3(0.62, 0.58, 0.5), 0.5 + 0.5 * detail);
  col = mix(col, vec3(0.3, 0.3, 0.26), pit * 0.6);
  float lichen = smoothstep(0.4, 0.6, pfbm(uv * 6.0 + 4.0, vec2(6.0), 4));
  col = mix(col, vec3(0.3, 0.32, 0.22), lichen * 0.4);
  col *= 1.0 - crack * 0.5;
}

void layerGlassSand(vec2 uv, out vec3 col, out float h) {
  float low = pfbm(uv * 3.0, vec2(3.0), 4);
  vec4 shard = pvoronoi(uv * 34.0, vec2(34.0), 1.0);
  float crystal = smoothstep(0.3, 0.1, shard.x) * step(0.72, shard.z);
  float grain = pfbm(uv * 80.0, vec2(80.0), 2);
  h = 0.4 + 0.2 * low + 0.45 * crystal + 0.03 * grain;
  col = mix(vec3(0.2, 0.18, 0.22), vec3(0.34, 0.31, 0.36), 0.5 + 0.5 * low);
  col *= 0.92 + 0.16 * grain;
  col = mix(col, vec3(0.55, 0.8, 0.78), crystal * 0.8);
}

void main() {
  vec2 uv = vUv;
  vec3 col;
  float h;
  if (uLayer == 0) layerMeadow(uv, col, h);
  else if (uLayer == 1) layerDryGrass(uv, col, h);
  else if (uLayer == 2) layerForestFloor(uv, col, h);
  else if (uLayer == 3) layerMoss(uv, col, h);
  else if (uLayer == 4) layerDirt(uv, col, h);
  else if (uLayer == 5) layerMud(uv, col, h);
  else if (uLayer == 6) layerGranite(uv, col, h);
  else if (uLayer == 7) layerBasalt(uv, col, h);
  else if (uLayer == 8) layerSand(uv, col, h);
  else if (uLayer == 9) layerGravel(uv, col, h);
  else if (uLayer == 10) layerSnow(uv, col, h);
  else if (uLayer == 11) layerAsh(uv, col, h);
  else if (uLayer == 12) layerLimestone(uv, col, h);
  else layerGlassSand(uv, col, h);
  // Output is linear albedo; the sRGB render target encodes it.
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(h, 0.0, 1.0));
}
`;

/** Pass B: tangent-space normal (xy), roughness, cavity AO — from the baked height. */
export const BAKE_NORMAL_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAlbedoHeight;
uniform int uLayer;
uniform float uStrength;
uniform float uSize;
varying vec2 vUv;
${NOISE_LIB}

float H(vec2 uv) { return texture(uAlbedoHeight, vec3(fract(uv), float(uLayer))).a; }

void main() {
  float t = 1.0 / uSize;
  float hl = H(vUv - vec2(t, 0.0));
  float hr = H(vUv + vec2(t, 0.0));
  float hd = H(vUv - vec2(0.0, t));
  float hu = H(vUv + vec2(0.0, t));
  float hc = H(vUv);
  vec3 n = normalize(vec3((hl - hr) * uStrength * uSize / 64.0, (hd - hu) * uStrength * uSize / 64.0, 1.0));
  // Cavity from a wider ring.
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    ring += H(vUv + vec2(cos(a), sin(a)) * t * 5.0);
  }
  ring /= 8.0;
  float ao = clamp(1.0 - (ring - hc) * 2.2, 0.35, 1.0);
  vec3 albedo = texture(uAlbedoHeight, vec3(vUv, float(uLayer))).rgb;
  float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  float r;
  if (uLayer == 5) r = mix(0.28, 0.75, smoothstep(0.35, 0.6, hc));           // mud: wet hollows
  else if (uLayer == 10) r = 0.62 - 0.1 * pnoise(vUv * 40.0, vec2(40.0));   // snow
  else if (uLayer == 13) r = mix(0.82, 0.18, smoothstep(0.6, 0.8, hc));      // crystal shards glint
  else if (uLayer == 8) r = 0.86;
  else if (uLayer == 6 || uLayer == 12) r = 0.72 + 0.18 * (1.0 - hc);
  else if (uLayer == 7) r = 0.66 + 0.2 * (1.0 - hc);
  else if (uLayer == 9) r = 0.55 + 0.35 * (1.0 - hc);
  else r = 0.8 + 0.15 * (1.0 - lum * 2.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(r, 0.05, 1.0), ao);
}
`;
