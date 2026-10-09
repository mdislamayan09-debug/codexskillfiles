// Shared GPU uniforms and GLSL snippets used by every custom/patched material.
import * as THREE from 'three';
import { WORLD_SIZE, RES } from './world.js';

// The lattice every shader's value noise reads: 256 x 256 uniform random numbers in a half-float texture, wrapped
// and bilinearly filtered. One fetch at a smoothed coordinate gives the same smooth value noise as four hashes and
// three mixes did; the ground's shader calls it well over a hundred times a pixel.
function noiseLattice() {
  const N = 256, d = new Uint16Array(N * N);
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i++) { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; d[i] = THREE.DataUtils.toHalfFloat(((t ^ (t >>> 14)) >>> 0) / 4294967296); }
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.HalfFloatType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export const U = {
  uNoise: { value: noiseLattice() },
  uTime: { value: 0 },
  uHeight: { value: null },
  uSplat: { value: null },
  uClimate: { value: null }, // r snow, g jungle, b autumn, a desert
  uWorldSize: { value: WORLD_SIZE },
  uRes: { value: RES },
  uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
  uFogColor: { value: new THREE.Color(0.62, 0.68, 0.74) },
  uFogSunColor: { value: new THREE.Color(1.0, 0.8, 0.55) },
  uFogDensity: { value: 0.0009 },
  uFogFalloff: { value: 0.022 },
  uFogBase: { value: 0 },   // height the fog layer sits on: the ground under the camera, eased
  uMist: { value: 0 },      // low cloud banks lying in mountain valleys (stormy cold weather)
  uBankBase: { value: 0 },
  uSnowPad: { value: new THREE.Vector4(0, 0, 0, 0) },   // x, z, radius, strength: built ground that keeps its snow whatever its height  // the valley floor ahead of the lens, which the fog bank lies on
  uSnowfall: { value: 0 },
  uCanopy: { value: 0 },
  uCanopySpot: { value: new THREE.Vector4(0, 0, 0, 0) },   // xyz a point the key shaft falls on, w its radius (0 = none)    // under a forest roof: the sun reaches the air and the floor only through its small gaps  // falling snow in the air: everything a few kilometres off dissolves into it
  uWind: { value: new THREE.Vector2(1, 0.3) },
  uWindStrength: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
  uNight: { value: 0 },
  uCloudShadow: { value: 0 },  // how much of the sun the broken storm deck blocks (0 = none)
  uCloudShadowOff: { value: new THREE.Vector2() },   // where the deck's breaks lie (a shot can wait for the light)
  uTrail: { value: Array.from({ length: 48 }, () => new THREE.Vector2()) },   // horse trail through snow (terrain)
  uTrailN: { value: 0 },
};

// the cloud-shadow field of GLSL_SUNSHADOW, on the CPU: how much of the sun reaches a point (0..1 before the
// uCloudShadow blend), for a given offset of the deck
export function cloudLight(x, y, z, off = U.uCloudShadowOff.value) {
  const fr = (v) => v - Math.floor(v), H = (px, py) => fr(Math.sin(px * 127.1 + py * 311.7) * 43758.5453);
  const N = (px, py) => { const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (H(ix, iy) * (1 - fx) + H(ix + 1, iy) * fx) * (1 - fy) + (H(ix, iy + 1) * (1 - fx) + H(ix + 1, iy + 1) * fx) * fy; };
  const L = U.uSunDir.value, k = Math.max(1800 - y, 200) / Math.max(L.y, 0.15);
  const qx = (x + L.x * k) / 2600 + U.uTime.value * 0.0012 + off.x, qy = (z + L.z * k) / 2600 + U.uTime.value * 0.0005 + off.y;
  const c = N(qx, qy) * 0.6 + N(qx * 2.3 + 7.1, qy * 2.3 + 7.1) * 0.3 + N(qx * 5.1 - 3.3, qy * 5.1 - 3.3) * 0.1;
  const t = Math.min(1, Math.max(0, (c - 0.46) / 0.24));
  return t * t * (3 - 2 * t);
}

