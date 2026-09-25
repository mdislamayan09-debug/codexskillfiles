import * as THREE from 'three';
import { createFullscreenMaterial, FullscreenPass } from '../FullscreenPass';

// Bark and foliage textures baked on the GPU once at startup.
// Bark: tileable (u around the trunk, v along it). Foliage: alpha-cut cards.

export const BARK = { pine: 0, birch: 1, oak: 2, dead: 3, glass: 4, swamp: 5 } as const;
export const BARK_COUNT = 6;
export const FOLIAGE = { spruce: 0, pine: 1, birch: 2, oak: 3, bush: 4, dry: 5, glass: 6, moss: 7 } as const;
export const FOLIAGE_COUNT = 8;

const LIB = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(mod(i, per)) * 2.0 - 1.0, f);
  float b = dot(hash22(mod(i + vec2(1.0, 0.0), per)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(mod(i + vec2(0.0, 1.0), per)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(mod(i + vec2(1.0, 1.0), per)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, vec2 per, int oct) {
  float s = 0.0; float a = 0.5; float n = 0.0;
  for (int o = 0; o < 7; o++) { if (o >= oct) break; s += a * pnoise(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
  return s / n;
}
vec4 pvoronoi(vec2 p, vec2 per, float jitter) {
  vec2 i = floor(p); vec2 f = fract(p);
  float f1 = 8.0; float f2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 cell = mod(i + g, per);
    vec2 o = 0.5 + (hash22(cell) - 0.5) * jitter;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(cell * 1.37 + 0.71); } else if (d < f2) f2 = d;
  }
  return vec4(sqrt(f1), sqrt(f2), id, 0.0);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
`;

/** Bark albedo (sRGB) + height. u wraps around the trunk; v runs along it. */
const BARK_FRAG = /* glsl */ `
precision highp float;
uniform int uLayer;
varying vec2 vUv;
${LIB}
void main() {
  vec2 uv = vUv;
  vec3 col; float h;
  if (uLayer == 0) {
    // Pine: long irregular plates split by furrows that wander, widen and
    // pinch shut; plates stand at their own depths and flake in thin
    // layers, grey where weathered and rust-red where freshly shed.
    vec2 w = vec2(pfbm(uv * vec2(3.0, 2.0), vec2(3.0, 2.0), 4), pfbm(uv * vec2(3.0, 2.0) + 7.3, vec2(3.0, 2.0), 4));
    vec2 puv = uv + w * vec2(0.09, 0.14);
    vec4 v = pvoronoi(puv * vec2(8.0, 2.0), vec2(8.0, 2.0), 1.0);
    float edge = v.y - v.x;
    // Not every joint opens: some plates are still fused.
    float open = smoothstep(-0.55, 0.25, pnoise(puv * vec2(16.0, 6.0) + v.z * 7.0, vec2(16.0, 6.0)));
    float fissure = smoothstep(0.0, 0.02 + 0.2 * open, edge);
    float fused = 1.0 - open;
    fissure = max(fissure, fused * 0.7);
    // Flakes: thin layers peeling on each plate, stepped in height.
    float fl = pfbm(puv * vec2(14.0, 9.0) + v.z * 3.0, vec2(14.0, 9.0), 4);
    float layers = floor((fl * 0.5 + 0.5) * 4.0) / 4.0;
    float lip = smoothstep(0.0, 0.04, fract((fl * 0.5 + 0.5) * 4.0));
    vec4 sub = pvoronoi(puv * vec2(22.0, 7.0), vec2(22.0, 7.0), 1.0);
    float crack = (1.0 - smoothstep(0.0, 0.04, sub.y - sub.x)) * step(0.4, sub.z);
    float scale = pfbm(uv * vec2(60.0, 90.0), vec2(60.0, 90.0), 2);
    h = fissure * (0.45 + 0.25 * v.z + 0.18 * layers + 0.04 * lip) - crack * 0.1 * fissure + scale * 0.035;
    vec3 grey = vec3(0.17, 0.145, 0.125);
    vec3 rust = vec3(0.32, 0.16, 0.085);
    vec3 umber = vec3(0.14, 0.09, 0.06);
    float fresh = smoothstep(0.55, 0.85, 1.0 - layers + 0.25 * v.z) * (1.0 - lip * 0.5);
    vec3 plate = mix(mix(grey, umber, v.z * 0.6), rust, fresh * 0.75);
    plate *= 0.82 + 0.3 * fl + 0.1 * scale;
    // Lichen dust on the weathered faces.
    plate = mix(plate, vec3(0.24, 0.26, 0.19), smoothstep(0.62, 0.8, pfbm(uv * vec2(5.0, 3.0) + 9.0, vec2(5.0, 3.0), 4)) * (1.0 - fresh) * 0.35);
    col = mix(vec3(0.04, 0.028, 0.02), plate, pow(fissure, 0.7));
    col *= 1.0 - crack * 0.3 * fissure;
  } else if (uLayer == 1) {
    // Birch: chalk-white with horizontal lenticels and black scar patches.
    // Lenticels: short dark horizontal dashes.
    vec4 lc = pvoronoi(uv * vec2(6.0, 40.0), vec2(6.0, 40.0), 1.0);
    vec2 lcell = uv * vec2(6.0, 40.0);
    float dash = smoothstep(0.35, 0.15, abs(fract(lcell.y) - 0.5) * 2.0) * step(0.55, lc.z);
    float lent = dash * smoothstep(0.55, 0.2, lc.x);
    // Black diamond scars below old branches, and dark patches.
    float scars = smoothstep(0.42, 0.62, pfbm(uv * vec2(2.0, 5.0) + 3.0, vec2(2.0, 5.0), 5));
    vec4 dia = pvoronoi(uv * vec2(2.0, 3.0), vec2(2.0, 3.0), 0.8);
    float diamond = step(0.72, dia.z) * (1.0 - smoothstep(0.08, 0.22, abs(dia.x * 1.2 - 0.0) + abs(fract(uv.y * 3.0) - 0.5) * 0.15));
    scars = max(scars, diamond);
    float peel = pfbm(uv * vec2(8.0, 16.0), vec2(8.0, 16.0), 3);
    col = mix(vec3(0.78, 0.76, 0.7), vec3(0.62, 0.58, 0.52), 0.5 + 0.5 * peel);
    col = mix(col, vec3(0.05, 0.045, 0.04), max(lent * 0.8, scars * 0.9));
    col = mix(col, vec3(0.55, 0.42, 0.3), smoothstep(0.55, 0.8, peel) * 0.3);
    h = 0.6 - lent * 0.3 - scars * 0.35 + peel * 0.1;
  } else if (uLayer == 2) {
    // Oak: deep interlaced furrows.
    float warp = pfbm(uv * vec2(4.0, 3.0), vec2(4.0, 3.0), 3);
    float ridges = abs(sin((uv.x * 14.0 + warp * 2.5) * 3.14159));
    float cross = pfbm(uv * vec2(10.0, 20.0), vec2(10.0, 20.0), 4);
    h = pow(ridges, 0.6) * 0.8 + cross * 0.2;
    col = mix(vec3(0.05, 0.045, 0.04), vec3(0.26, 0.22, 0.18), h) * (0.85 + 0.3 * cross);
    col = mix(col, vec3(0.2, 0.26, 0.12), smoothstep(0.45, 0.7, pfbm(uv * 3.0 + 5.0, vec2(3.0), 4)) * 0.45);
  } else if (uLayer == 3) {
    // Dead wood: bleached, split along the grain.
    float grain = pnoise(uv * vec2(30.0, 2.0), vec2(30.0, 2.0)) * 0.6 + pnoise(uv * vec2(80.0, 5.0), vec2(80.0, 5.0)) * 0.4;
    float crack = smoothstep(0.08, 0.0, abs(pnoise(uv * vec2(7.0, 1.0), vec2(7.0, 1.0))));
    h = 0.5 + grain * 0.3 - crack * 0.4;
    col = mix(vec3(0.3, 0.29, 0.27), vec3(0.52, 0.5, 0.47), 0.5 + 0.5 * grain) * (1.0 - crack * 0.6);
  } else if (uLayer == 4) {
    // Glass trunk: faceted translucent crystal.
    vec4 v = pvoronoi(uv * vec2(4.0, 6.0), vec2(4.0, 6.0), 1.0);
    h = 0.5 + v.z * 0.3 - smoothstep(0.05, 0.0, v.y - v.x) * 0.3;
    col = mix(vec3(0.42, 0.62, 0.66), vec3(0.72, 0.86, 0.9), v.z);
  } else {
    // Swamp: dark, wet, moss-streaked.
    float streak = pfbm(uv * vec2(6.0, 2.0), vec2(6.0, 2.0), 5);
    float moss = smoothstep(0.1, 0.5, pfbm(uv * vec2(3.0, 5.0) + 2.0, vec2(3.0, 5.0), 5));
    h = 0.5 + streak * 0.3;
    col = mix(vec3(0.07, 0.06, 0.045), vec3(0.18, 0.15, 0.11), 0.5 + 0.5 * streak);
    col = mix(col, vec3(0.1, 0.16, 0.05), moss * 0.7);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(h, 0.0, 1.0));
}
`;

const BARK_NORMAL_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uBark;
uniform int uLayer;
varying vec2 vUv;
float H(vec2 uv) { return texture(uBark, vec3(fract(uv), float(uLayer))).a; }
void main() {
  float t = 1.0 / 512.0;
  float s = uLayer == 1 ? 3.0 : 7.0;
  vec3 n = normalize(vec3((H(vUv - vec2(t, 0.0)) - H(vUv + vec2(t, 0.0))) * s, (H(vUv - vec2(0.0, t)) - H(vUv + vec2(0.0, t))) * s, 1.0));
  float rough = uLayer == 4 ? 0.12 : (uLayer == 5 ? 0.55 : 0.88);
  float ao = clamp(0.35 + H(vUv) * 0.9, 0.0, 1.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, rough, ao);
}
`;

/**
 * Foliage cards: RGB albedo (sRGB) + alpha coverage. The companion normal
 * texture stores a curved card normal (xy), translucency (b) and AO (a).
 */
const FOLIAGE_FRAG = /* glsl */ `
precision highp float;
uniform int uLayer;
uniform int uOutput; // 0 albedo+alpha, 1 normal/translucency/ao
varying vec2 vUv;
${LIB}

// A single leaf blade in local coords (x across, y along 0..1).
float leafShape(vec2 p, float width, float tipSharp) {
  if (p.y < 0.0 || p.y > 1.0) return 0.0;
  float w = width * pow(sin(3.14159 * pow(p.y, 0.8)), tipSharp);
  return smoothstep(w, w * 0.8, abs(p.x));
}

void main() {
  vec2 uv = vUv;
  float alpha = 0.0;
  vec3 col = vec3(0.0);
  vec2 nrm = vec2(0.0);
  float trans = 0.0;
  float ao = 1.0;

  if (uLayer == 0) {
    // Spruce frond: a main axis with alternating branchlets, all densely needled.
    vec2 a = vec2(0.5, 0.02);
    vec2 b = vec2(0.52, 0.98);
    float axis = smoothstep(0.011, 0.004, segDist(uv, a, b));
    float needles = 0.0;
    float shade = 0.0;
    float twig = axis;
    for (int k = 0; k < 11; k++) {
      float fk = float(k);
      float t = 0.08 + 0.84 * (fk / 10.0);
      vec2 base = mix(a, b, t);
      float side = mod(fk, 2.0) < 1.0 ? -1.0 : 1.0;
      vec2 dir = normalize(vec2(side * 0.85, 0.5));
      float len = 0.42 * (1.0 - t * 0.55);
      vec2 tip = base + dir * len;
      float dBr = segDist(uv, base, tip);
      if (dBr > 0.075) continue;
      twig = max(twig, smoothstep(0.007, 0.002, dBr));
      for (int n = 0; n < 14; n++) {
        float fn = float(n);
        float along = (fn + 0.5) / 14.0;
        vec2 np = mix(base, tip, along);
        float ns = mod(fn, 2.0) < 1.0 ? -1.0 : 1.0;
        vec2 perp = vec2(-dir.y, dir.x) * ns;
        vec2 nd = normalize(perp + dir * 0.9);
        float nl = 0.055 * (1.0 - along * 0.35);
        float d = segDist(uv, np, np + nd * nl);
        float nv = smoothstep(0.0075, 0.0025, d);
        if (nv > needles) { needles = nv; shade = hash12(vec2(fk * 13.0 + fn, 3.0)); }
      }
    }
    // Needles along the main axis too.
    for (int n = 0; n < 26; n++) {
      float fn = float(n);
      float along = 0.04 + 0.92 * fn / 26.0;
      vec2 np = mix(a, b, along);
      float ns = mod(fn, 2.0) < 1.0 ? -1.0 : 1.0;
      vec2 nd = normalize(vec2(ns, 0.9));
      float d = segDist(uv, np, np + nd * 0.06);
      float nv = smoothstep(0.008, 0.003, d);
      if (nv > needles) { needles = nv; shade = hash12(vec2(fn, 9.0)); }
    }
    alpha = max(needles, twig);
    vec3 needleCol = mix(vec3(0.025, 0.07, 0.045), vec3(0.07, 0.16, 0.1), shade);
    col = mix(needleCol, vec3(0.22, 0.13, 0.07), twig * (1.0 - needles * 0.7));
    nrm = vec2((uv.x - 0.5) * 0.8, 0.0);
    trans = 0.3;
    ao = mix(0.55, 1.0, uv.y);
  } else if (uLayer == 1) {
    // Pine: long needles in bunches (fascicles) along a twig.
    vec2 a = vec2(0.5, 0.02);
    vec2 b = vec2(0.5, 0.62);
    float twig = smoothstep(0.012, 0.005, segDist(uv, a, b));
    float needles = 0.0;
    float shade = 0.0;
    for (int f = 0; f < 16; f++) {
      float ff = float(f);
      vec2 base = mix(a, b, 0.1 + 0.9 * ff / 15.0);
      for (int n = 0; n < 5; n++) {
        float fn = float(n);
        float ang = (fn - 2.0) * 0.28 + (hash12(vec2(ff, fn)) - 0.5) * 0.3 + (ff / 15.0 - 0.5) * 0.9;
        vec2 nd = vec2(sin(ang), cos(ang));
        float nl = 0.36 * (0.75 + 0.25 * hash12(vec2(fn, ff + 4.0)));
        float d = segDist(uv, base, base + nd * nl);
        float nv = smoothstep(0.006, 0.002, d);
        if (nv > needles) { needles = nv; shade = hash12(vec2(ff * 7.0 + fn, 1.0)); }
      }
    }
    alpha = max(needles, twig);
    vec3 needleCol = mix(vec3(0.06, 0.12, 0.04), vec3(0.17, 0.25, 0.09), shade);
    col = mix(needleCol, vec3(0.25, 0.15, 0.08), twig * (1.0 - needles * 0.8));
    nrm = vec2((uv.x - 0.5) * 0.9, 0.0);
    trans = 0.35;
    ao = mix(0.6, 1.0, uv.y);
  } else if (uLayer == 7) {
    // Hanging moss: dangling strands.
    float strands = 0.0;
    for (int i = 0; i < 40; i++) {
      float fi = float(i);
      float x = hash12(vec2(fi, 2.0));
      float len = 0.4 + 0.6 * hash12(vec2(fi, 5.0));
      float wav = sin(uv.y * 20.0 + fi) * 0.01;
      float d = abs(uv.x - x - wav);
      strands = max(strands, smoothstep(0.012, 0.003, d) * step(1.0 - len, 1.0 - uv.y) * step(0.0, uv.y));
    }
    alpha = strands;
    col = mix(vec3(0.16, 0.18, 0.09), vec3(0.3, 0.32, 0.18), hash12(floor(uv * 40.0)));
    trans = 0.2;
    ao = mix(0.5, 1.0, uv.y);
  } else {
    // Broadleaf sprays: a stem from the card base with twigs branching off
    // it alternately, each carrying leaves at their real size (a card is
    // over a metre across, so an oak leaf is under a tenth of it).
    float width = uLayer == 2 ? 0.034 : (uLayer == 3 ? 0.045 : (uLayer == 4 ? 0.042 : 0.036));
    float leafLen = uLayer == 2 ? 0.072 : (uLayer == 3 ? 0.092 : (uLayer == 4 ? 0.075 : 0.078));
    float best = 0.0;
    float shade = 0.0;
    vec2 bestLocal = vec2(0.0);
    vec2 stemA = vec2(0.5, 0.02);
    vec2 stemB = vec2(0.52, 0.78);
    float twigMask = smoothstep(0.007, 0.0025, segDist(uv, stemA, stemB));
    for (int tw = 0; tw < 7; tw++) {
      float ft = float(tw);
      float sideT = mod(ft, 2.0) < 1.0 ? -1.0 : 1.0;
      vec2 a = mix(stemA, stemB, 0.08 + 0.13 * ft);
      float spread = 0.36 * (1.0 - ft / 9.0) + 0.1;
      vec2 b = a + normalize(vec2(sideT * (0.9 - ft * 0.08), 0.75 + ft * 0.1)) * spread;
      if (tw == 6) b = vec2(0.5 + (hash12(vec2(ft, float(uLayer))) - 0.5) * 0.1, 0.98);
      // Cheap reject: this twig's leaves stay within a band round it.
      if (segDist(uv, a, b) > leafLen * 1.3) continue;
      twigMask = max(twigMask, smoothstep(0.0045, 0.0015, segDist(uv, a, b)));
      for (int i = 0; i < 20; i++) {
        float fi = float(i);
        vec3 h = vec3(hash12(vec2(fi + ft * 17.0, float(uLayer))), hash12(vec2(fi * 1.7, ft + 3.0)), hash12(vec2(fi + 9.0, ft * 2.3)));
        float along = 0.06 + 0.94 * (fi / 19.0);
        vec2 base = mix(a, b, along);
        float side = mod(fi, 2.0) < 1.0 ? -1.0 : 1.0;
        vec2 td = normalize(b - a);
        float ang = atan(td.x, td.y) + side * (0.55 + 0.6 * h.x);
        vec2 local = rot(-ang) * (uv - base);
        float size = leafLen * (0.7 + 0.45 * h.y) * (1.0 - along * 0.2);
        // A short stalk before the blade.
        vec2 lp = vec2(local.x / size, local.y / size - 0.12);
        float s = leafShape(lp, width / leafLen, uLayer == 3 ? 0.6 : 0.8);
        if (s > best) { best = s; shade = h.z; bestLocal = lp; }
      }
    }
    alpha = max(best, twigMask);
    float vein = smoothstep(0.04, 0.0, abs(bestLocal.x)) * 0.5 + smoothstep(0.03, 0.0, abs(fract((bestLocal.y - abs(bestLocal.x) * 1.4) * 6.0) - 0.5) * 0.12) * 0.15;
    vec3 young, old;
    if (uLayer == 2) { young = vec3(0.25, 0.36, 0.07); old = vec3(0.1, 0.2, 0.04); }
    else if (uLayer == 3) { young = vec3(0.14, 0.24, 0.05); old = vec3(0.05, 0.12, 0.03); }
    else if (uLayer == 4) { young = vec3(0.12, 0.22, 0.06); old = vec3(0.05, 0.11, 0.03); }
    else if (uLayer == 5) { young = vec3(0.45, 0.25, 0.07); old = vec3(0.3, 0.13, 0.04); }
    else { young = vec3(0.4, 0.7, 0.68); old = vec3(0.2, 0.45, 0.5); }
    col = mix(old, young, shade);
    col *= 1.0 - vein * 0.25;
    col *= 0.8 + 0.25 * smoothstep(0.0, 0.8, bestLocal.y);
    col = mix(col, vec3(0.18, 0.12, 0.07), twigMask * step(best, 0.5));
    // Curved leaf normal: tilt across the blade.
    nrm = vec2(bestLocal.x * 0.8, (bestLocal.y - 0.5) * 0.3);
    trans = uLayer == 6 ? 0.8 : 0.55;
    ao = mix(0.55, 1.0, uv.y);
  }
  if (uOutput == 0) gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
  else gl_FragColor = vec4(clamp(nrm * 0.5 + 0.5, 0.0, 1.0), trans, ao);
}
`;

export class FoliageTextures {
  readonly bark: THREE.WebGLArrayRenderTarget;
  readonly barkNormal: THREE.WebGLArrayRenderTarget;
  readonly foliage: THREE.WebGLArrayRenderTarget;
  readonly foliageNormal: THREE.WebGLArrayRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      anisotropy: 8,
    };
    this.bark = new THREE.WebGLArrayRenderTarget(size, size, BARK_COUNT, opts);
    this.bark.texture.colorSpace = THREE.SRGBColorSpace;
    this.barkNormal = new THREE.WebGLArrayRenderTarget(size, size, BARK_COUNT, opts);
    const foliageOpts = { ...opts, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.foliage = new THREE.WebGLArrayRenderTarget(size, size, FOLIAGE_COUNT, foliageOpts);
    this.foliage.texture.colorSpace = THREE.SRGBColorSpace;
    this.foliageNormal = new THREE.WebGLArrayRenderTarget(size, size, FOLIAGE_COUNT, foliageOpts);
    this.bake(renderer);
  }

  private bake(renderer: THREE.WebGLRenderer): void {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previous = renderer.getRenderTarget();
    const barkPass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: BARK_FRAG, uniforms: { uLayer: { value: 0 } } }));
    const barkNormalPass = new FullscreenPass(
      createFullscreenMaterial({ fragmentShader: BARK_NORMAL_FRAG, uniforms: { uBark: { value: this.bark.texture }, uLayer: { value: 0 } } }),
    );
    const foliagePass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: FOLIAGE_FRAG, uniforms: { uLayer: { value: 0 }, uOutput: { value: 0 } } }));
    for (let i = 0; i < BARK_COUNT; i += 1) {
      barkPass.material.uniforms.uLayer.value = i;
      renderer.setRenderTarget(this.bark, i);
      renderer.render(barkPass.mesh, camera);
    }
    for (let i = 0; i < BARK_COUNT; i += 1) {
      barkNormalPass.material.uniforms.uLayer.value = i;
      renderer.setRenderTarget(this.barkNormal, i);
      renderer.render(barkNormalPass.mesh, camera);
    }
    for (let i = 0; i < FOLIAGE_COUNT; i += 1) {
      foliagePass.material.uniforms.uLayer.value = i;
      foliagePass.material.uniforms.uOutput.value = 0;
      renderer.setRenderTarget(this.foliage, i);
      renderer.render(foliagePass.mesh, camera);
      foliagePass.material.uniforms.uOutput.value = 1;
      renderer.setRenderTarget(this.foliageNormal, i);
      renderer.render(foliagePass.mesh, camera);
    }
    renderer.setRenderTarget(previous);
    barkPass.dispose();
    barkNormalPass.dispose();
    foliagePass.dispose();
  }

  dispose(): void {
    this.bark.dispose();
    this.barkNormal.dispose();
    this.foliage.dispose();
    this.foliageNormal.dispose();
  }
}
