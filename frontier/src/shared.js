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
};

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

export const GLSL_SUNSHADOW = /* glsl */ `
float gSunVis = 1.0;
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
    float bank = smoothstep(70.0, 5.0, above) * (0.35 + 0.65 * smoothstep(0.35, 0.7, mistN(wpos.xz / 420.0)));
    float m = uMist * bank * (1.0 - exp(-dist / 1100.0));
    col = mix(col, mix(uFogColor * 1.15, fogCol, 0.4), clamp(m, 0.0, 0.85));
    // and the far ranges step back in pale blue-grey layers
    col = mix(col, uFogColor * vec3(1.15, 1.25, 1.45), uMist * 0.62 * (1.0 - exp(-dist / 2600.0)));
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
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nvarying vec3 vWPos;\n${vertexHead}`);
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
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vWPos);`);
    if (fragColor) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', fragColor);
    if (sunShadow) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n gSunVis = terrainSunShadow(vWPos);')
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= gSunVis;'));
    }
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