export const GLSL_COMMON = /* glsl */ `
uniform sampler2D uHeight;
uniform sampler2D uSplat;
uniform sampler2D uClimate;
uniform float uWorldSize;
uniform float uRes;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
uniform vec3 uPlayerPos;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
uniform sampler2D uNoise;
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return textureLod(uNoise, (mod(i, 256.0) + u + 0.5) / 256.0, 0.0).r; }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
float fbm5(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }

float heightAt(vec2 xz){
  vec2 f = clamp((xz + uWorldSize*0.5) / uWorldSize * (uRes-1.0), vec2(0.0), vec2(uRes-1.001));
  ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
  float a = texelFetch(uHeight, i, 0).r;
  float b = texelFetch(uHeight, i+ivec2(1,0), 0).r;
  float c = texelFetch(uHeight, i+ivec2(0,1), 0).r;
  float d = texelFetch(uHeight, i+ivec2(1,1), 0).r;
  return mix(mix(a,b,t.x), mix(c,d,t.x), t.y);
}
vec3 normalAt(vec2 xz){
  float e = uWorldSize/(uRes-1.0);
  float hl = heightAt(xz-vec2(e,0.0)), hr = heightAt(xz+vec2(e,0.0));
  float hd = heightAt(xz-vec2(0.0,e)), hu = heightAt(xz+vec2(0.0,e));
  return normalize(vec3(hl-hr, 2.0*e, hd-hu));
}
vec4 splatAt(vec2 xz){ return texture(uSplat, (xz + uWorldSize*0.5)/uWorldSize); }
// climate weights: r snow cover, g jungle, b autumn, a desert
vec4 climateAt(vec2 xz){ return texture(uClimate, (xz + uWorldSize*0.5)/uWorldSize); }
`;

// Beyond 6.5 km every surface's depth is squeezed (monotonically) into 6.5–8 km: the distant ranges past the map
// edge (out to ~70 km) stay inside the far plane and still sort against each other and the world. Perspective only;
// the orthographic shadow pass is left alone. 8 km stays under the post chain's sky depth threshold.
export const GLSL_FAR_DEPTH = /* glsl */ `
void farDepth(inout vec4 pos){
  if (projectionMatrix[2][3] > -0.5 || pos.w < 6500.0) return;
  float dd = 6500.0 + 1500.0 * (1.0 - exp(-(pos.w - 6500.0) / 18000.0));
  float zc = projectionMatrix[2][2] * (-dd) + projectionMatrix[3][2];
  pos.z = zc / dd * pos.w;
}
`;

export const GLSL_SUNSHADOW = /* glsl */ `
float gSunVis = 1.0;
uniform float uCloudShadow;
uniform vec2 uCloudShadowOff;
uniform float uCanopy;
uniform vec4 uCanopySpot;
// The canopy's small gaps. A forest roof lets the sun through in thousands of openings far smaller than a shadow
// map of the whole stand can hold; they are what break the light into separate shafts in the air and into pools on
// the floor. The pattern is laid across the sun's own direction, so it is the same all the way down a ray: a beam
// in the haze ends in its own patch of light on the ground.
float canopyGaps(vec3 wp){
  if (uCanopy <= 0.001) return 1.0;
  vec3 L = normalize(uSunDir);
  vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), L)), Up = cross(L, R);
  vec2 q = vec2(dot(wp, R), dot(wp, Up));
  float n = mistN(q / 1.9) * 0.5 + mistN(q / 0.7 + 7.3) * 0.32 + mistN(q / 6.0 - 2.9) * 0.18 + (mistN(q / 19.0 + 4.4) - 0.5) * 0.2;   // (pools a metre or two across, gathered where the roof is thin)
  float gap = 0.02 + 0.98 * smoothstep(0.545, 0.655, n);   // (about a quarter of the floor in sun: soft-edged shafts, dark air between)
  // a shot's key light: one gap in the roof whose shaft falls on a chosen point (the rider), as a cinematographer
  // would wait for or cut
  if (uCanopySpot.w > 0.0) { vec2 q0 = vec2(dot(uCanopySpot.xyz, R), dot(uCanopySpot.xyz, Up)); gap = max(gap, smoothstep(uCanopySpot.w, uCanopySpot.w * 0.5, length(q - q0))); }
  return mix(1.0, gap, uCanopy);
}

// shadows of the cloud deck on the land: under a broken storm deck most of the ground lies in cloud shade and the
// breaks drop drifting pools of sunlight on slopes and peaks (the light the eye goes to)
float cloudShade(vec3 wp){
  if (uCloudShadow <= 0.001) return 1.0;
  vec3 L = normalize(uSunDir);
  vec2 q = (wp.xz + L.xz / max(L.y, 0.15) * max(1800.0 - wp.y, 200.0)) / 2600.0 + vec2(uTime * 0.0012, uTime * 0.0005) + uCloudShadowOff;
  float c = mistN(q) * 0.6 + mistN(q * 2.3 + 7.1) * 0.3 + mistN(q * 5.1 - 3.3) * 0.1;
  // (a broken deck still lets a good part of the sun's light down through its thin places: full-black shade laid
  // dark grey blotches with soft edges over every snow slope, like camouflage)
  return mix(1.0, 0.6 + 0.4 * smoothstep(0.42, 0.74, c), uCloudShadow);
}

// Long-range sun occlusion by the heightfield (ridges shadow valleys at golden hour).
float terrainSunShadow(vec3 wp){
  vec3 L = normalize(uSunDir);
  if (L.y < 0.0) return 1.0;
  float vis = 1.0; float t = 2.5;
  for (int i = 0; i < 16; i++){
    vec3 p = wp + L * t;
    float d = p.y - heightAt(p.xz);
    vis = min(vis, clamp(d / (t * 0.05 + 0.4) + 0.35, 0.0, 1.0));
    if (vis <= 0.0 || p.y > 1100.0) break;
    t *= 1.48;
  }
  return vis;
}
`;

