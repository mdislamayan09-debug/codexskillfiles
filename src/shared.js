// Shared GPU uniforms and GLSL snippets used by every custom/patched material.
import * as THREE from 'three';
import { WORLD_SIZE, RES } from './world.js';

export const U = {
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
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
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
// shadows of the cloud deck on the land: under a broken storm deck most of the ground lies in cloud shade and the
// breaks drop drifting pools of sunlight on slopes and peaks (the light the eye goes to)
float cloudShade(vec3 wp){
  if (uCloudShadow <= 0.001) return 1.0;
  vec3 L = normalize(uSunDir);
  vec2 q = (wp.xz + L.xz / max(L.y, 0.15) * max(1800.0 - wp.y, 200.0)) / 2600.0 + vec2(uTime * 0.0012, uTime * 0.0005) + uCloudShadowOff;
  float c = mistN(q) * 0.6 + mistN(q * 2.3 + 7.1) * 0.3 + mistN(q * 5.1 - 3.3) * 0.1;
  // (a broken deck still lets a good part of the sun's light down through its thin places: full-black shade laid
  // dark grey blotches with soft edges over every snow slope, like camouflage)
  return mix(1.0, 0.42 + 0.58 * smoothstep(0.46, 0.7, c), uCloudShadow);
}

// Long-range sun occlusion by the heightfield (ridges shadow valleys at golden hour).
float terrainSunShadow(vec3 wp){
  vec3 L = normalize(uSunDir);
  if (L.y < 0.0) return 1.0;
  float vis = 1.0; float t = 2.5;
  for (int i = 0; i < 22; i++){
    vec3 p = wp + L * t;
    float d = p.y - heightAt(p.xz);
    vis = min(vis, clamp(d / (t * 0.05 + 0.4) + 0.35, 0.0, 1.0));
    if (vis <= 0.0 || p.y > 700.0) break;
    t *= 1.33;
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
  vec3 ext = exp(-dist * vec3(0.00019, 0.00013, 0.00008) * (1.0 - uNight*0.5));
  col = col * ext + fogCol * (1.0 - ext) * 0.72;
  col = mix(col, fogCol, fogF);
  // mist banks: torn layers of low cloud lying along the valley floors, thickening with distance
  if (uMist > 0.0) {
    float above = wpos.y - uFogBase;
    // (separate banks lying in the hollows with clear air between them: one even layer over the whole floor
    // milked out the valley and hid its timber and river; banks hide a part and show the rest dark beside them)
    float bankN = smoothstep(0.5, 0.7, mistN(wpos.xz / 560.0 + 1.7) * 0.65 + mistN(wpos.xz / 190.0 - 4.1) * 0.35);
    float bank = smoothstep(110.0, 15.0, above) * bankN;
    float m = uMist * bank * (1.0 - exp(-dist / 650.0)) * 1.25;
    col = mix(col, mix(uFogColor * 1.22, fogCol, 0.3), clamp(m, 0.0, 0.9));
    // low cloud clinging to the mountainsides a few hundred metres up, torn into drifting rags
    float band = smoothstep(120.0, 260.0, above) * smoothstep(700.0, 420.0, above);
    // (torn into separate rags with clear air between: a continuous band read as one white sheet over the slopes)
    float rag = smoothstep(0.52, 0.85, mistN(wpos.xz / 650.0 + vec2(wpos.y / 400.0, 0.0)) * 0.65 + mistN(wpos.xz / 190.0 - 3.7) * 0.35);
    col = mix(col, mix(uFogColor * 1.15, fogCol, 0.35), clamp(uMist * band * rag * 0.45 * (1.0 - exp(-dist / 1800.0)), 0.0, 0.6));
    // and the far ranges step back in pale blue-grey layers
    col = mix(col, uFogColor * vec3(0.95, 1.02, 1.15), uMist * 0.16 * (1.0 - exp(-dist / 4200.0)));
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
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n gSunVis = ' + (sunShadow ? 'terrainSunShadow(vWPos) * ' : '') + 'cloudShade(vWPos);')
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
