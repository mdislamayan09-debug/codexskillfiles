// Shared GPU uniforms and GLSL snippets used by every custom/patched material.
import * as THREE from 'three';
import { WORLD_SIZE, RES } from './world.js';

export const U = {
  uTime: { value: 0 },
  uHeight: { value: null },
  uSplat: { value: null },
  uWorldSize: { value: WORLD_SIZE },
  uRes: { value: RES },
  uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
  uFogColor: { value: new THREE.Color(0.62, 0.68, 0.74) },
  uFogSunColor: { value: new THREE.Color(1.0, 0.8, 0.55) },
  uFogDensity: { value: 0.0009 },
  uFogFalloff: { value: 0.022 },
  uWind: { value: new THREE.Vector2(1, 0.3) },
  uWindStrength: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
  uNight: { value: 0 },
};

export const GLSL_COMMON = /* glsl */ `
uniform sampler2D uHeight;
uniform sampler2D uSplat;
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
`;

export const GLSL_FOG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uNight;
vec3 applyAtmosphere(vec3 col, vec3 wpos){
  vec3 ray = wpos - cameraPosition;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  float camH = max(cameraPosition.y, 0.0);
  float fh = uFogFalloff;
  float ry = rd.y; if (abs(ry) < 1e-3) ry = 1e-3;
  float amount = (uFogDensity / fh) * exp(-camH * fh) * (1.0 - exp(-dist * ry * fh)) / ry;
  amount = clamp(amount, 0.0, 1e3);
  float fogF = 1.0 - exp(-amount);
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt);
  // Extinction tints far colours blue-grey before full fog (aerial perspective)
  vec3 ext = exp(-dist * vec3(0.00011, 0.00007, 0.00004) * (1.0 - uNight*0.5));
  col = col * ext + fogCol * (1.0 - ext) * 0.35;
  return mix(col, fogCol, fogF);
}
`;

// Patch any built-in three.js material: swap the standard fog for height-fog with sun scattering,
// expose world position, and share uniforms.
export function patchMaterial(mat, { vertexHead = '', vertexBody = null, fragHead = '', fragColor = null, beginNormal = null, onShader = null, vertexReplace = null, noFlip = false } = {}) {
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
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_FOG_PARS}\nvarying vec3 vWPos;\n${fragHead}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vWPos);`);
    if (fragColor) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', fragColor);
    if (noFlip) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;');
    if (onShader) onShader(shader, renderer);
    if (prev) prev(shader, renderer);
  };
  // make program cache key distinct per patch
  const key = (noFlip ? 'nf' : '') + (vertexBody || '') + (fragColor || '') + (vertexHead || '') + (fragHead || '') + (beginNormal || '');
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  mat.customProgramCacheKey = () => 'p' + h;
  return mat;
}