export const GLSL_FOG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uMist;
uniform float uBankBase;
uniform float uSnowfall;
uniform float uNight;
// self-contained value noise (this block is also included by shaders that do not pull in GLSL_COMMON)
float mistH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mistN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mistH(i), mistH(i+vec2(1,0)), f.x), mix(mistH(i+vec2(0,1)), mistH(i+vec2(1,1)), f.x), f.y); }
vec3 applyAtmosphere(vec3 col, vec3 wpos){
  vec3 ray = wpos - cameraPosition;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  // the fog layer follows the local ground, so mountain valleys are as hazy as the lowlands
  float camH = max(cameraPosition.y - uFogBase, 0.0);
  float fh = uFogFalloff;
  float ry = rd.y; if (abs(ry) < 1e-3) ry = 1e-3;
  float amount = (uFogDensity / fh) * exp(-camH * fh) * (1.0 - exp(-dist * ry * fh)) / ry;
  // valleys far below the layer base would otherwise fill exponentially to an opaque white sheet
  amount = clamp(min(amount, uFogDensity * dist * 3.0), 0.0, 1e3);
  // a ceiling keeps far ranges as layered silhouettes instead of a white-out
  float fogF = min(1.0 - exp(-amount), 0.9);
  float mu = dot(rd, uSunDir);
  float sunAmt = pow(max(mu, 0.0), 3.0);
  vec3 cool = uFogColor * vec3(0.84, 0.9, 1.14);
  vec3 fogCol = mix(mix(cool, uFogColor, 0.5 + 0.5 * mu), uFogSunColor, sunAmt);
  // Extinction tints far colours blue-grey before full fog (aerial perspective)
  // (cold storm air is thick with ice haze: every ridge stands a tone paler and bluer than the one in front of it)
  vec3 ext = exp(-dist * vec3(0.00019, 0.00013, 0.00008) * (1.0 - uNight*0.5) * (1.0 + 0.55 * uMist));
  col = col * ext + fogCol * (1.0 - ext) * 0.72;
  col = mix(col, fogCol, fogF);
  // falling snow: the far walls and peaks fade out into the snowfall, to the tone of the sky behind them (a range
  // standing behind a nearer crest showed through it as a dark outline hung in the sky)
  col = mix(col, fogCol * 1.12, uSnowfall * 0.96 * (1.0 - exp(-max(dist - 350.0, 0.0) / 1450.0)));   // (the near walls keep their darks)
  // mist banks: torn layers of low cloud lying along the valley floors, thickening with distance
  if (uMist > 0.0) {
    // Valley fog as a layer of air, not paint: a bank lies between the valley floor and a ceiling a hundred metres
    // up, and what it hides depends on how far the sight line runs inside it. Looked down into from a height it
    // pools along the floor, thickening with distance, and whatever stands above the ceiling stands clear of it
    // with a soft edge where slopes rise out of it. (Painted onto surfaces by their height it never read as fog.)
    {
      float h1 = uBankBase + 78.0;
      float yc = cameraPosition.y, tIn = 0.0, tOut = dist;
      bool hit = true;
      if (yc > h1) { if (rd.y >= -1e-4) hit = false; else tIn = (yc - h1) / -rd.y; }
      else if (rd.y > 1e-4) tOut = min(dist, (h1 - yc) / rd.y);
      float Lb = hit ? max(0.0, tOut - tIn) : 0.0;
      if (Lb > 0.0) {
        // in banks, with clear air between them (sampled where the sight line is well inside the layer)
        vec3 pm = cameraPosition + rd * (tIn + min(Lb, 900.0) * 0.5);
        float bankN = smoothstep(0.42, 0.7, mistN(pm.xz / 620.0 + 1.7) * 0.65 + mistN(pm.xz / 210.0 - 4.1) * 0.35);
        // (thin enough that the floor's timber and river show through it, thick only in its banks)
        // (seen down into from above, the sight line crosses the layer in a couple of hundred metres, so the banks are
        // thick and the air between them clear; from inside the layer the same air is a thin veil)
        float m = 1.0 - exp(-Lb * uMist * (0.02 + 2.6 * bankN * bankN) / mix(800.0, 1500.0, step(yc, h1)));
        col = mix(col, mix(vec3(0.74, 0.8, 0.9) * (1.0 - 0.8 * uNight), fogCol, 0.25), clamp(m, 0.0, 0.7));
      }
    }
    // and a thin band of low cloud a few hundred metres up, in torn rags, also a layer the sight line runs through:
    // it crosses in front of the mountainsides as a level streak of mist with clear air above and below it
    // (painted onto the slopes by their height it lay on them as airbrushed smears)
    {
      float y0 = uBankBase + 240.0, y1 = uBankBase + 330.0, yc = cameraPosition.y, ta, tb, L2 = 0.0, tm = 0.0;
      if (abs(rd.y) < 1e-4) { if (yc > y0 && yc < y1) { L2 = dist; tm = dist * 0.5; } }
      else { ta = (y0 - yc) / rd.y; tb = (y1 - yc) / rd.y; float t0 = max(0.0, min(ta, tb)), t1 = min(dist, max(ta, tb)); L2 = max(0.0, t1 - t0); tm = 0.5 * (t0 + t1); }
      if (L2 > 0.0) {
        vec3 pm = cameraPosition + rd * tm;
        float rag = smoothstep(0.5, 0.74, mistN(pm.xz / 780.0 + 6.1) * 0.6 + mistN(pm.xz / 260.0 - 3.7) * 0.4);
        float m2 = 1.0 - exp(-L2 * uMist * rag / 2600.0);
        col = mix(col, mix(vec3(0.72, 0.79, 0.9) * (1.0 - 0.8 * uNight), fogCol, 0.3), clamp(m2, 0.0, 0.5));
      }
    }
    // and the far ranges step back in pale blue-grey layers
    col = mix(col, uFogColor * vec3(0.95, 1.02, 1.15), uMist * 0.16 * (1.0 - exp(-dist / 4200.0)));
    // and past three kilometres or so every range is a flat blue-grey shape, each paler than the one before it (a
    // sunlit snow massif six kilometres off stood as the brightest, whitest thing in the frame)
    col = mix(col, uFogColor * vec3(1.0, 1.06, 1.18), min(uMist * 1.1, 1.0) * 0.72 * smoothstep(3400.0, 9500.0, dist));
  }
  return col;
}
`;

// Patch any built-in three.js material: swap the standard fog for height-fog with sun scattering,
// expose world position, and share uniforms.
export function patchMaterial(mat, { vertexHead = '', vertexBody = null, fragHead = '', fragColor = null, beginNormal = null, onShader = null, vertexReplace = null, noFlip = false, sunShadow = false } = {}) {
  mat.fog = false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_FAR_DEPTH}\nvarying vec3 vWPos;\n${vertexHead}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n farDepth(gl_Position);');
    if (beginNormal) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', beginNormal);
    if (vertexBody) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', vertexBody);
    if (vertexReplace) for (const [a, b] of vertexReplace) shader.vertexShader = shader.vertexShader.replace(a, b);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      {
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          wp4 = batchingMatrix * wp4;
        #endif
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz;
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_FOG_PARS}\n${GLSL_SUNSHADOW}\nvarying vec3 vWPos;\n${fragHead}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.rgb = applyAtmosphere(min(gl_FragColor.rgb, vec3(4.0)), vWPos);`);   // clamp specular fireflies before bloom
    if (fragColor) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', fragColor);
    // every lit surface takes the cloud shadows; terrain-aware materials also take the ridges' long shadows
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n gSunVis = ' + (sunShadow ? 'terrainSunShadow(vWPos) * ' : '') + 'cloudShade(vWPos) * canopyGaps(vWPos);')
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= gSunVis;'));
    if (noFlip) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;');
    if (onShader) onShader(shader, renderer);
    if (prev) prev(shader, renderer);
  };
  // make program cache key distinct per patch
  const key = (sunShadow ? 'ss' : '') + (noFlip ? 'nf' : '') + (vertexBody || '') + (fragColor || '') + (vertexHead || '') + (fragHead || '') + (beginNormal || '');
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  mat.customProgramCacheKey = () => 'p' + h;
  return mat;
}
