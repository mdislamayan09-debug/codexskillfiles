// Sculpted, skinned characters. Bodies are signed-distance sculptures (smooth-union primitives)
// meshed with surface nets and skinned to a bone rig, so horses and people read as continuous
// organic forms rather than stacked tubes. Accessories (hat brim, tack, guns) ride on bones.
import * as THREE from 'three';
import { sculpt, labelAndSkin, roundCone as RC, ellipsoid as EL, rbox as BX } from './sdf.js';
import { patchMaterial } from './shared.js';
import { mulberry32 } from './noise.js';
import { mergeByMaterial, sweep } from './characters.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function hairTexture(col, strands = 260, wispy = false) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  const base = new THREE.Color(col);
  const r = mulberry32(5);
  for (let i = 0; i < strands; i++) {
    const x = 6 + r() * 116, l = 0.55 + r() * 0.9;
    g.strokeStyle = `rgba(${Math.min(255, base.r * 255 * l + 10)},${Math.min(255, base.g * 255 * l + 8)},${Math.min(255, base.b * 255 * l + 6)},${0.6 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 30, 170, x + (r() - 0.5) * 40, 340, x + (r() - 0.5) * 50, (wispy ? 220 : 300) + r() * (wispy ? 292 : 212));
    g.stroke();
  }
  if (wispy) {
    // thin the ends out into separate locks
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, 300, 0, 512); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = fade; g.fillRect(0, 300, 128, 212);
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Woven saddle blanket with a stepped diamond band
function blanketTexture(r) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  // worn, sun-faded wool in earth reds and browns (a bright blue blanket read as a plastic placeholder)
  const pal = [['#6a2a1c', '#c4b088', '#2a221c'], ['#7a3a22', '#b8a47c', '#3a2a20'], ['#4a3a2a', '#c0ae86', '#6a2a1c']][Math.floor(r() * 3)];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) { g.fillStyle = pal[2]; g.fillRect(0, y + 2, 256, 4); }
  g.fillStyle = pal[1];
  for (let k = 0; k < 4; k++) { const cx = 32 + k * 64; for (let s = 0; s < 6; s++) g.fillRect(cx - 24 + s * 4, 128 - s * 8, 48 - s * 8, 16 * 0 + 8), g.fillRect(cx - 24 + s * 4, 120 + s * 8, 48 - s * 8, 8); }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 2, 1); }
  // wool weave and felted wear where the saddle and legs rub
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,240,210,${r() * 0.06})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1); }
  for (let i = 0; i < 40; i++) { const x = r() * 256, y = r() * 256, rad = 8 + r() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(200,180,150,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Worn saddle leather: mottled tan-to-dark hide, grain creases, scuffs rubbed lighter
function leatherTexture(r) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5e3c22'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const x = r() * 256, y = r() * 256, rad = 10 + r() * 40, l = r();
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, l < 0.5 ? 'rgba(30,16,8,0.22)' : 'rgba(150,104,62,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = r() < 0.6 ? `rgba(28,16,8,${0.15 + r() * 0.25})` : `rgba(170,128,84,${0.1 + r() * 0.2})`;
    g.lineWidth = 0.6 + r() * 1.2;
    const x = r() * 256, y = r() * 256, a = r() * 6.28, L = 4 + r() * 22;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * L * 0.5, y + Math.sin(a + 0.6) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// oiled canvas for the bedroll: a tan weave, darker where it is creased and grimed
function canvasTexture(r) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a7656'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(40,30,18,${0.05 + r() * 0.06})`; g.fillRect(0, y, 256, 1); }
  for (let x = 0; x < 256; x += 2) { g.fillStyle = `rgba(200,180,140,${0.03 + r() * 0.04})`; g.fillRect(x, 0, 1, 256); }
  for (let i = 0; i < 70; i++) {
    const x = r() * 256, y = r() * 256, rad = 8 + r() * 36;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, r() < 0.6 ? 'rgba(46,32,18,0.22)' : 'rgba(190,168,126,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // creases running round the roll
  for (let i = 0; i < 18; i++) { const x = r() * 256; g.strokeStyle = `rgba(36,26,14,${0.2 + r() * 0.2})`; g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 10, 80, x - 10, 170, x + 4, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// sculpt resolution: finer surface nets on capable machines (smoother faces, folds and muscle)
let DETAIL = 1;
export function setCreatureDetail(q) { DETAIL = q >= 2 ? 1.45 : q > 1 ? 1.2 : 1; }
// opaque fur: a base pelt colour with lighter tips and darker underfur in short strokes
function furTexture(col) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), base = new THREE.Color(col), r = mulberry32(19);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const l = 0.55 + r() * 0.9, x = r() * 256, y = r() * 256, a = Math.PI / 2 + (r() - 0.5) * 0.9, L = 5 + r() * 10;
    g.strokeStyle = `rgba(${Math.min(255, base.r * 255 * l)},${Math.min(255, base.g * 255 * l)},${Math.min(255, base.b * 255 * l)},0.55)`;
    g.lineWidth = 1 + r() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
// accessories (hats, tack, bedrolls) catch a light dusting of snow on their upper faces in the cold country
const DUST_FRAG = /* glsl */ `
  #include <color_fragment>
  {
    vec3 wn = inverseTransformDirection(normalize(vNormal), viewMatrix);
    float dust = smoothstep(0.45, 0.85, climateAt(vWPos.xz).r) * smoothstep(0.55, 0.95, wn.y) * (0.55 + 0.45 * vnoise(vWPos.xz * 40.0 + vWPos.y * 13.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.85), dust * 0.45);
  }`;
// One texture per recipe and one material per set of parameters, shared by every character. A horse's tack was
// some forty meshes (each strap, ring and buckle its own material) and a town of riders two and a half thousand
// draw calls a frame, which is what held the game to a few frames a second on the GPU it was built for; with
// shared materials a character's loose parts merge into a handful of meshes.
const TEX = new Map(), MATS = new Map();
const memoTex = (key, make) => { if (!TEX.has(key)) TEX.set(key, make()); return TEX.get(key); };
const std = (o) => {
  const c = o.color === undefined ? null : (o.color.isColor ? o.color : new THREE.Color(o.color));
  const key = [o.map ? o.map.uuid : '', c ? `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}` : '', o.roughness, o.metalness, o.side, o.alphaTest, o.envMapIntensity].join('|');
  if (!MATS.has(key)) MATS.set(key, patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o }), { fragColor: DUST_FRAG }));
  return MATS.get(key);
};
const hairTex_ = (...a) => memoTex('hair' + a.join(','), () => hairTexture(...a));
const furTex_ = (...a) => memoTex('fur' + a.join(','), () => furTexture(...a));
function mesh(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

// Build a bone hierarchy from a spec: [{name, parent, pos:[x,y,z] (rest, model space)}]
function buildBones(spec) {
  const bones = {}, list = [];
  for (const b of spec) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.userData.rest = V(...b.pos);
    const parent = b.parent ? bones[b.parent] : null;
    if (parent) { bone.position.copy(bone.userData.rest).sub(parent.userData.rest); parent.add(bone); }
    else bone.position.copy(bone.userData.rest);
    bones[b.name] = bone; list.push(bone);
  }
  return { bones, list };
}

// Fabric/hair/skin micro variation driven by rest-pose position so it sticks to the deforming body.
const ROUGH_HUMAN = '0.52, 0.9, 0.62, 0.6, 0.9, 0.42, 0.85, 0.7, 0.45, 0.85, 0.55, 0.4, 0.8, 0.95, 0.95'; // coat (index 3) is worn leather
// (a groomed coat has a satin sheen, not a gloss: at 0.6 the horse read as polished plastic)
const ROUGH_QUAD = '0.74, 0.7, 0.35, 0.55, 0.78, 0.76, 0.72, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6';
function skinnedMaterial(extraFrag = '', uniforms = {}, physical = false, kind = 'human') {
  const m = physical
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.4, 0.3, 0.22), envMapIntensity: 1.05 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 1.5 });
  return patchMaterial(m, {
    vertexHead: 'attribute vec3 aRest; attribute float aLabel; varying vec3 vRest; varying float vLab;',
    vertexReplace: [['#include <uv_vertex>', '#include <uv_vertex>\n vRest = aRest; vLab = aLabel;']],
    fragHead: 'varying vec3 vRest; varying float vLab;\n' + Object.keys(uniforms).map((k) => `uniform ${uniforms[k].type} ${k};`).join('\n'),
    fragColor: /* glsl */ `
      #include <color_fragment>
      {
        float n1 = vnoise(vRest.xy * 90.0 + vRest.z * 37.0);
        float n2 = vnoise(vec2(vRest.x * 400.0 + vRest.z*300.0, vRest.y * 60.0));
        diffuseColor.rgb *= 0.9 + 0.12 * n1 + 0.06 * n2;
        ${kind === 'human' ? `
        {
          int lb = int(vLab + 0.5);
          if (lb == 3 || lb == 2 || lb == 6) {
            // worn leather and felt: broad mottling, rubbed-light high points, seams and stitching lines
            // (a fine, low-contrast grain: broad light and dark blotches on a close-fitting coat read as muscle)
            float m = fbm2(vRest.xy * 26.0 + vRest.z * 19.0);
            diffuseColor.rgb *= 0.9 + 0.2 * m;
            // broad rubbed-light wear over the shoulders and hanging folds down the back and skirt
            float wear = smoothstep(1.3, 1.5, vRest.y) * (0.6 + 0.4 * fbm2(vRest.xz * 4.0));
            float folds = (sin(vRest.x * 55.0 + fbm2(vRest.xy * 3.0) * 4.0) * 0.5 + 0.5) * smoothstep(1.35, 1.0, vRest.y);
            diffuseColor.rgb *= (1.0 + 0.14 * wear * float(lb == 3)) * (1.0 - 0.1 * folds * float(lb == 3));
            float seam = smoothstep(0.006, 0.0, abs(vRest.x)) * step(vRest.z, -0.04) * step(vRest.y, 1.45);  // centre back
            seam = max(seam, smoothstep(0.007, 0.0, abs(vRest.y - 1.43)) * step(vRest.z, -0.02));           // yoke
            seam = max(seam, smoothstep(0.006, 0.0, abs(abs(vRest.x) - 0.185)) * step(vRest.y, 1.3));       // side seams
            diffuseColor.rgb *= 1.0 - 0.45 * seam * float(lb == 3);
            // creases bunch where the coat folds over the saddle
            float crease = (sin(vRest.y * 140.0 + vnoise(vRest.xz * 30.0) * 5.0) * 0.5 + 0.5) * smoothstep(1.12, 0.95, vRest.y) * smoothstep(0.7, 0.85, vRest.y);
            diffuseColor.rgb *= 1.0 - 0.12 * crease * float(lb == 3);
          }
        }` : ''}
        ${extraFrag}
        // a dusting of snow settles on shoulders, hats and backs out in the cold country
        {
          vec3 wn = inverseTransformDirection(normalize(vNormal), viewMatrix);
          // (caught in clumps on the hat, shoulders, bedroll and rump, as in the reference's storm; a faint even
          // dusting read as no snow at all)
          // (fine flecks melting into the coat, thicker along the top line: broad white blotches read as a pinto's patches)
          // (a soft veil lying on what faces up, thicker in places: as separate flecks it read as noise sprayed on the coat)
          float dust = smoothstep(0.45, 0.85, climateAt(vWPos.xz).r) * smoothstep(0.62, 0.98, wn.y) * (0.3 + 0.7 * smoothstep(0.3, 0.7, 0.6 * vnoise(vRest.xz * 19.0 + vRest.y * 7.0) + 0.4 * vnoise(vRest.xz * 55.0 - vRest.y * 20.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), dust * ${kind === 'human' ? '0.55' : '0.42'});
        }
        // the light comes mostly from above: backs, shoulders and rumps catch it, bellies, flanks turned down and the
        // inside of the legs lie in the body's own shade (lit evenly all round, a body read as a flat cut-out)
        {
          vec3 wnf = inverseTransformDirection(normalize(vNormal), viewMatrix);
          diffuseColor.rgb *= mix(${kind === 'human' ? '0.78' : '0.55'}, ${kind === 'human' ? '1.08' : '1.16'}, smoothstep(-0.7, 0.75, wnf.y));
        }
        // wet / darkened below the waterline
        diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(-0.05, 0.12, vWPos.y));
      }`,
    onShader: (s) => {
      Object.entries(uniforms).forEach(([k, u]) => (s.uniforms[k] = u));
      const quad = kind !== 'human';
      s.fragmentShader = s.fragmentShader
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          {
            const float RT[15] = float[15](${quad ? ROUGH_QUAD : ROUGH_HUMAN});
            roughnessFactor = RT[clamp(int(vLab + 0.5), 0, 14)];
            ${quad ? '' : 'if (int(vLab + 0.5) == 3) roughnessFactor = mix(0.8, 0.97, smoothstep(0.3, 0.7, fbm2(vRest.xy * 11.0 + vRest.z * 8.0)));'}
          }`)
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          {
            // procedural surface relief in rest space: cloth folds and weave on people,
            // muscle and hair flow on animals (derivative bump, no textures needed)
            int lab = int(vLab + 0.5);
            float hgt = 0.0;
            ${quad
              // broad muscle swells, the coat's hair lying in streaks along the body (catching the light in bands),
              // and the groove down the croup
              ? 'hgt = vnoise(vRest.zy * 3.2 + vRest.x * 1.5) * 0.02 + vnoise(vRest.zy * 7.0 + vRest.x * 3.0) * 0.012 + vnoise(vec2(vRest.z * 12.0, vRest.y * 150.0 + vRest.x * 130.0)) * 0.0007 + vnoise(vec2(vRest.z * 40.0, vRest.y * 420.0 + vRest.x * 380.0)) * 0.0004 - smoothstep(0.05, 0.0, abs(vRest.x)) * smoothstep(-0.6, -0.95, vRest.z) * smoothstep(1.0, 1.3, vRest.y) * 0.02 - 0.014 * smoothstep(0.04, 0.0, abs(abs(vRest.x) - 0.12 - 0.05 * (1.3 - vRest.y))) * smoothstep(-0.68, -0.8, vRest.z) * smoothstep(0.88, 1.02, vRest.y) * smoothstep(1.46, 1.34, vRest.y) - 0.012 * smoothstep(0.07, 0.0, abs(vRest.z + 0.36 - 0.25 * (vRest.y - 1.15))) * smoothstep(0.95, 1.1, vRest.y) * smoothstep(1.45, 1.3, vRest.y) * smoothstep(0.15, 0.25, abs(vRest.x));'
              : `bool cloth = lab == 1 || lab == 2 || lab == 3 || lab == 4 || lab == 9;
                 if (cloth) hgt = (sin(vRest.y * 115.0 + vnoise(vRest.xz * 24.0) * 7.0) * 0.5 + 0.5) * (lab == 3 ? 0.0007 : 0.003) * vnoise(vRest.xy * 9.0 + vRest.z * 5.0) + vnoise(vRest.xy * 700.0 + vRest.z * 500.0) * 0.00035;
                 else if (lab == 0 || lab == 11 || lab == 12) hgt = vnoise(vRest.xy * 320.0 + vRest.z * 210.0) * 0.0005;
                 else if (lab == 13 || lab == 14) hgt = vnoise(vec2(vRest.x * 260.0 + vRest.z * 190.0, vRest.y * 70.0)) * 0.0024 + vnoise(vRest.xy * 900.0 + vRest.z * 700.0) * 0.0008; // fur
                 else if (lab == 5 || lab == 8 || lab == 10) hgt = vnoise(vRest.xy * 140.0 + vRest.z * 90.0) * 0.0008;`}
            vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
            float hx = dFdx(hgt), hy = dFdy(hgt);
            vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
            float det = dot(dpdx, r1);
            vec3 grad = sign(det) * (hx * r1 + hy * r2);
            normal = normalize(abs(det) * normal - grad);
          }`);
      // sun rim + sky fill: backlit riders keep their silhouette like on a film set
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          // (a coat of hair scatters light at grazing angles: a softer, wider rim on animals)
          float fres = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), ${quad ? '3.0' : '3.5'});
          vec3 wsun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = smoothstep(-0.2, 0.8, dot(-Vv, wsun));
          // (against the light a figure is drawn by its rim: felt, hair and worn cloth all scatter at the edge, however
          // dark they are face on)
          totalEmissiveRadiance += (diffuseColor.rgb + 0.035) * uSunColor * fres * back * ${quad ? '0.3' : '0.6'} + diffuseColor.rgb * uFogColor * fres * ${quad ? '0.3' : '0.15'};
        }`);
    },
  });
}

// ===================================================================================== HUMANS
export const OUTFITS = {
  // the cold-country rig: shearling coat with fur trim, trapper hat and a wool scarf
  winter: { coat: 0x5a3e28, shirt: 0x6a5a4a, vest: 0x4a3828, pants: 0x3a3028, hat: null, fur: 0xd2c2a2, furHat: true, furHatColor: 0x5e4a38, boots: 0x2a1e16, gloves: 0x4a3626, bandana: 0x3a404a, winter: true },
  arthur: { coat: 0x503522, shirt: 0x8696aa, vest: 0x2e2c2a, pants: 0x3e342a, hat: 0x5c4b3a, boots: 0x2a1e16, gloves: 0x5a3e28, bandana: null }, // brown leather coat, as in the references
  outlaw: { coat: 0x4a3e32, shirt: 0x8a7a64, vest: 0x2a2420, pants: 0x403a32, hat: 0x3a3028, boots: 0x261a12, gloves: null, bandana: 0x8a2018 },
  rancher: { coat: null, shirt: 0xb8a888, vest: 0x5a4632, pants: 0x4a5468, hat: 0x7a6a50, boots: 0x3a2a1e, gloves: 0x6a4a30, bandana: 0x6a5a40 },
  gent: { coat: 0x2a2a2e, shirt: 0xd8d4c8, vest: 0x4a3a46, pants: 0x2e2e32, hat: 0x1a1a1c, boots: 0x161210, gloves: null, bandana: null },
  lady: { coat: null, shirt: 0x7a4a5a, vest: 0x5a3a48, pants: 0x5a3a48, hat: null, boots: 0x1e1612, gloves: null, bandana: null, dress: true },
  worker: { coat: null, shirt: 0x9a8a70, vest: null, pants: 0x50463a, hat: 0x8a7a5a, boots: 0x30261c, gloves: null, bandana: 0x3e4a5a },
};
const L = { skin: 0, shirt: 1, vest: 2, coat: 3, pants: 4, boots: 5, hat: 6, hair: 7, belt: 8, bandana: 9, gloves: 10, lips: 11, fur: 13, furHat: 14 };
const SKIN = [0xc4977a, 0xb38262, 0x9a6a4c, 0x7a5038, 0xd4aa8c];
const HAIR = [0x2a2018, 0x3e2e1e, 0x1a1612, 0x5a4a3a];

const HUMAN_BONES = [
  { name: 'hips', parent: null, pos: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 0.98, 0] },
  { name: 'neck', parent: 'spine', pos: [0, 1.58, -0.01] },
  { name: 'head', parent: 'neck', pos: [0, 1.68, 0] },
  { name: 'shL', parent: 'spine', pos: [-0.2, 1.48, -0.015] }, { name: 'elL', parent: 'shL', pos: [-0.2, 1.19, -0.015] }, { name: 'wrL', parent: 'elL', pos: [-0.2, 0.94, -0.01] },
  { name: 'shR', parent: 'spine', pos: [0.2, 1.48, -0.015] }, { name: 'elR', parent: 'shR', pos: [0.2, 1.19, -0.015] }, { name: 'wrR', parent: 'elR', pos: [0.2, 0.94, -0.01] },
  { name: 'hpL', parent: 'hips', pos: [-0.095, 0.95, 0] }, { name: 'knL', parent: 'hpL', pos: [-0.095, 0.51, 0.005] }, { name: 'anL', parent: 'knL', pos: [-0.095, 0.09, -0.01] },
  { name: 'hpR', parent: 'hips', pos: [0.095, 0.95, 0] }, { name: 'knR', parent: 'hpR', pos: [0.095, 0.51, 0.005] }, { name: 'anR', parent: 'knR', pos: [0.095, 0.09, -0.01] },
];
const HB = Object.fromEntries(HUMAN_BONES.map((b, i) => [b.name, i]));

function humanPrims(o) {
  const P = [];
  const add = (p, label, bone, blend = 0.025) => { p.label = label; p.bone = HB[bone]; p.blend = blend; P.push(p); };
  const torsoL = o.vest ? L.vest : L.shirt;
  // pelvis / torso
  add(EL([0, 0.97, 0], [0.165, 0.12, 0.115]), L.pants, 'hips', 0.04);
  add(RC([0, 1.03, 0.0], [0, 1.24, 0.008], 0.13, 0.145), torsoL, 'spine', 0.05);
  add(EL([0, 1.36, 0.012], [0.18, 0.15, 0.115]), torsoL, 'spine', 0.05);
  add(EL([0, 1.36, 0.05], [0.13, 0.1, 0.07]), torsoL, 'spine', 0.04); // pecs
  add(RC([-0.16, 1.465, -0.02], [0.16, 1.465, -0.02], 0.07, 0.07), torsoL, 'spine', 0.05);
  add(EL([0, 1.0, 0.0], [0.168, 0.032, 0.124]), L.belt, 'hips', 0.006);
  add(BX([0, 1.0, 0.123], [0.03, 0.022, 0.006], 0.004), L.belt, 'hips', 0.004); // buckle
  // coat: shoulders + flared skirt
  if (o.winter) {
    // heavy shearling: bulkier body, longer skirt, wide fur collar
    add(EL([0, 1.31, -0.005], [0.228, 0.215, 0.158]), L.coat, 'spine', 0.035);
    add(RC([0, 1.12, -0.012], [0, 0.68, -0.03], 0.2, 0.235), L.coat, 'hips', 0.035);
    add(EL([0, 1.535, -0.025], [0.16, 0.062, 0.125]), L.fur, 'spine', 0.03);
    add(EL([0, 1.49, 0.07], [0.09, 0.07, 0.04]), L.fur, 'spine', 0.03); // lapels
  }
  if (o.coat) {
    add(EL([0, 1.33, -0.005], [0.205, 0.19, 0.135]), L.coat, 'spine', 0.03);
    add(RC([-0.17, 1.47, -0.02], [0.17, 1.47, -0.02], 0.085, 0.085), L.coat, 'spine', 0.03);
    add(RC([0, 1.15, -0.012], [0, 0.74, -0.03], 0.185, 0.215), L.coat, 'hips', 0.035);
    add(RC([0, 1.52, -0.05], [0, 1.6, -0.06], 0.085, 0.07), L.coat, 'spine', 0.03); // collar
  }
  if (o.dress) add(RC([0, 1.02, 0], [0, 0.1, 0], 0.17, 0.38), L.pants, 'hips', 0.06);
  // neck & head
  add(RC([0, 1.5, -0.01], [0, 1.68, 0.0], 0.058, 0.052), L.skin, 'neck', 0.03);
  if (o.bandana) add(EL([0, 1.56, 0.0], o.winter ? [0.088, 0.05, 0.083] : [0.075, 0.035, 0.07]), L.bandana, 'neck', 0.01);
  add(EL([0, 1.785, -0.008], [0.083, 0.102, 0.098]), L.skin, 'head', 0.03);
  add(EL([0, 1.735, 0.032], [0.072, 0.085, 0.075]), L.skin, 'head', 0.03);
  add(EL([0, 1.685, 0.042], [0.062, 0.042, 0.058]), L.skin, 'head', 0.025); // jaw
  add(EL([0, 1.665, 0.074], [0.03, 0.024, 0.022]), L.skin, 'head', 0.015); // chin
  add(RC([0, 1.768, 0.094], [0, 1.728, 0.112], 0.011, 0.016), L.skin, 'head', 0.012); // nose
  add(RC([-0.045, 1.783, 0.083], [0.045, 1.783, 0.083], 0.014, 0.014), L.skin, 'head', 0.015); // brow ridge
  for (const s of [-1, 1]) add(RC([s * 0.018, 1.787, 0.094], [s * 0.05, 1.789, 0.087], 0.006, 0.005), L.hair, 'head', 0.004); // eyebrows
  for (const s of [-1, 1]) {
    add(EL([s * 0.05, 1.745, 0.07], [0.022, 0.016, 0.018]), L.skin, 'head', 0.015); // cheekbones
    add(EL([s * 0.086, 1.752, -0.005], [0.014, 0.028, 0.02]), L.skin, 'head', 0.008); // ears
    const eye = EL([s * 0.033, 1.764, 0.09], [0.016, 0.011, 0.012]); eye.sub = true; eye.label = L.skin; P.push(eye);
  }
  add(EL([0, 1.705, 0.098], [0.022, 0.007, 0.008]), L.lips, 'head', 0.006);
  add(EL([0, 1.81, -0.022], [0.088, 0.088, 0.096]), L.hair, 'head', 0.012); // hair cap
  add(EL([0, 1.755, -0.052], [0.08, 0.075, 0.062]), L.hair, 'head', 0.014); // hair down the back of the head to the nape
  if (o.furHat) {
    // trapper hat: a deep fur crown with ear flaps
    add(RC([0, 1.8, -0.014], [0, 1.885, -0.014], 0.112, 0.106), L.furHat, 'head', 0.03);
    add(EL([0, 1.9, -0.014], [0.102, 0.045, 0.104]), L.furHat, 'head', 0.035);
    for (const s of [-1, 1]) add(EL([s * 0.094, 1.76, -0.02], [0.032, 0.058, 0.058]), L.furHat, 'head', 0.02);
  }
  if (o.hat) {
    add(RC([0, 1.835, -0.008], [0, 1.925, -0.008], 0.1, 0.092), L.hat, 'head', 0.01);
    const crease = EL([0, 1.985, 0.0], [0.03, 0.04, 0.085]); crease.sub = true; crease.label = L.hat; P.push(crease);
    for (const s of [-1, 1]) { const pinch = EL([s * 0.05, 1.96, 0.075], [0.02, 0.05, 0.02]); pinch.sub = true; pinch.label = L.hat; P.push(pinch); }
  }
  // arms
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const sleeve = o.coat ? L.coat : L.shirt;
    add(EL([s * 0.19, 1.455, -0.018], [0.075, 0.08, 0.075]), sleeve, 'sh' + S, 0.04); // deltoid
    add(RC([s * 0.2, 1.47, -0.015], [s * 0.2, 1.2, -0.015], o.coat ? 0.066 : 0.058, o.coat ? 0.054 : 0.046), sleeve, 'sh' + S, 0.03);
    add(RC([s * 0.2, 1.2, -0.015], [s * 0.2, 0.975, -0.01], o.coat ? 0.053 : 0.045, o.coat ? 0.044 : 0.034), sleeve, 'el' + S, 0.03);
    const hand = o.gloves ? L.gloves : L.skin;
    add(BX([s * 0.2, 0.9, 0.0], [0.013, 0.037, 0.033], 0.012), hand, 'wr' + S, 0.015);
    add(RC([s * 0.2, 0.87, 0.012], [s * 0.198, 0.818, 0.022], 0.016, 0.012), hand, 'wr' + S, 0.012);
    add(RC([s * 0.187, 0.925, 0.03], [s * 0.192, 0.875, 0.05], 0.012, 0.01), hand, 'wr' + S, 0.01);
    add(RC([s * 0.2, 0.965, -0.01], [s * 0.2, 0.935, -0.006], 0.036, 0.032), hand, 'wr' + S, 0.012); // wrist/cuff
    if (o.winter) add(RC([s * 0.2, 1.0, -0.012], [s * 0.2, 0.965, -0.01], 0.058, 0.056), L.fur, 'el' + S, 0.012);
  }
  // legs
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    add(RC([s * 0.092, 0.95, 0.0], [s * 0.095, 0.52, 0.005], 0.085, 0.06), L.pants, 'hp' + S, 0.04);
    add(EL([s * 0.095, 0.51, 0.02], [0.056, 0.06, 0.055]), L.pants, 'kn' + S, 0.03);
    add(RC([s * 0.095, 0.49, 0.0], [s * 0.095, 0.12, -0.01], 0.056, 0.044), L.pants, 'kn' + S, 0.03);
    add(RC([s * 0.095, 0.37, -0.004], [s * 0.095, 0.09, -0.012], 0.058, 0.052), L.boots, 'kn' + S, 0.012);
    add(RC([s * 0.095, 0.06, -0.035], [s * 0.096, 0.036, 0.13], 0.05, 0.034), L.boots, 'an' + S, 0.03);
    add(BX([s * 0.095, 0.02, -0.05], [0.035, 0.02, 0.03], 0.01), L.boots, 'an' + S, 0.02); // heel
  }
  return P;
}

// ---- the MakeHuman body (CC0): a real human form, rigged onto the game skeleton (scripts/build_human.py) ----
let MH = null;
// the model ships as a lossless PNG (3 bytes per pixel, a uint32 length first) so any static host serves it
async function fetchPackedBytes(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const rgb = new Uint8Array((px.length / 4) * 3);
  for (let i = 0, j = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; }
  const n = rgb[0] | (rgb[1] << 8) | (rgb[2] << 16) | (rgb[3] << 24);
  return rgb.slice(4, 4 + n).buffer;
}
export async function loadHumanModel(url = 'models/human.png') {
  try {
    const buf = url.endsWith('.png') ? await fetchPackedBytes(url) : await (await fetch(url)).arrayBuffer();
    const hl = new DataView(buf).getUint32(0, true);
    const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    const base = 4 + hl, A = {};
    for (const a of hdr.arrays) {
      const T = { position: Float32Array, normal: Float32Array, skinIndex: Uint8Array, skinWeight: Uint8Array, region: Uint8Array, index: Uint32Array }[a.name];
      A[a.name] = new T(buf.slice(base + a.offset, base + a.offset + a.bytes));
    }
    MH = { ...hdr, ...A };
    // the skeleton follows the real body
    for (const b of HUMAN_BONES) if (MH.rest[b.name]) b.pos = MH.rest[b.name].slice();
    // anchors for the accessories: crown of the head, the face, the base of the neck
    const P = MH.position, R = MH.region;
    let top = 0, sx = 0, sz = 0, n = 0;
    for (let i = 0; i < MH.count; i++) if (R[i] === MH.regions.scalp) { top = Math.max(top, P[i * 3 + 1]); sx += P[i * 3]; sz += P[i * 3 + 2]; n++; }
    MH.anchor = { headTop: top, headZ: sz / n, eyes: MH.eyes, neckY: MH.rest.neck[1], neckZ: MH.rest.neck[2] };
    return true;
  } catch (e) {
    console.warn('human model unavailable; using sculpted figures', e);
    return false;
  }
}
// accessory anchors for whichever body is in use
function headAnchors() {
  if (!MH) return { hatY: 1.838, hatZ: -0.008, eyes: [[-0.033, 1.763, 0.082], [0.033, 1.763, 0.082]], eyeFwd: 0.0105, collarY: 1.5, collarZ: -0.02, headR: 0.112 };
  const a = MH.anchor;
  return { hatY: a.headTop - 0.05, hatZ: a.headZ + 0.005, eyes: a.eyes.map((e) => [e[0] < 0 ? e[0] : e[0], e[1], e[2] - 0.004]).sort((p, q) => p[0] - q[0]), eyeFwd: 0.0105,
    collarY: a.neckY - 0.08, collarZ: a.neckZ - 0.03, headR: 0.105 };
}
// clothing on the real body: each region of skin becomes a garment for the outfit, pushed out along the normal
function mhTemplate(outfit, o) {
  const G = MH.regions, n = MH.count, P = MH.position, N = MH.normal, R = MH.region;
  const lab = new Float32Array(n), pos = new Float32Array(n * 3);
  const winter = !!o.winter;
  const beltY = MH.rest.hips[1] + 0.03;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], r = R[i];
    let L0 = L.skin, push = 0;
    if (r === G.scalp) { L0 = L.hair; push = 0.005; }
    else if (r === G.beard || r === G.face) {
      // stubble on the jaw, chin and upper lip only; lips; the rest of the face is skin
      const ey = MH.eyes[0][1], ez = MH.eyes[0][2];
      const mouthY = ey - 0.085, mouthZ = ez + 0.012;
      const lip = Math.abs(x) < 0.026 && Math.abs(y - mouthY) < 0.009 && z > mouthZ - 0.012;
      const jaw = y < ey - 0.065 && z > ez - 0.12;
      if (lip && outfit !== 'lady') L0 = L.lips;
      else if (jaw && outfit !== 'lady' && !lip) { L0 = 12; push = 0.0012; }
    }
    else if (r === G.neck) {
      if (o.bandana && y < MH.rest.neck[1] + 0.03) { L0 = L.bandana; push = winter ? 0.022 : 0.01; }
      // the collar stands out lower down to meet the coat on the shoulders (a step between the two shells showed the
      // dark inside of the coat as a black triangle at the nape)
      else if (o.coat && y < MH.rest.neck[1] - 0.01) { L0 = L.coat; push = 0.014 + 0.022 * Math.min(1, Math.max(0, (MH.rest.neck[1] - 0.01 - y) / 0.06)); }
    } else if (r === G.torso || r === G.uarm || r === G.farm) {
      // open coat front: a V from the collar down to the belt shows the vest, and the shirt at the throat
      const fz = z - MH.rest.spine[2];
      const vHalf = 0.035 + Math.max(0, 1.52 - y) * 0.16;
      const front = r === G.torso && fz > 0.04 && Math.abs(x) < vHalf && y > beltY - 0.01;
      const throat = front && y > 1.38 && Math.abs(x) < 0.03 + (1.52 - y) * 0.25;
      if (o.coat && !(front && !winter)) { L0 = L.coat; push = (winter ? 0.04 : 0.028) * (r === G.torso ? 1.15 : 1); }
      else if (o.vest && r === G.torso && !throat) { L0 = L.vest; push = 0.012; }
      else { L0 = L.shirt; push = 0.007; }
      if (r === G.farm && y < MH.rest.wrL[1] + 0.05 && o.coat) push *= 1.3;     // cuffs
    } else if (r === G.belt) { L0 = L.belt; push = 0.016; if (o.coat && (winter || z - MH.rest.spine[2] < 0.04)) { L0 = L.coat; push = winter ? 0.04 : 0.032; } }   // (the coat hangs over the belt at the back and sides)
    else if (r === G.pelvis) { L0 = o.dress ? L.pants : L.pants; push = 0.008; if (o.coat && z < 0.02) { L0 = L.coat; push = winter ? 0.032 : 0.022; } }
    else if (r === G.thigh) {
      L0 = L.pants; push = 0.011;
      if (o.coat && y > 0.62 && (z < 0.04 || Math.abs(x) > 0.15)) { L0 = L.coat; push = winter ? 0.03 : 0.02; }   // coat skirt over the thighs
    } else if (r === G.shin) { if (y < 0.4) { L0 = L.boots; push = 0.012; } else { L0 = L.pants; push = 0.007; } }
    else if (r === G.foot) { L0 = L.boots; push = 0.009; }
    else if (r === G.hand) { if (o.gloves) { L0 = L.gloves; push = 0.002; } }
    lab[i] = L0;
    // real cloth relief on the coat: hanging folds down the back and skirt, bunched creases at the elbows and
    // across the sleeves, so the silhouette and the light both break up (shading alone reads as a flat shell)
    if (L0 === L.coat) {
      const fn = Math.sin(x * 9.1 + z * 6.3) * 0.5 + Math.sin(y * 17.0 + x * 4.0) * 0.5;
      if (r === G.torso || r === G.pelvis || r === G.thigh) {
        const hang = (Math.sin(x * 52 + 2.2 * fn) * 0.5 + 0.5) ** 2 * (1 - Math.min(1, Math.max(0, (y - 0.95) / 0.5)));
        push += 0.011 * hang * (winter ? 1.3 : 1);
        push += 0.004 * Math.sin(y * 38 + x * 12 + fn * 2.5) * (z < 0 ? 1 : 0.5);
      } else if (r === G.uarm || r === G.farm) {
        push += 0.006 * (Math.sin(y * 64 + z * 30 + fn * 3.0) * 0.5 + 0.5) ** 2;
      }
    }
    pos[i * 3] = x + N[i * 3] * push; pos[i * 3 + 1] = y + N[i * 3 + 1] * push; pos[i * 3 + 2] = z + N[i * 3 + 2] * push;
  }
  if (o.coat) tailorCoat(pos, lab, R, G, MH.index, n, winter);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRest', new THREE.BufferAttribute(pos.slice(), 3));
  geo.setAttribute('aLabel', new THREE.BufferAttribute(lab, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(MH.skinIndex), 4));
  const sw = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) sw[i] = MH.skinWeight[i] / 255;
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(MH.index, 1));
  geo.computeVertexNormals();
  return { geo, prims: [] };
}

// The coat as a garment. Pushed out along the skin's normals it is a second skin: shoulder blades, the groove of the
// spine and the buttocks all show through it, and the rider reads as a painted nude. A coat hangs. Here the cloth
// is first relaxed (so no muscle shows), then draped: working down from the shoulders, at every bearing round the
// body it falls straight from whatever stood furthest out above it, and it spans hollows instead of following them.
function tailorCoat(pos, lab, R, G, index, n, winter) {
  const coat = new Uint8Array(n);
  for (let i = 0; i < n; i++) coat[i] = lab[i] === L.coat ? 1 : 0;
  const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < index.length; t += 3) { const a = index[t], b = index[t + 1], c = index[t + 2]; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
  const tmp = new Float32Array(pos.length);
  for (let it = 0; it < 7; it++) {
    tmp.set(pos);
    for (let i = 0; i < n; i++) {
      if (!coat[i] || !nb[i].length) continue;
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (const j of nb[i]) { if (!coat[j]) continue; sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; c++; }
      if (!c) continue;
      const k = 0.6;
      tmp[i * 3] += (sx / c - pos[i * 3]) * k; tmp[i * 3 + 1] += (sy / c - pos[i * 3 + 1]) * k * 0.3; tmp[i * 3 + 2] += (sz / c - pos[i * 3 + 2]) * k;
    }
    pos.set(tmp);
  }
  // the body of the coat: torso, the belt it covers, and the seat
  const shell = [];
  let y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) if (coat[i] && (R[i] === G.torso || R[i] === G.belt || R[i] === G.pelvis)) { shell.push(i); y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
  if (shell.length < 50) return;
  const DY = 0.016, NY = Math.ceil((y1 - y0) / DY) + 1, NA = 56;
  const cz = new Float32Array(NY), cn = new Float32Array(NY);
  for (const i of shell) { const yi = Math.round((pos[i * 3 + 1] - y0) / DY); cz[yi] += pos[i * 3 + 2]; cn[yi]++; }
  for (let yi = 0; yi < NY; yi++) cz[yi] = cn[yi] ? cz[yi] / cn[yi] : NaN;
  for (let yi = 0; yi < NY; yi++) if (Number.isNaN(cz[yi])) { let k = 1; while (k < NY && Number.isNaN(cz[Math.max(0, yi - k)]) && Number.isNaN(cz[Math.min(NY - 1, yi + k)])) k++; cz[yi] = !Number.isNaN(cz[Math.max(0, yi - k)]) ? cz[Math.max(0, yi - k)] : cz[Math.min(NY - 1, yi + k)]; }
  for (let p2 = 0; p2 < 3; p2++) for (let yi = 1; yi < NY - 1; yi++) cz[yi] = (cz[yi - 1] + 2 * cz[yi] + cz[yi + 1]) / 4;
  const polar = (i) => { const y = pos[i * 3 + 1], yf = (y - y0) / DY, yi = Math.min(NY - 1, Math.max(0, Math.round(yf))), dx = pos[i * 3], dz = pos[i * 3 + 2] - cz[yi]; return [yi, Math.atan2(dx, dz), Math.hypot(dx, dz)]; };
  const br = Array.from({ length: NY }, () => new Float32Array(NA));
  for (const i of shell) { const [yi, a, r] = polar(i), ai = ((Math.round(a / (2 * Math.PI) * NA) % NA) + NA) % NA; if (r > br[yi][ai]) br[yi][ai] = r; }
  // holes in the table (bearings a row has no vertex on) take their neighbours' reach
  for (let yi = 0; yi < NY; yi++) for (let p2 = 0; p2 < NA; p2++) { let any = false; for (let ai = 0; ai < NA; ai++) if (br[yi][ai] === 0) { const l = br[yi][(ai + NA - 1) % NA], r2 = br[yi][(ai + 1) % NA]; if (l || r2) { br[yi][ai] = Math.max(l, r2) * 0.995; any = true; } } if (!any) break; }
  const dr = br.map((row) => Float32Array.from(row));
  const top = Math.max(0, NY - 1 - Math.round(0.1 / DY));
  for (let yi = top - 1; yi >= 0; yi--) for (let ai = 0; ai < NA; ai++) {
    // the back and sides hang (bearing 0 is the chest; the open front of a riding coat follows the body)
    const back = Math.abs(ai - NA / 2) < NA * 0.36 ? 1 : 0;
    dr[yi][ai] = Math.max(br[yi][ai], back ? dr[yi + 1][ai] - 0.0004 : 0);   // (near plumb: a slight taper to the waist, not a barrel)
  }
  for (let p2 = 0; p2 < 3; p2++) for (let yi = 0; yi < NY; yi++) { const row = dr[yi], o2 = Float32Array.from(row); for (let ai = 0; ai < NA; ai++) row[ai] = Math.max(br[yi][ai], (o2[(ai + NA - 1) % NA] + 2 * o2[ai] + o2[(ai + 1) % NA]) / 4); }
  for (const i of shell) {
    const [yi, a, r] = polar(i), af = ((a / (2 * Math.PI) * NA) % NA + NA) % NA, a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, t = af - Math.floor(af);
    const y = pos[i * 3 + 1], w = 1 - Math.min(1, Math.max(0, (y - (y1 - 0.2)) / 0.1));   // the yoke keeps the shoulders' own shape
    // long folds falling from the shoulder blades, a little fuller toward the hem
    const fold = 0.0045 * Math.sin(a * 9 + 1.3 * Math.sin(y * 14)) * (0.4 + (y1 - y) * 1.6) * (winter ? 1.3 : 1);
    const rt = Math.max(r, dr[yi][a0] * (1 - t) + dr[yi][a1] * t) + (fold + 0.004) * w;   // (with a little ease all round)
    const k = 1 + (rt / Math.max(r, 1e-4) - 1) * w;
    pos[i * 3] *= k; pos[i * 3 + 2] = cz[yi] + (pos[i * 3 + 2] - cz[yi]) * k;
  }
}

const humanCache = new Map();
function humanTemplate(outfit) {
  if (humanCache.has(outfit)) return humanCache.get(outfit);
  if (MH) { humanCache.set(outfit, mhTemplate(outfit, OUTFITS[outfit])); return humanCache.get(outfit); }
  const o = OUTFITS[outfit];
  const prims = humanPrims(o);
  const geo = sculpt(prims, { cell: 0.0115 / DETAIL, pad: 0.03 });
  labelAndSkin(geo, prims, { boneCount: HUMAN_BONES.length, sharpness: 0.018 });
  // open coat front reveals the vest/shirt; stubble on the jaw
  const p = geo.attributes.position, lab = geo.attributes.aLabel;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (o.coat && !o.winter && lab.getX(i) === L.coat && z > 0.06 && Math.abs(x) < 0.06 + (1.45 - y) * 0.06 && y > 1.02 && y < 1.5) lab.setX(i, o.vest ? L.vest : L.shirt);
    if (lab.getX(i) === L.skin && y < 1.725 && y > 1.64 && z > -0.01 && outfit !== 'lady') lab.setX(i, 12); // beard / stubble slot
    if (lab.getX(i) === L.skin && Math.abs(x) > 0.07 && y > 1.72 && y < 1.8 && z < 0.02 && z > -0.06 && outfit !== 'lady') lab.setX(i, L.hair); // sideburns
  }
  humanCache.set(outfit, { geo, prims });
  return humanCache.get(outfit);
}

export class Human {
  constructor(outfit = 'arthur', seed = 1) {
    const o = OUTFITS[outfit] || OUTFITS.arthur;
    const r = mulberry32(seed);
    this.outfit = outfit;
    const tpl = humanTemplate(outfit in OUTFITS ? outfit : 'arthur');
    const skin = hex(SKIN[Math.floor(r() * SKIN.length)]);
    const hair = hex(HAIR[Math.floor(r() * HAIR.length)]);
    const pal = [];
    pal[L.skin] = skin; pal[L.shirt] = hex(o.shirt); pal[L.vest] = hex(o.vest || o.shirt); pal[L.coat] = hex(o.coat || o.shirt);
    pal[L.pants] = hex(o.pants); pal[L.boots] = hex(o.boots); pal[L.hat] = hex(o.hat || 0x333333); pal[L.hair] = hair;
    pal[L.belt] = hex(0x3e2a1a); pal[L.bandana] = hex(o.bandana || 0x444444); pal[L.gloves] = hex(o.gloves || 0x5a3e28);
    pal[L.lips] = skin.map((v, i) => v * [0.8, 0.6, 0.6][i]);
    pal[L.fur] = hex(o.fur || 0xb8a284);
    pal[L.furHat] = hex(o.furHatColor || 0x6e5640);
    pal[12] = outfit === 'arthur' || outfit === 'winter' || r() < 0.6 ? skin.map((v, i) => v * 0.3 + hair[i] * 0.75) : skin.map((v) => v * 0.85); // beard / stubble
    // per-instance colour attribute over a shared sculpted geometry
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'aRest', 'aLabel']) g.setAttribute(k, tpl.geo.attributes[k]);
    g.setIndex(tpl.geo.index);
    const lab = tpl.geo.attributes.aLabel;
    const col = new Float32Array(lab.count * 3);
    for (let i = 0; i < lab.count; i++) { const c = pal[lab.getX(i)] || [1, 0, 1]; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();

    const root = (this.root = new THREE.Group());
    const { bones, list } = buildBones(HUMAN_BONES);
    root.add(bones.hips);
    const body = new THREE.SkinnedMesh(g, skinnedMaterial());
    body.castShadow = true; body.receiveShadow = true;
    body.frustumCulled = false;
    root.add(body);
    root.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(list));
    this.bodyMesh = body;
    Object.assign(this, { hips: bones.hips, spine: bones.spine, neck: bones.neck, head: bones.head });
    this.arms = [-1, 1].map((s) => { const S = s < 0 ? 'L' : 'R'; return { sh: bones['sh' + S], el: bones['el' + S], wr: bones['wr' + S], s }; });
    this.legs = [-1, 1].map((s) => { const S = s < 0 ? 'L' : 'R'; return { hp: bones['hp' + S], kn: bones['kn' + S], an: bones['an' + S], s }; });
    const headRest = bones.head.userData.rest;
    const at = (bone, x, y, z) => V(x, y, z).sub(bone.userData.rest);
    const leather = std({ color: 0x3e2a1a, roughness: 0.6 });
    const metal = std({ color: 0x8a8580, metalness: 0.85, roughness: 0.35 });
    // eyes
    const sclera = std({ color: 0xd8d0c4, roughness: 0.18 }), iris = std({ color: 0x2e2218, roughness: 0.1 });
    const HA = headAnchors();
    for (const ep of HA.eyes) {
      const e = mesh(new THREE.SphereGeometry(0.0122, 14, 12), sclera, false);
      e.position.copy(at(bones.head, ep[0], ep[1], ep[2])); bones.head.add(e);
      const ir = mesh(new THREE.SphereGeometry(0.0062, 12, 10), iris, false);
      ir.position.copy(at(bones.head, ep[0] * 0.97, ep[1], ep[2] + HA.eyeFwd)); bones.head.add(ir);
    }
    // cartridge loops around the gunbelt
    const brass = std({ color: 0xb08a48, metalness: 0.8, roughness: 0.35 });
    const loops = [];
    for (let i = 0; i < 18; i++) {
      const a = -Math.PI * 0.95 + (i / 17) * Math.PI * 0.9 - Math.PI * 0.05;
      const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 5);
      g.translate(Math.cos(a) * 0.172, 0.022, -Math.sin(a) * 0.128);
      loops.push(g);
    }
    bones.hips.add(mesh(mergeGeometriesSafe(loops), brass, false));
    // hat brim (thin, crisp — not sculpted)
    if (o.hat) {
      const brim = new THREE.RingGeometry(0.085, 0.212, 32, 4);
      brim.rotateX(-Math.PI / 2);
      const bp = brim.attributes.position;
      // sides curl up, the front dips over the eyes, the back tips up a touch so the brim reads from behind
      // sides roll up, front and back dip slightly: from behind and above the brim reads as a wide ellipse
      const brimY = (x, z) => { const rr = Math.hypot(x, z) || 1; return Math.max(0, rr - 0.12) * 0.75 * Math.pow(Math.abs(x) / rr, 3) - Math.abs(z) / rr * 0.16 * Math.max(0, rr - 0.11); };
      for (let i = 0; i < bp.count; i++) bp.setY(i, brimY(bp.getX(i), bp.getZ(i)));
      brim.computeVertexNormals();
      const hatM = std({ color: o.hat, roughness: 0.95, side: THREE.DoubleSide });
      const bm = mesh(brim, hatM); bm.position.copy(at(bones.head, 0, HA.hatY, HA.hatZ)); bones.head.add(bm);
      if (MH) {
        // the crown (on the sculpted figures it is part of the body): a pinched, creased felt crown
        const prof = [[0.106, 0], [0.106, 0.025], [0.102, 0.08], [0.096, 0.115], [0.072, 0.13], [0.0, 0.124]].map(([r0, y0]) => new THREE.Vector2(r0, y0));
        const crown = new THREE.LatheGeometry(prof, 28);
        const cp = crown.attributes.position;
        for (let i = 0; i < cp.count; i++) {
          const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
          const crease = Math.exp(-(x * x) / 0.0012) * Math.max(0, y - 0.06) * 0.6;          // centre dent
          const pinch = Math.exp(-((Math.abs(x) - 0.05) ** 2) / 0.0006) * Math.max(0, z) * Math.max(0, y - 0.05) * 1.6;
          cp.setY(i, y - crease); cp.setX(i, x - Math.sign(x) * pinch * 0.4); cp.setZ(i, z * 1.08);
        }
        crown.computeVertexNormals();
        const cm = mesh(crown, hatM); cm.position.copy(at(bones.head, 0, HA.hatY - 0.002, HA.hatZ)); bones.head.add(cm);
      }
      // the brim has body: an underside a few millimetres below and a rolled, bound edge
      const under = brim.clone(); under.translate(0, -0.007, 0);
      const um = mesh(under, std({ color: new THREE.Color(o.hat).multiplyScalar(0.7), roughness: 0.95, side: THREE.DoubleSide })); um.position.copy(bm.position); bones.head.add(um);
      const edge = new THREE.TorusGeometry(0.212, 0.0085, 5, 48); edge.rotateX(Math.PI / 2);
      const ep = edge.attributes.position;
      for (let i = 0; i < ep.count; i++) ep.setY(i, ep.getY(i) + brimY(ep.getX(i), ep.getZ(i)));
      const em = mesh(edge, hatM); em.position.copy(bm.position); bones.head.add(em);
      const band = new THREE.CylinderGeometry(0.099, 0.1, 0.022, 24, 1, true);
      if (MH) band.scale(1.05, 1, 1.13);
      const bandM = mesh(band, leather); bandM.position.copy(at(bones.head, 0, HA.hatY + 0.012, HA.hatZ)); bones.head.add(bandM);
    }
    // turned-down coat collar and lapel edges on the real body
    if (MH && o.coat) {
      const nk = MH.rest.neck, ny = nk[1] - 0.05;
      // lathe angle 0 faces +z (the chest): start and end either side of it so the collar opens at the throat
      let col;
      if (o.winter) {
        // a thick rolled sheepskin collar standing up round the back of the neck: a rounded, closed cross-section
        const prof = [];
        // turned up: it rises from the shoulders to just under the hat brim, hiding the nape
        for (let k = 0; k <= 12; k++) {
          const t = -Math.PI * 0.6 + (k / 12) * Math.PI * 1.3;
          prof.push(new THREE.Vector2(0.098 + Math.cos(t) * 0.036, 0.075 + Math.sin(t) * 0.075));
        }
        col = new THREE.LatheGeometry(prof, 36, Math.PI * 0.16, Math.PI * 1.68);
        // soft lumps along the roll so the silhouette reads as pelt, not a turned ring
        const pp = col.attributes.position;
        for (let k = 0; k < pp.count; k++) {
          const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k), a = Math.atan2(x, z);
          const s = 1 + 0.06 * Math.sin(a * 9 + y * 60) + 0.04 * Math.sin(a * 23 + 1.3);
          pp.setXYZ(k, x * s, y, z * s);
        }
        col.computeVertexNormals();
        col.scale(1.08, 1, 1.02);
      } else if (false) {
        // (a small rolled collar lying close on the shoulders: wider, it stood out behind the neck as a flat dark plate)
        const prof = [[0.068, 0.04], [0.08, 0.03], [0.092, 0.008], [0.1, -0.025], [0.102, -0.05]].map(([r0, y0]) => new THREE.Vector2(r0, y0));
        col = new THREE.LatheGeometry(prof, 28, Math.PI * 0.12, Math.PI * 1.76);
        col.scale(1.05, 1, 0.96);
      }
      if (col) {
      col.translate(0, ny, nk[2] - 0.035);
      col.translate(-bones.spine.userData.rest.x, -bones.spine.userData.rest.y, -bones.spine.userData.rest.z);
      const colM = o.winter
        ? std({ map: furTex_(0xa08a68), roughness: 0.97, side: THREE.DoubleSide })
        : std({ map: memoTex('leather', () => leatherTexture(r)), color: new THREE.Color(o.coat).multiplyScalar(1.9), roughness: 0.62, side: THREE.DoubleSide });
      if (o.winter) { colM.map.repeat.set(6, 1); }
      bones.spine.add(mesh(col, colM));
      }
    }
    // satchel strap across the back, right shoulder to left hip, and the satchel riding on the hip:
    // the diagonal line every rider in the references carries
    if (MH && (outfit === 'arthur' || outfit === 'winter')) {
      // (measured on the clothed figure as tailored, not on the bare body: the draped coat stands further out)
      const RG = MH.regions, P = tpl.geo.attributes.position.array, Rg = MH.region;
      const push = 0;
      const backAt = (x, y) => {
        let best = 1e9;
        for (let i = 0; i < MH.count; i++) {
          const rg = Rg[i];
          if (rg !== RG.torso && rg !== RG.pelvis && rg !== RG.belt) continue;
          if (Math.abs(P[i * 3] - x) < 0.022 && Math.abs(P[i * 3 + 1] - y) < 0.022) best = Math.min(best, P[i * 3 + 2]);
        }
        return best < 1e8 ? best - push - 0.01 : null;
      };
      const yS = MH.rest.neck[1] - 0.045, yH = MH.rest.hips[1] + 0.02;
      const pts = [];
      for (let k = 0; k <= 14; k++) {
        // the figure faces +z, so its right shoulder is at -x (screen right from behind)
        const t = k / 14, x = -0.125 + t * 0.295, y = yS - t * (yS - yH) - Math.sin(t * Math.PI) * 0.03;
        const z = backAt(x, y);
        if (z !== null) pts.push(V(x, y, z));
      }
      if (pts.length > 6) {
        // over the shoulder: the strap climbs onto the top of the shoulder before dropping out of view in front
        const s0 = pts[0];
        // (it ends on top of the shoulder: carried on over it, the ribbon turned edge-on and stood up at the nape as a hook)
        const W = 0.052, pos = [], uvs = [], idx = [];
        for (let k = 0; k < pts.length; k++) {
          const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
          const T = b.clone().sub(a).normalize(), N = V(0, 0, -1), S = T.clone().cross(N).normalize().multiplyScalar(W / 2);
          pos.push(pts[k].x + S.x, pts[k].y + S.y, pts[k].z + S.z, pts[k].x - S.x, pts[k].y - S.y, pts[k].z - S.z);
          uvs.push(0, k * 0.25, 0.15, k * 0.25);
          if (k) { const q = (k - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        sg.setIndex(idx); sg.computeVertexNormals();
        sg.translate(-bones.spine.userData.rest.x, -bones.spine.userData.rest.y, -bones.spine.userData.rest.z);
        const strapM = std({ color: 0x3a2618, roughness: 0.7, side: THREE.DoubleSide });   // plain dark strap leather (the hide texture stretched along it read as snakeskin)   // lighter than the coat so the diagonal reads
        bones.spine.add(mesh(sg, strapM));
        // the satchel: a soft flapped bag on the left hip
        const e = pts[pts.length - 1];
        const bag = sweep([{ p: V(0.235, e.y - 0.02, e.z + 0.13), rx: 0.03, ry: 0.06 }, { p: V(0.25, e.y - 0.05, e.z + 0.09), rx: 0.05, ry: 0.11 },
          { p: V(0.255, e.y - 0.06, e.z + 0.02), rx: 0.055, ry: 0.12 }, { p: V(0.25, e.y - 0.05, e.z - 0.045), rx: 0.05, ry: 0.11 }, { p: V(0.235, e.y - 0.02, e.z - 0.08), rx: 0.03, ry: 0.06 }], 12);
        bag.translate(-bones.hips.userData.rest.x, -bones.hips.userData.rest.y, -bones.hips.userData.rest.z);
        bones.hips.add(mesh(bag, std({ map: memoTex('leather', () => leatherTexture(r)), color: new THREE.Color(1.9, 1.6, 1.3), roughness: 0.7 })));
      }
    }
    // holster + revolver grip on the hip
    // on the right hip (-x), the satchel rides on the left
    const holster = new THREE.BoxGeometry(0.06, 0.2, 0.08); holster.translate(-0.19, -0.14, 0.02);
    bones.hips.add(mesh(holster, leather));
    const grip = new THREE.BoxGeometry(0.03, 0.08, 0.04); grip.rotateZ(0.3); grip.translate(-0.2, -0.01, 0.03);
    bones.hips.add(mesh(grip, std({ color: 0x5a3a24 })));
    // fur fringe: short hair cards around the trapper hat and the collar so the silhouette reads as pelt, not a shell
    if (o.furHat) {
      const furCards = (cx, cy, cz, rad, y0, y1, n, len, bone) => {
        const cards = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r() * 0.3, y = y0 + r() * (y1 - y0);
          const g = new THREE.PlaneGeometry(len * (0.8 + r() * 0.5), len * (1.1 + r() * 0.5));
          g.translate(0, -len * 0.25, 0);
          g.rotateX(0.5 + r() * 0.5);                 // lean outward and down like lying fur
          g.rotateY(a);
          g.translate(cx + Math.sin(a) * rad, y, cz + Math.cos(a) * rad);
          cards.push(g);
        }
        const geo = mergeGeometriesSafe(cards);
        geo.translate(-bone.userData.rest.x, -bone.userData.rest.y, -bone.userData.rest.z);
        return geo;
      };
      const hatFur = std({ map: hairTex_(o.furHatColor || 0x6a5238, 200), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
      const colFur = std({ map: hairTex_(MH ? 0xa08a68 : (o.fur || 0xa48c6c), 200), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
      const hy = MH ? HA.hatY : 1.79, hz = MH ? HA.hatZ : -0.014;
      if (MH) {
        const shell = new THREE.SphereGeometry(0.135, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
        shell.scale(1.16, 0.95, 1.2);                                       // a broad, full fur cap that reads from behind
        {   // tufted, uneven pelt instead of a smooth helmet dome
          const sp = shell.attributes.position;
          for (let k = 0; k < sp.count; k++) {
            const x = sp.getX(k), y = sp.getY(k), z = sp.getZ(k);
            const s = 1 + 0.035 * Math.sin(x * 70 + z * 31) * Math.sin(y * 55 + x * 17) + 0.025 * Math.sin(z * 90 + y * 40);
            sp.setXYZ(k, x * s, y * (0.5 + 0.5 * s), z * s);
          }
          shell.computeVertexNormals();
        }
        const sm = mesh(shell, std({ map: furTex_(o.furHatColor || 0x5e4a38), roughness: 0.95 }));
        sm.position.copy(at(bones.head, 0, hy + 0.01, hz)); bones.head.add(sm);
        {   // and the cap's back, turned down over the nape to the collar (bare, the back of the head showed between
            // cap and collar as a dark hole)
          const back = new THREE.SphereGeometry(0.09, 14, 10); back.scale(1.45, 1.15, 0.6);
          const bm2 = mesh(back, std({ map: furTex_(o.furHatColor || 0x9a7a56), roughness: 0.95 }));
          bm2.position.copy(at(bones.head, 0, hy - 0.055, hz - 0.085)); bones.head.add(bm2);
        }
        for (const sd of [-1, 1]) {   // ear flaps
          const flap = new THREE.SphereGeometry(0.07, 12, 10); flap.scale(0.55, 1.25, 1.15);
          const fm = mesh(flap, std({ map: furTex_(o.furHatColor || 0x9a7a56), roughness: 0.95 }));
          fm.position.copy(at(bones.head, sd * 0.11, hy - 0.04, hz - 0.01)); bones.head.add(fm);
        }
      }
      bones.head.add(mesh(furCards(0, 0, hz, MH ? 0.135 : HA.headR, hy - 0.01, hy + (MH ? 0.06 : 0.14), MH ? 22 : 56, 0.06, bones.head), hatFur, false));   // (a few tufts at the rim: a full ring of strand cards wove the cap into a basket)
      bones.head.add(mesh(furCards(0, 0, hz, MH ? 0.09 : 0.07, hy + (MH ? 0.07 : 0.14), hy + (MH ? 0.1 : 0.16), 20, 0.06, bones.head), hatFur, false));
      // on the real body the rolled collar carries the pelt; only a short soft fringe on its rim
      if (MH) bones.spine.add(mesh(furCards(0, 0, MH.rest.neck[2] - 0.035, 0.125, MH.rest.neck[1] + 0.06, MH.rest.neck[1] + 0.1, 80, 0.032, bones.spine), colFur, false));
      else bones.spine.add(mesh(furCards(0, 0, HA.collarZ, 0.17, HA.collarY - 0.01, HA.collarY + 0.09, 64, 0.075, bones.spine), colFur, false));
    }
    // coat tails: two cloth panels from the waist that split over the cantle and hang down the horse's flanks
    // (the sculpted skirt alone reads as a solid tube from behind)
    if (o.coat && (outfit === 'arthur' || outfit === 'winter')) {
      const tailM = std({ map: memoTex('leather', () => leatherTexture(r)), color: new THREE.Color(o.coat).multiplyScalar(2.1), roughness: 0.62, side: THREE.DoubleSide });
      for (const sd of [-1, 1]) {
        const W = 0.2, L = outfit === 'winter' ? 0.62 : 0.56, segX = 6, segY = 10;
        const g = new THREE.PlaneGeometry(W, L, segX, segY);
        const pp = g.attributes.position;
        for (let k = 0; k < pp.count; k++) {
          const u = pp.getX(k) / W + 0.5, v = 0.5 - pp.getY(k) / L;     // u across, v down the panel
          // hangs from the waist at the back, flares outward over the horse, with a few soft folds
          const x = sd * (0.06 + u * W * 0.9 + v * v * 0.17);
          const y = 1.0 - v * L * 0.92;
          const z = -0.14 - v * 0.09 - Math.sin(u * Math.PI * 2.5 + sd) * 0.012 * v;
          pp.setXYZ(k, x, y, z);
        }
        g.computeVertexNormals();
        g.translate(-bones.hips.userData.rest.x, -bones.hips.userData.rest.y, -bones.hips.userData.rest.z);
        bones.hips.add(mesh(g, tailM));
      }
    }
    // satchel strap for the hero
    // (only on the sculpted figures: the real body carries the fitted strap and satchel built above, and this ring,
    // sized for the old torso, stood out of its neck as a hook with a box floating at the hip)
    if (!MH && (outfit === 'arthur' || outfit === 'winter')) {
      const strap = new THREE.TorusGeometry(0.2, 0.012, 4, 24, Math.PI * 0.9);
      strap.rotateY(Math.PI / 2); strap.rotateX(0.5); strap.translate(0, 0.33, 0.0);
      bones.spine.add(mesh(strap, leather));
      const bag = new THREE.BoxGeometry(0.2, 0.17, 0.07); bag.translate(-0.17, 0.02, 0.08); bag.rotateY(0.3);
      bones.hips.add(mesh(bag, std({ color: 0x5a4632, roughness: 0.9 })));
    }
    // revolver in right hand
    const gun = new THREE.Group();
    const barrel = new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8); barrel.rotateX(Math.PI / 2); barrel.translate(0, 0.0, 0.1);
    const cyl = new THREE.CylinderGeometry(0.02, 0.02, 0.045, 8); cyl.rotateX(Math.PI / 2); cyl.translate(0, -0.005, 0.02);
    const gripG = new THREE.BoxGeometry(0.022, 0.08, 0.03); gripG.rotateX(0.35); gripG.translate(0, -0.045, -0.02);
    gun.add(mesh(barrel, metal), mesh(cyl, metal), mesh(gripG, std({ color: 0x5a3a24 })));
    gun.position.set(0, -0.06, 0.03);
    gun.rotation.x = -Math.PI / 2;
    gun.visible = false;
    bones.wrR.add(gun);
    this.gun = gun;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, 0.19); gun.add(this.muzzle);
    if (outfit === 'outlaw') {
      const rifle = new THREE.Group();
      const st = new THREE.BoxGeometry(0.04, 0.05, 0.4); st.translate(0, 0, -0.3);
      const bb = new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6); bb.rotateX(Math.PI / 2); bb.translate(0, 0.01, 0.2);
      rifle.add(mesh(st, std({ color: 0x5a3a24 })), mesh(bb, metal));
      rifle.position.set(0, 0.35, -0.16); rifle.rotation.set(0, 0, 0.9); rifle.rotateX(Math.PI / 2);
      bones.spine.add(rifle);
    }
    mergeByMaterial(root);
    root.traverse((m) => { if (m.isMesh) m.userData.owner = this; });
    this.phase = r() * 10;
    this.aim = 0; this.speed = 0; this.dead = 0; this.lookYaw = 0;
    this.hipsY = bones.hips.position.y;
  }

  animate(dt, { speed = 0, mode = 'ground', aim = 0, aimPitch = 0, horsePhase = 0, gait = 0, deadT = 0 } = {}) {
    const Lg = this.legs, A = this.arms;
    const H0 = this.hipsY;
    this.aim = THREE.MathUtils.lerp(this.aim, aim, Math.min(1, dt * 10));
    const t = (this.phase += dt * (mode === 'ride' ? 0 : 1) * (1.2 + speed * 1.05));
    const breathe = Math.sin(performance.now() * 0.0018 + this.phase) * 0.012;
    for (const a of A) a.sh.rotation.y = 0;
    if (deadT > 0) {
      const k = Math.min(1, deadT * 1.6);
      this.hips.position.y = THREE.MathUtils.lerp(H0, 0.16, k);
      this.root.rotation.x = -k * Math.PI / 2 * 0.95;
      for (const l of Lg) { l.hp.rotation.x = -k * 0.3 * l.s; l.kn.rotation.x = k * 0.3; }
      for (const a of A) { a.sh.rotation.z = a.s * (0.08 + k * 1.2); a.sh.rotation.x = -k * 0.4; a.el.rotation.x = -k * 0.3; }
      this.spine.rotation.x = 0; this.gun.visible = false;
      return;
    }
    if (mode === 'sit') {
      this.hips.position.y = 0.46 + breathe * 0.1;
      this.spine.rotation.x = 0.18;
      for (const l of Lg) { l.hp.rotation.x = -1.45; l.hp.rotation.z = l.s * 0.12; l.kn.rotation.x = 1.5; l.an.rotation.x = 0.0; }
      for (const a of A) { a.sh.rotation.x = -0.75; a.sh.rotation.z = a.s * 0.15; a.el.rotation.x = -0.6; a.wr.rotation.x = 0.1; }
      this.head.rotation.x = 0.15;
    } else if (mode === 'ride') {
      this.hips.position.y = H0 + Math.sin(horsePhase * Math.PI * 2 * (gait > 2 ? 1 : 2)) * (0.01 + 0.025 * gait);
      this.spine.rotation.x = 0.06 * gait + Math.cos(horsePhase * Math.PI * 2) * 0.02 * gait;
      for (const l of Lg) { l.hp.rotation.x = -1.2; l.hp.rotation.z = l.s * 0.42; l.kn.rotation.x = 1.4; l.an.rotation.x = -0.25; }
      // elbows out a little and hands low over the horn: the arms read beside the body from behind
      for (const a of A) { a.sh.rotation.x = -0.42; a.sh.rotation.z = a.s * 0.2; a.el.rotation.x = -1.15; a.wr.rotation.x = 0.2; }
    } else {
      this.hips.position.y = H0 - Math.abs(Math.sin(t * 2)) * 0.02 * Math.min(speed, 3) + breathe * 0.2;
      const stride = Math.min(1, speed / 2) * 0.55 + Math.max(0, speed - 2) * 0.08;
      this.spine.rotation.x = 0.03 + Math.min(speed, 6) * 0.025;
      Lg.forEach((l, i) => {
        const ph = t * 2 + i * Math.PI;
        l.hp.rotation.z = l.s * 0.02;
        l.hp.rotation.x = -Math.sin(ph) * stride;
        l.kn.rotation.x = Math.max(0, Math.cos(ph)) * stride * 1.6 + 0.04;
        l.an.rotation.x = -Math.max(0, -Math.cos(ph)) * stride * 0.4;
      });
      A.forEach((a, i) => {
        const ph = t * 2 + i * Math.PI + Math.PI;
        a.sh.rotation.x = -Math.sin(ph) * stride * 0.7;
        a.sh.rotation.z = a.s * (0.07 + breathe);
        a.el.rotation.x = -0.12 - Math.max(0, Math.sin(ph)) * stride * 0.6 - Math.min(speed, 6) * 0.08;
        a.wr.rotation.x = 0;
      });
    }
    if (this.aim > 0.01) {
      const a = A[1];
      a.sh.rotation.x = THREE.MathUtils.lerp(a.sh.rotation.x, -Math.PI / 2 - aimPitch, this.aim);
      a.sh.rotation.z = THREE.MathUtils.lerp(a.sh.rotation.z, -0.1, this.aim);
      a.el.rotation.x = THREE.MathUtils.lerp(a.el.rotation.x, 0, this.aim);
      a.wr.rotation.x = THREE.MathUtils.lerp(a.wr.rotation.x, 0, this.aim);
      this.gun.visible = this.aim > 0.4;
    } else this.gun.visible = false;
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, this.lookYaw, Math.min(1, dt * 4));
  }
}

// ===================================================================================== QUADRUPEDS
const QL = { coat: 0, points: 1, hoof: 2, muzzle: 3, mane: 4, belly: 5, white: 6 };

const SPECIES = {
  horse: { scale: 1, coat: 'bay', cell: 0.022 },
  deer: { scale: 0.62, coat: 'deer', cell: 0.022 },
  sheep: { scale: 0.55, coat: 'sheep', cell: 0.024 },
};
const COATS = {
  bay: { coat: 0x3c2113, points: 0x120d0a, mane: 0x110b07, belly: 0x331c10, pinto: 0, dapple: 1 },   // a dark bay, as the reference's forest mount
  pinto: { coat: 0x2e1c12, points: 0x1a120c, mane: 0x100c08, belly: 0x3a2418, pinto: 1 },
  grey: { coat: 0x8a8682, points: 0x4a4644, mane: 0xd0ccc4, belly: 0xa09c98, pinto: 0, dapple: 1 },
  black: { coat: 0x1a1614, points: 0x100c0a, mane: 0x0c0a08, belly: 0x221c18, pinto: 0 },
  redbay: { coat: 0x653a24, points: 0x1a120c, mane: 0x110b07, belly: 0x593320, pinto: 0, dapple: 1 },   // a blood bay: red coat, black points
  chestnut: { coat: 0x8a4422, points: 0x6a3418, mane: 0x6a3016, belly: 0x9a5530, pinto: 0 },
  deer: { coat: 0x8a6440, points: 0x5a4430, mane: 0x6a5038, belly: 0xd8ccb8, pinto: 0 },
  sheep: { coat: 0xd2c8b4, points: 0x2a2420, mane: 0xc8bea8, belly: 0xc0b6a0, pinto: 0 },
};

function legBones(front, s, z, ys) {
  const n = (k) => `${front ? 'f' : 'h'}${s < 0 ? 'L' : 'R'}${k}`;
  const zs = front ? [z, z, z + 0.01, z + 0.01] : [z, z - 0.04, z - 0.11, z - 0.09];
  return [
    { name: n(0), parent: 'body', pos: [s * 0.2, ys[0], zs[0]] },
    { name: n(1), parent: n(0), pos: [s * 0.2, ys[1], zs[1]] },
    { name: n(2), parent: n(1), pos: [s * 0.2, ys[2], zs[2]] },
    { name: n(3), parent: n(2), pos: [s * 0.2, ys[3], zs[3]] },
  ];
}
function quadBones(kind) {
  const B = [{ name: 'root', parent: null, pos: [0, 0, 0] }, { name: 'body', parent: 'root', pos: [0, 0, 0] },
    { name: 'neck', parent: 'body', pos: [0, 1.5, 0.66] }, { name: 'head', parent: 'neck', pos: [0, 1.98, 1.02] }, { name: 'tail', parent: 'body', pos: [0, 1.44, -0.93] }];
  for (const s of [-1, 1]) B.push(...legBones(true, s, 0.52, [1.3, 0.9, 0.51, 0.17]));
  for (const s of [-1, 1]) B.push(...legBones(false, s, -0.62, [1.33, 0.95, 0.56, 0.17]));
  return B;
}

function quadPrims(kind, QB) {
  const P = [];
  const add = (p, label, bone, blend = 0.05, extra = {}) => { Object.assign(p, { label, bone: QB[bone], blend }, extra); P.push(p); };
  const deer = kind === 'deer', sheep = kind === 'sheep';
  const bw = deer ? 0.8 : sheep ? 1.25 : 1; // body width factor
  const lw = deer ? 0.62 : sheep ? 0.85 : 1; // leg thickness
  // torso
  // a deep barrel and chest: the belly hangs at about half the height to the withers, so the legs don't read as stilts
  add(EL([0, 1.3, -0.05], [0.37 * bw, 0.4, 0.62]), QL.coat, 'body', 0.12);
  add(EL([0, 1.15, 0.02], [0.32 * bw, 0.27, 0.5]), QL.belly, 'body', 0.12);
  add(EL([0, 1.28, 0.52], [0.31 * bw, 0.42, 0.3]), QL.coat, 'body', 0.1);
  add(EL([0, 1.43, 0.44], [0.26 * bw, 0.32, 0.28]), QL.coat, 'body', 0.1);
  add(RC([0, 1.58, 0.4], [0, 1.6, 0.1], 0.1, 0.09), QL.coat, 'body', 0.12); // withers
  // (the quarters: no taller than the back, and shorter behind on the centre line than the two buttocks either
  // side of it, so from behind there is a cleft under the tail rather than one dome)
  add(EL([0, 1.33, -0.58], [0.31 * bw, 0.33, 0.31]), QL.coat, 'body', 0.1);
  add(RC([0, 1.52, -0.42], [0, 1.47, -0.84], 0.13, 0.095), QL.coat, 'body', 0.09); // croup
  if (!sheep) for (const s of [-1, 1]) {
    // the big muscle masses: from behind the quarters are two rounded lobes either side of the tail (a heart, not
    // a capsule); the shoulder and forearm muscles stand proud of the barrel
    add(EL([s * 0.175 * bw, 1.31, -0.73], [0.158 * bw, 0.28, 0.255]), QL.coat, 'body', 0.045);
    add(EL([s * 0.235 * bw, 1.47, -0.5], [0.055 * bw, 0.06, 0.1]), QL.coat, 'body', 0.1);   // point of hip (a soft corner, not a knob)
    add(EL([s * 0.21 * bw, 1.32, 0.45], [0.11 * bw, 0.26, 0.16]), QL.coat, 'body', 0.09);
  }
  // neck
  if (sheep) {
    add(RC([0, 1.42, 0.6], [0, 1.52, 0.86], 0.24, 0.14), QL.coat, 'neck', 0.1);
  } else {
    add(RC([0, 1.42, 0.62], [0, 1.9, 0.96], deer ? 0.17 : 0.23, deer ? 0.09 : 0.12), QL.coat, 'neck', 0.1);
    add(RC([0, 1.62, 0.55], [0, 2.0, 0.9], deer ? 0.08 : 0.11, 0.07), QL.coat, 'neck', 0.08); // crest
    if (!deer) add(RC([0, 1.7, 0.5], [0, 2.07, 0.92], 0.055, 0.04), QL.mane, 'neck', 0.02, { labelBias: 0.01 }); // mane ridge
  }
  // head (angled down-forward)
  const H = sheep ? [0, 1.55, 0.95] : [0, 1.98, 1.06];
  const muzzle = sheep ? [0, 1.38, 1.18] : deer ? [0, 1.66, 1.36] : [0, 1.6, 1.38];
  const hs = sheep ? 0.85 : deer ? 0.82 : 1.1;
  add(EL(H, [0.11 * hs, 0.12 * hs, 0.14 * hs]), sheep ? QL.points : QL.coat, 'head', 0.05);
  add(RC([H[0], H[1] - 0.04, H[2] + 0.04], muzzle, 0.1 * hs, 0.06 * hs), sheep ? QL.points : QL.coat, 'head', 0.06);
  add(EL([0, H[1] - 0.12 * hs, H[2] + 0.04], [0.1 * hs, 0.12 * hs, 0.11 * hs]), sheep ? QL.points : QL.coat, 'head', 0.06); // jowl
  add(EL(muzzle, [0.07 * hs, 0.08 * hs, 0.08 * hs]), sheep ? QL.points : QL.muzzle, 'head', 0.04);
  for (const s of [-1, 1]) {
    const ear = sheep ? RC([s * 0.08, H[1] + 0.02, H[2] - 0.04], [s * 0.2, H[1] - 0.02, H[2] - 0.06], 0.03, 0.02)
      : RC([s * 0.06, H[1] + 0.1 * hs, H[2] - 0.04], [s * (deer ? 0.13 : 0.08), H[1] + (deer ? 0.26 : 0.24) * hs, H[2] - 0.06], deer ? 0.04 : 0.032, 0.012);
    add(ear, sheep ? QL.points : QL.coat, 'head', 0.02);
    const nos = EL([s * 0.035, muzzle[1] - 0.01, muzzle[2] + 0.06 * hs], [0.018, 0.02, 0.02]); nos.sub = true; P.push(nos);
    const eyeSock = EL([s * 0.1 * hs, H[1] + 0.02, H[2] + 0.05], [0.02, 0.022, 0.025]); eyeSock.sub = true; P.push(eyeSock);
  }
  // tail root
  add(RC([0, 1.47, -0.86], [0, 1.38, -0.97], 0.062, 0.045), QL.coat, 'tail', 0.035);
  // legs
  const legset = (front, s) => {
    const nb = (k) => `${front ? 'f' : 'h'}${s < 0 ? 'L' : 'R'}${k}`;
    const x = s * 0.2;
    if (front) {
      // muscled forearm tapering hard into a flat, bony cannon
      add(RC([x * 0.95, 1.3, 0.52], [x, 0.92, 0.53], 0.15 * lw, 0.1 * lw), QL.coat, nb(0), 0.08);
      add(RC([x, 0.92, 0.53], [x, 0.53, 0.53], 0.1 * lw, 0.055 * lw), QL.coat, nb(1), 0.05);
      add(EL([x, 0.51, 0.535], [0.066 * lw, 0.072 * lw, 0.07 * lw]), QL.points, nb(2), 0.03);     // knee
      add(RC([x, 0.5, 0.535], [x, 0.18, 0.54], 0.052 * lw, 0.046 * lw), QL.points, nb(2), 0.02);
    } else {
      // (each thigh its own column, daylight between them from the stifle down: fused, the quarters ran down to
      // the hocks as one pear)
      add(EL([x * 1.02, 1.12, -0.62], [0.142 * lw * bw, 0.33, 0.25]), QL.coat, nb(0), 0.05);   // thigh and stifle
      add(RC([x * 1.02, 0.97, -0.67], [x, 0.58, -0.74], 0.115 * lw, 0.058 * lw), QL.coat, nb(1), 0.045);   // gaskin
      add(EL([x, 0.56, -0.745], [0.06 * lw, 0.088 * lw, 0.092 * lw]), QL.points, nb(2), 0.03);    // hock
      add(EL([x, 0.6, -0.815], [0.035 * lw, 0.05 * lw, 0.035 * lw]), QL.points, nb(2), 0.02);       // point of hock
      add(RC([x, 0.55, -0.74], [x, 0.18, -0.72], 0.052 * lw, 0.046 * lw), QL.points, nb(2), 0.02);
    }
    const zf = front ? 0.54 : -0.72;
    add(EL([x, 0.17, zf - 0.005], [0.062 * lw, 0.062 * lw, 0.072 * lw]), QL.points, nb(3), 0.025);   // fetlock
    add(RC([x, 0.16, zf + 0.005], [x, 0.065, zf + 0.04], 0.042 * lw, 0.05 * lw), QL.points, nb(3), 0.02);
    add(RC([x, 0.065, zf + 0.035], [x, 0.018, zf + 0.06], 0.058 * lw, 0.066 * lw), QL.hoof, nb(3), 0.008, { rigid: true });
  };
  for (const s of [-1, 1]) { legset(true, s); legset(false, s); }
  if (sheep) for (const p of P) if (p.label === QL.coat || p.label === QL.belly) p.bump = (x, y, z) => -0.02 * (Math.sin(x * 55) * Math.sin(y * 53) * Math.sin(z * 57));
  return P;
}

const quadCache = new Map();
function quadTemplate(kind) {
  if (quadCache.has(kind)) return quadCache.get(kind);
  const BS = quadBones(kind);
  const QB = Object.fromEntries(BS.map((b, i) => [b.name, i]));
  const prims = quadPrims(kind, QB);
  const geo = sculpt(prims, { cell: SPECIES[kind].cell / DETAIL, pad: 0.04 });
  labelAndSkin(geo, prims, { boneCount: BS.length, sharpness: 0.035 });
  quadCache.set(kind, { geo, BS });
  return quadCache.get(kind);
}

export class Quadruped {
  constructor(kind = 'horse', seed = 1, coat = null) {
    const S = (this.spec = { ...SPECIES[kind], hipY: 1.3 });
    this.kind = kind;
    const r = mulberry32(seed);
    const C = COATS[coat || S.coat] || COATS.bay;
    const tpl = quadTemplate(kind);
    const pal = [hex(C.coat), hex(C.points), hex(0x1c1814), hex(kind === 'horse' ? 0x2a2420 : C.points), hex(C.mane), hex(C.belly), [0.9, 0.88, 0.84]];
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'aRest', 'aLabel']) g.setAttribute(k, tpl.geo.attributes[k]);
    g.setIndex(tpl.geo.index);
    const lab = tpl.geo.attributes.aLabel;
    const col = new Float32Array(lab.count * 3);
    for (let i = 0; i < lab.count; i++) { const c = pal[lab.getX(i)]; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uni = { uPinto: { type: 'float', value: C.pinto || 0 }, uDapple: { type: 'float', value: C.dapple || 0 }, uSeed: { type: 'float', value: r() * 100 }, uBlaze: { type: 'float', value: kind === 'horse' && r() < 0.6 ? 1 : 0 } };
    const mat = skinnedMaterial(/* glsl */ `
      // coat sheen + procedural pinto / dapple / blaze from rest position
      vec3 rp = vRest;
      float isCoat = 1.0 - step(0.5, abs(vLab - 0.0)) ;
      float isBelly = 1.0 - step(0.5, abs(vLab - 5.0));
      float body = max(isCoat, isBelly);
      if (uPinto > 0.5) {
        float pn = fbm2(rp.zy * 2.2 + uSeed) + 0.35 * fbm2(rp.xz * 3.0 + uSeed);
        float patchy = smoothstep(0.66, 0.7, pn) * step(0.95, rp.y) ;
        float legW = (1.0 - step(0.5, abs(vLab - 1.0))) * smoothstep(0.5, 0.2, rp.y) * step(0.0, rp.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.84, 0.8), max(patchy, legW) * (body + legW));
      }
      if (uDapple > 0.5) diffuseColor.rgb *= 0.85 + 0.3 * smoothstep(0.45, 0.6, vnoise(rp.zy * 14.0 + uSeed)) * body;
      if (uBlaze > 0.5) {
        float bl = smoothstep(0.035, 0.02, abs(rp.x)) * step(1.6, rp.y) * step(1.08, rp.z) * step(2.1 - rp.y, 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.86, 0.82), bl);
      }
      diffuseColor.rgb *= 0.95 + 0.1 * (vnoise(vec2(rp.z * 9.0 + rp.x * 4.0, rp.y * 46.0)) - 0.5) * body; // hair flow
      // bay countershading: dark topline, warm red flanks catching the light, darker belly and inner legs
      {
        float top = smoothstep(1.35, 1.75, rp.y) * smoothstep(0.22, 0.05, abs(rp.x));
        float flank = smoothstep(0.08, 0.3, abs(rp.x)) * smoothstep(1.0, 1.35, rp.y) * smoothstep(1.75, 1.45, rp.y);
        diffuseColor.rgb *= mix(1.0, 0.72, top * body);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.0, 0.9), flank * body);
        // the cleft between the quarters and the hollow inside each thigh lie in their own shade
        float cleft = smoothstep(0.075, 0.0, abs(rp.x)) * smoothstep(-0.78, -0.9, rp.z) * smoothstep(0.85, 1.05, rp.y) * smoothstep(1.5, 1.38, rp.y);
        float inner = smoothstep(0.13, 0.04, abs(rp.x)) * smoothstep(1.02, 0.8, rp.y) * smoothstep(0.5, 0.7, rp.y) * step(rp.z, -0.4);
        diffuseColor.rgb *= 1.0 - 0.55 * max(cleft, inner * 0.7) * body;
        // muscle grooves: the line behind the shoulder, the flank hollow, the croup
        float groove = smoothstep(0.05, 0.0, abs(rp.z - 0.42 + 0.25 * (rp.y - 1.3))) * smoothstep(1.0, 1.25, rp.y)
                     + smoothstep(0.06, 0.0, abs(rp.z + 0.38 - 0.2 * (rp.y - 1.2))) * smoothstep(0.95, 1.2, rp.y) * 0.7;
        diffuseColor.rgb *= 1.0 - 0.18 * clamp(groove, 0.0, 1.0) * body;
      }
    `, uni, kind === 'horse', kind);
    mat.roughness = kind === 'sheep' ? 1 : 0.7;
    const root = (this.root = new THREE.Group());
    const { bones, list } = buildBones(tpl.BS);
    root.add(bones.root);
    const body = new THREE.SkinnedMesh(g, mat);
    body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
    root.add(body);
    root.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(list));
    this.bodyMesh = body; this.coatName = coat || S.coat;
    this.body = bones.body; this.neck = bones.neck; this.head = bones.head; this.tail = bones.tail;
    this.legs = [];
    for (const front of [true, false]) for (const s of [-1, 1]) {
      const n = (k) => bones[`${front ? 'f' : 'h'}${s < 0 ? 'L' : 'R'}${k}`];
      this.legs.push({ top: n(0), j2: n(1), j3: n(2), j4: n(3), front, s });
    }
    // broken crust thrown up round each leg where it goes into deep snow (shown only in the snow country)
    if (kind === 'horse') {
      const ringM = std({ color: 0xdfe6ee, roughness: 0.85 });
      const ringG = new THREE.TorusGeometry(0.085, 0.05, 6, 14);
      ringG.rotateX(Math.PI / 2); ringG.scale(1, 0.8, 1);
      { const rp = ringG.attributes.position; for (let k = 0; k < rp.count; k++) { const a = Math.atan2(rp.getZ(k), rp.getX(k)); rp.setY(k, rp.getY(k) * (0.7 + 0.5 * Math.abs(Math.sin(a * 3 + 1.3)))); } ringG.computeVertexNormals(); }
      this.snowRings = this.legs.map((l) => { const m = mesh(ringG, ringM, false); m.position.set(0, 0.2, 0); m.scale.set(1.5, 1.1, 1.5); m.visible = false; l.j4.add(m); return m; });   // (at the snow's surface, where the leg goes in)
    }
    const at = (bone, x, y, z) => V(x, y, z).sub(bone.userData.rest);
    // eyes
    const H = kind === 'sheep' ? [0, 1.55, 0.95] : [0, 1.98, 1.06];
    for (const s of [-1, 1]) {
      const e = mesh(new THREE.SphereGeometry(0.024, 10, 8), std({ color: 0x0a0806, roughness: 0.1 }), false);
      e.position.copy(at(bones.head, s * 0.1 * (kind === 'horse' ? 1 : 0.84), H[1] + 0.02, H[2] + 0.055)); bones.head.add(e);
    }
    const maneM = std({ color: C.mane, roughness: 0.9, side: THREE.DoubleSide });
    if (kind === 'horse') {
      // mane: hair cards along the crest, falling to the off side
      const cards = [];
      // (one unbroken fall of hair lying down the off side of the neck, in two layers, each lock overlapping the next:
      // separate cards turned every way stood up along the crest as a row of black teeth)
      for (const [layer, side, hang, n] of [[0, 1, 0.3, 26], [1, 1, 0.22, 22], [2, -1, 0.1, 18]]) for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1.6) / n;
        const crest = (t) => V(0, 1.66 + Math.min(1, t) * 0.4, 0.46 + Math.min(1, t) * 0.47);
        const a = crest(t0), b = crest(t1), L = hang * (1 - 0.35 * t0) * (0.8 + r() * 0.4);
        const out = side * (0.035 + layer * 0.012), sw = (r() - 0.5) * 0.05;
        const pa = [a.x, a.y + 0.012, a.z, b.x, b.y + 0.012, b.z,
          a.x + out * 1.6, a.y - L * 0.45, a.z + sw - 0.02, b.x + out * 1.6, b.y - L * 0.45, b.z + sw - 0.02,
          a.x + out * 2.1, a.y - L, a.z + sw * 2 - 0.05, b.x + out * 2.1, b.y - L, b.z + sw * 2 - 0.05];
        const g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3));
        g2.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0.5, 1, 0.5, 0, 0, 1, 0], 2));
        g2.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
        g2.computeVertexNormals();
        cards.push(g2);
      }
      const forelock = new THREE.PlaneGeometry(0.08, 0.16); forelock.translate(0, -0.06, 0); forelock.rotateX(-0.6); forelock.translate(0, 2.12, 1.1);
      cards.push(forelock);
      const maneHair = std({ map: hairTex_(new THREE.Color(C.mane).lerp(new THREE.Color(0x4a3420), 0.35).getHex()), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, color: 0xffffff });
      const mm = new THREE.Mesh(mergeGeometriesSafe(cards), maneHair);
      mm.position.set(-bones.neck.userData.rest.x, -bones.neck.userData.rest.y, -bones.neck.userData.rest.z);
      mm.castShadow = true; bones.neck.add(mm);
      // tail: tapered strands
      // tail: a dock plus fanned, curved hair cards with alpha strands
      // many narrow, layered cards in a lifted-brown version of the mane colour, so strands and sheen read
      // instead of a solid black wedge
      // (few strands to a lock, so each card is hair with air in it: at 120 strands every card was solid and the tail a slab)
      const hairTex = hairTex_(new THREE.Color(C.mane).lerp(new THREE.Color(0x7a5e46), 0.9).getHex(), 40, true);
      const hairM = std({ map: hairTex, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.62, envMapIntensity: 0.6 });
      const tcards = [];
      // a hanging switch with real volume: locks set all round the dock facing every way, so from behind it is a
      // round, layered bundle, full at the top and separating into wisps toward the hocks (not one flat card)
      // (fuller: 34 narrow locks within 7 cm of the dock read from behind as one dark strip)
      // (a switch, not a broom: narrow at the dock, fullest a third of the way down, drawing in to loose ends)
      for (let i = 0; i < 30; i++) {
        const th = r() * Math.PI * 2, rho = 0.012 + r() * 0.06;
        const len = 0.95 + r() * 0.5 - rho * 3;
        const c = new THREE.PlaneGeometry(0.08 + r() * 0.06, len, 2, 10);
        c.translate(0, -len / 2, 0);
        const cp0 = c.attributes.position;
        for (let k = 0; k < cp0.count; k++) { const t = Math.max(0, -cp0.getY(k) / len); cp0.setX(k, cp0.getX(k) * (0.55 + 1.25 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.1))), 0.8))); }
        c.rotateZ((r() - 0.5) * 0.1);
        c.rotateY(th);
        c.translate(Math.sin(th) * rho, -0.02 - r() * 0.04, Math.cos(th) * rho - 0.02);
        const cp = c.attributes.position;
        for (let k = 0; k < cp.count; k++) {
          const y = -cp.getY(k);
          // carried a little off the quarters at the dock, then hanging plumb
          cp.setZ(k, cp.getZ(k) - Math.sin(Math.min(y, 0.4) * 2.6) * 0.12 + y * 0.02);
          const sw = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, y) / 1.3)));
          cp.setX(k, cp.getX(k) + Math.sin(th) * 0.05 * sw);
          cp.setZ(k, cp.getZ(k) + Math.cos(th) * 0.03 * sw);
        }
        tcards.push(c);
      }
      const tm = mesh(mergeGeometriesSafe(tcards), hairM); bones.tail.add(tm);
      this.addTack(bones, r, at);
    } else if (kind === 'deer') {
      const tg = new THREE.ConeGeometry(0.06, 0.16, 6); tg.rotateX(Math.PI * 0.85); tg.translate(0, -0.05, -0.03);
      bones.tail.add(mesh(tg, std({ color: 0xe8e0d0 })));
      if (r() < 0.6) {
        const antM = std({ color: 0xc8b898, roughness: 0.8 });
        for (const s of [-1, 1]) {
          const pts = [V(s * 0.06, 0.12, -0.02), V(s * 0.16, 0.3, -0.08), V(s * 0.22, 0.48, 0.0), V(s * 0.2, 0.62, 0.12)];
          const a = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.018, 5), antM);
          bones.head.add(a); a.position.y = 0.0;
          for (let k = 1; k < 3; k++) {
            const b = pts[k];
            bones.head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([b, b.clone().add(V(s * 0.02, 0.14, 0.08))]), 3, 0.012, 4), antM));
          }
        }
      }
    }
    mergeByMaterial(root);
    root.scale.setScalar(S.scale);
    root.traverse((m) => { if (m.isMesh) m.userData.owner = this; });
    this.phase = r();
    this.gait = 0; this.grazing = 0; this.deadT = 0; this.grazeK = 0;
  }

  // a different coat on the same horse (a shot's own mount)
  setCoat(name) {
    const C = COATS[name];
    if (!C || this.coatName === name) return;
    this.coatName = name;
    const pal = [hex(C.coat), hex(C.points), hex(0x1c1814), hex(this.kind === 'horse' ? 0x2a2420 : C.points), hex(C.mane), hex(C.belly), [0.9, 0.88, 0.84]];
    const lab = this.bodyMesh.geometry.attributes.aLabel, col = this.bodyMesh.geometry.attributes.color;
    for (let i = 0; i < lab.count; i++) { const c = pal[lab.getX(i)]; col.setXYZ(i, c[0], c[1], c[2]); }
    col.needsUpdate = true;
  }

  addTack(bones, r, at) {
    const body = bones.body;
    // warm saddle-brown leather (the hide texture is dark; lift it into the mid tones the references show)
    // (worn, oiled and dusty: at 0.55 roughness with a strong lift the bags and seat read as orange plastic)
    const leather = std({ map: memoTex('leather', () => leatherTexture(r)), color: new THREE.Color(0.78, 0.6, 0.47), roughness: 0.82 });   // dark, used saddle leather
    const blanket = std({ map: memoTex('blanket', () => blanketTexture(r)), roughness: 0.95 });
    const bl = sweep([{ p: V(0, 1.69, -0.42), rx: 0.44, ry: 0.035 }, { p: V(0, 1.71, 0.02), rx: 0.46, ry: 0.035 }, { p: V(0, 1.7, 0.3), rx: 0.44, ry: 0.035 }], 14);
    const bp = bl.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i); bp.setY(i, bp.getY(i) - x * x * 1.9); }
    bl.computeVertexNormals();
    body.add(mesh(bl, blanket));
    const seat = sweep([{ p: V(0, 1.77, -0.36), rx: 0.2, ry: 0.06 }, { p: V(0, 1.74, -0.1), rx: 0.2, ry: 0.05 }, { p: V(0, 1.77, 0.15), rx: 0.17, ry: 0.06 }, { p: V(0, 1.86, 0.25), rx: 0.08, ry: 0.08 }], 12);
    const sp = seat.attributes.position;
    for (let i = 0; i < sp.count; i++) { const x = sp.getX(i); sp.setY(i, sp.getY(i) - x * x * 1.2); }
    seat.computeVertexNormals();
    body.add(mesh(seat, leather));
    const horn = new THREE.CylinderGeometry(0.035, 0.025, 0.12, 8); horn.translate(0, 1.91, 0.27); body.add(mesh(horn, leather));
    // cantle: the raised, dished back of the seat (a solid curved board, not a hoop)
    const cant = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 16, 1, false, Math.PI / 2, Math.PI);
    cant.rotateX(Math.PI / 2); cant.scale(1, 0.55, 1); cant.rotateX(-0.35); cant.translate(0, 1.78, -0.35); body.add(mesh(cant, leather));
    // bedroll: a canvas-and-hide roll with the wool blanket showing in the ends
    // the roll bulges between its straps and is cinched in under them, a little sagging and lumpy
    const roll = new THREE.CylinderGeometry(0.105, 0.105, 0.7, 18, 24, true);
    {
      const rp = roll.attributes.position;
      for (let k = 0; k < rp.count; k++) {
        const yy = rp.getY(k), x0 = rp.getX(k), z0 = rp.getZ(k);
        const cinch = 1 - 0.2 * Math.exp(-((Math.abs(yy) - 0.21) ** 2) / 0.0012) + 0.03 * Math.sin(yy * 23 + Math.atan2(z0, x0) * 3);
        rp.setXYZ(k, x0 * cinch, yy, z0 * cinch);
      }
      roll.computeVertexNormals();
    }
    roll.rotateZ(Math.PI / 2); roll.scale(1, 0.9, 1); roll.translate(0, 1.82, -0.52);
    // (a dark, grimed roll of hide and blanket: the pale canvas read as a lit log across the saddle)
    body.add(mesh(roll, std({ map: memoTex('canvas', () => canvasTexture(r)), color: new THREE.Color(0.44, 0.41, 0.35), roughness: 0.97 })));   // a drab canvas roll (the bright patterned blanket read as a toy) (the creased canvas read as a log)
    // the ends show the roll's layers: canvas wrapped round a wool blanket, in a spiral
    const spiral = memoTex('spiral', () => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#5a2a1c'; g.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = k % 2 ? '#7a6248' : '#8a3a26'; g.lineWidth = 4 + (k % 3);
        g.beginPath();
        for (let t = 0; t < Math.PI * 2; t += 0.1) { const rr = 8 + k * 8 + t * 1.3; g.lineTo(64 + Math.cos(t) * rr, 64 + Math.sin(t) * rr); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(20,10,6,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 61, 0, 7); g.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    });
    for (const sx of [-0.35, 0.35]) {
      const end = new THREE.CircleGeometry(0.104, 18); end.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2); end.scale(1, 0.9, 1); end.translate(sx, 1.82, -0.52);
      body.add(mesh(end, std({ map: spiral, color: new THREE.Color(0.6, 0.55, 0.5), roughness: 1 })));
    }
    for (const sx of [-0.21, 0.21]) { const st = new THREE.TorusGeometry(0.108, 0.013, 6, 20); st.rotateY(Math.PI / 2); st.scale(1, 0.92, 1); st.translate(sx, 1.82, -0.52); body.add(mesh(st, std({ color: 0x2a1a10, roughness: 0.5 }))); }
    for (const s of [-1, 1]) {
      // a soft, bulging leather bag (a five-point sweep, rounded at both ends) with a flap and two buckled straps
      // a squarish stitched leather bag (superelliptic section), soft at the corners, with buckles on its straps
      const bag = sweep([{ p: V(s * 0.41, 1.52, -0.69), rx: 0.04, ry: 0.1, sq: 0.6 }, { p: V(s * 0.43, 1.5, -0.65), rx: 0.075, ry: 0.15, sq: 0.7 }, { p: V(s * 0.45, 1.49, -0.47), rx: 0.085, ry: 0.165, sq: 0.66 },
        { p: V(s * 0.43, 1.5, -0.29), rx: 0.075, ry: 0.15, sq: 0.7 }, { p: V(s * 0.41, 1.52, -0.25), rx: 0.04, ry: 0.1, sq: 0.8 }], 28);
      body.add(mesh(bag, leather));
      for (const zz of [-0.56, -0.38]) {
        const bk = new THREE.BoxGeometry(0.012, 0.032, 0.03); bk.translate(s * 0.535, 1.5, zz);
        body.add(mesh(bk, std({ color: 0x4a4034, metalness: 0.6, roughness: 0.55 })));   // (dull brass: bright, the buckles were white squares on the bag)
      }
      const flap = sweep([{ p: V(s * 0.5, 1.62, -0.66), rx: 0.012, ry: 0.06 }, { p: V(s * 0.535, 1.6, -0.47), rx: 0.014, ry: 0.075 }, { p: V(s * 0.5, 1.62, -0.28), rx: 0.012, ry: 0.06 }], 10);
      body.add(mesh(flap, leather));
      for (const zz of [-0.56, -0.38]) {
        const st = new THREE.TorusGeometry(0.17, 0.008, 4, 18, Math.PI); st.rotateY(Math.PI / 2); st.rotateX(Math.PI / 2); st.scale(1, 1, 0.55); st.translate(s * 0.44, 1.5, zz);
        body.add(mesh(st, std({ color: 0x2a1a10, roughness: 0.5 })));
      }
      const strap = new THREE.BoxGeometry(0.02, 0.5, 0.05); strap.translate(s * 0.38, 1.43, 0.05); body.add(mesh(strap, leather));
      const stir = new THREE.TorusGeometry(0.06, 0.012, 4, 10); stir.translate(s * 0.42, 1.14, 0.05);
      body.add(mesh(stir, std({ color: 0x3a3632, metalness: 0.6 })));
      const fender = new THREE.BoxGeometry(0.02, 0.4, 0.18); fender.translate(s * 0.36, 1.45, 0.02); body.add(mesh(fender, leather));
    }
    // the cinch: a girth strap round the barrel under the belly, holding the saddle down
    {
      const girth = new THREE.TorusGeometry(1, 0.028, 6, 30, Math.PI);
      girth.rotateZ(Math.PI); girth.scale(0.395, 0.45, 1); girth.translate(0, 1.33, 0.14);
      body.add(mesh(girth, leather));
      for (const s of [-1, 1]) { const rg = new THREE.TorusGeometry(0.035, 0.007, 4, 10); rg.rotateY(Math.PI / 2); rg.translate(s * 0.4, 1.4, 0.14); body.add(mesh(rg, std({ color: 0x8a8070, metalness: 0.7, roughness: 0.4 }))); }
    }
    // rifle in a leather scabbard slung forward along the off-side shoulder
    const scab = new THREE.CylinderGeometry(0.035, 0.05, 0.8, 8);
    scab.rotateX(Math.PI / 2 - 0.55); scab.translate(0.37, 1.42, 0.38);
    body.add(mesh(scab, leather));
    const stock = new THREE.BoxGeometry(0.045, 0.09, 0.26); stock.rotateX(-0.55); stock.translate(0.37, 1.66, 0.0);
    body.add(mesh(stock, std({ color: 0x3a2416, roughness: 0.68 })));   // dark oiled walnut, not a pale lit block
    const rope = new THREE.TorusGeometry(0.12, 0.018, 6, 16); rope.rotateY(Math.PI / 2); rope.translate(0.24, 1.73, 0.22);
    body.add(mesh(rope, std({ color: 0x9a845a })));
    // bridle + reins on the head
    const hr = bones.head.userData.rest;
    const br = new THREE.TorusGeometry(0.115, 0.012, 4, 14); br.rotateY(Math.PI / 2); br.scale(1, 1.1, 0.8); br.translate(0, -0.08, 0.14);
    bones.head.add(mesh(br, leather));
    const nose = new THREE.TorusGeometry(0.085, 0.012, 4, 14); nose.rotateX(Math.PI / 2 - 0.9); nose.translate(0, -0.26, 0.2);
    bones.head.add(mesh(nose, leather));
    const reinPts = [V(0.08, -0.3, 0.25), V(0.14, -0.38, -0.1), V(0.12, -0.25, -0.55)];
    bones.head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(reinPts), 8, 0.008, 4), leather));
    bones.head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(reinPts.map((p) => V(-p.x, p.y, p.z))), 8, 0.008, 4), leather));
  }

  animate(dt, speed, turn = 0) {
    const s = speed / this.spec.scale;
    const gait = s < 0.1 ? 0 : s < 2.2 ? 1 : s < 5 ? 2 : s < 9 ? 3 : 4;
    this.gait = gait;
    const freq = [0, 0.9, 1.35, 1.7, 2.15][gait] * (gait ? Math.max(0.7, Math.min(1.3, s / [1, 1.6, 3.6, 7, 11][gait])) : 0);
    this.phase = (this.phase + dt * freq) % 1;
    const P = this.phase * Math.PI * 2;
    const offs = { 1: [0.5, 0.0, 0.75, 0.25], 2: [0.0, 0.5, 0.5, 0.0], 3: [0.6, 0.5, 0.15, 0.0], 4: [0.62, 0.52, 0.12, 0.0] }[gait] || [0, 0, 0, 0];
    const amp = [0, 0.3, 0.42, 0.62, 0.78][gait];
    if (this.deadT > 0) {
      const k = Math.min(1, this.deadT * 1.4);
      this.body.rotation.z = k * Math.PI / 2 * 0.95;
      this.body.position.y = -k * 0.55;
      for (const Lg of this.legs) { Lg.top.rotation.x = k * 0.3; Lg.j2.rotation.x = 0; }
      return this.phase;
    }
    this.legs.forEach((Lg, i) => {
      const ph = P + offs[i] * Math.PI * 2;
      const swing = Math.sin(ph);
      const lift = Math.max(0, Math.cos(ph));
      if (Lg.front) {
        Lg.top.rotation.x = -swing * amp * 0.7;
        Lg.j2.rotation.x = 0;
        Lg.j3.rotation.x = -lift * amp * 1.9;
        Lg.j4.rotation.x = lift * amp * 0.8 + 0.04;
      } else {
        Lg.top.rotation.x = -swing * amp * 0.6 + 0.04;
        Lg.j2.rotation.x = -0.1 - lift * amp * 0.5;
        Lg.j3.rotation.x = 0.12 + lift * amp * 0.9;
        Lg.j4.rotation.x = -0.06 + lift * amp * 0.4;
      }
    });
    const bob = gait >= 3 ? Math.sin(P) * 0.07 * amp : Math.abs(Math.sin(P * 2)) * 0.025 * amp;
    this.body.position.y = bob;
    this.body.rotation.x = gait >= 3 ? Math.cos(P) * 0.06 * amp : 0;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -turn * 0.12, Math.min(1, dt * 4));
    const want = gait === 0 && this.grazing > 0 ? 1 : 0;
    this.grazeK = THREE.MathUtils.lerp(this.grazeK, want, Math.min(1, dt * 1.5));
    this.neck.rotation.x = (gait >= 3 ? Math.sin(P + 1) * 0.1 : Math.sin(P * 2) * 0.04 * amp) + this.grazeK * 1.35 - Math.min(gait, 2) * 0.03;
    this.tail.rotation.x = 0.15 + Math.sin(performance.now() * 0.002 + this.phase) * 0.05 + gait * 0.12;
    this.tail.rotation.z = Math.sin(performance.now() * 0.0013) * 0.15;
    return this.phase;
  }
}

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeGeometriesSafe(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
}
