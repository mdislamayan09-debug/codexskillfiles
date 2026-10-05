// Sculpted, skinned characters. Bodies are signed-distance sculptures (smooth-union primitives)
// meshed with surface nets and skinned to a bone rig, so horses and people read as continuous
// organic forms rather than stacked tubes. Accessories (hat brim, tack, guns) ride on bones.
import * as THREE from 'three';
import { sculpt, labelAndSkin, roundCone as RC, ellipsoid as EL, rbox as BX } from './sdf.js';
import { patchMaterial } from './shared.js';
import { mulberry32 } from './noise.js';
import { mergeByMaterial, sweep } from './characters.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function hairTexture(col) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  const base = new THREE.Color(col);
  const r = mulberry32(5);
  for (let i = 0; i < 260; i++) {
    const x = 6 + r() * 116, l = 0.6 + r() * 0.8;
    g.strokeStyle = `rgba(${Math.min(255, base.r * 255 * l + 10)},${Math.min(255, base.g * 255 * l + 8)},${Math.min(255, base.b * 255 * l + 6)},${0.6 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 30, 170, x + (r() - 0.5) * 40, 340, x + (r() - 0.5) * 50, 300 + r() * 212);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Woven saddle blanket with a stepped diamond band
function blanketTexture(r) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const pal = [['#7a2418', '#d8c8a0', '#1e1a18'], ['#2a3a5a', '#c8b890', '#7a2418'], ['#5a4a2a', '#e0d0a8', '#3a5a6a']][Math.floor(r() * 3)];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) { g.fillStyle = pal[2]; g.fillRect(0, y + 2, 256, 4); }
  g.fillStyle = pal[1];
  for (let k = 0; k < 4; k++) { const cx = 32 + k * 64; for (let s = 0; s < 6; s++) g.fillRect(cx - 24 + s * 4, 128 - s * 8, 48 - s * 8, 16 * 0 + 8), g.fillRect(cx - 24 + s * 4, 120 + s * 8, 48 - s * 8, 8); }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 2, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o }));
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
const ROUGH_HUMAN = '0.52, 0.9, 0.62, 0.88, 0.9, 0.42, 0.85, 0.7, 0.45, 0.85, 0.55, 0.4, 0.8';
const ROUGH_QUAD = '0.6, 0.58, 0.35, 0.5, 0.72, 0.65, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6';
function skinnedMaterial(extraFrag = '', uniforms = {}, physical = false, kind = 'human') {
  const m = physical
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, sheen: 0.7, sheenRoughness: 0.45, sheenColor: new THREE.Color(0.55, 0.42, 0.3), envMapIntensity: 1.5 })
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
        ${extraFrag}
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
            const float RT[13] = float[13](${quad ? ROUGH_QUAD : ROUGH_HUMAN});
            roughnessFactor = RT[clamp(int(vLab + 0.5), 0, 12)];
          }`)
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          {
            // procedural surface relief in rest space: cloth folds and weave on people,
            // muscle and hair flow on animals (derivative bump, no textures needed)
            int lab = int(vLab + 0.5);
            float hgt = 0.0;
            ${quad
              ? 'hgt = vnoise(vRest.zy * 7.0 + vRest.x * 3.0) * 0.012 + vnoise(vec2(vRest.z * 60.0, vRest.y * 25.0 + vRest.x * 30.0)) * 0.0012;'
              : `bool cloth = lab == 1 || lab == 2 || lab == 3 || lab == 4 || lab == 9;
                 if (cloth) hgt = (sin(vRest.y * 115.0 + vnoise(vRest.xz * 24.0) * 7.0) * 0.5 + 0.5) * 0.003 * vnoise(vRest.xy * 9.0 + vRest.z * 5.0) + vnoise(vRest.xy * 700.0 + vRest.z * 500.0) * 0.00035;
                 else if (lab == 0 || lab == 11 || lab == 12) hgt = vnoise(vRest.xy * 320.0 + vRest.z * 210.0) * 0.0005;
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
          float fres = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 5.0);
          vec3 wsun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = smoothstep(-0.2, 0.8, dot(-Vv, wsun));
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * fres * back * 0.35 + diffuseColor.rgb * uFogColor * fres * 0.15;
        }`);
    },
  });
}

// ===================================================================================== HUMANS
export const OUTFITS = {
  arthur: { coat: 0x5c544c, shirt: 0x6a7a8e, vest: 0x5a4632, pants: 0x4a423a, hat: 0x2e2620, boots: 0x2a1e16, gloves: 0x5a3e28, bandana: null },
  outlaw: { coat: 0x4a3e32, shirt: 0x8a7a64, vest: 0x2a2420, pants: 0x403a32, hat: 0x3a3028, boots: 0x261a12, gloves: null, bandana: 0x8a2018 },
  rancher: { coat: null, shirt: 0xb8a888, vest: 0x5a4632, pants: 0x4a5468, hat: 0x7a6a50, boots: 0x3a2a1e, gloves: 0x6a4a30, bandana: 0x6a5a40 },
  gent: { coat: 0x2a2a2e, shirt: 0xd8d4c8, vest: 0x4a3a46, pants: 0x2e2e32, hat: 0x1a1a1c, boots: 0x161210, gloves: null, bandana: null },
  lady: { coat: null, shirt: 0x7a4a5a, vest: 0x5a3a48, pants: 0x5a3a48, hat: null, boots: 0x1e1612, gloves: null, bandana: null, dress: true },
  worker: { coat: null, shirt: 0x9a8a70, vest: null, pants: 0x50463a, hat: 0x8a7a5a, boots: 0x30261c, gloves: null, bandana: 0x3e4a5a },
};
const L = { skin: 0, shirt: 1, vest: 2, coat: 3, pants: 4, boots: 5, hat: 6, hair: 7, belt: 8, bandana: 9, gloves: 10, lips: 11 };
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
  if (o.coat) {
    add(EL([0, 1.33, -0.005], [0.205, 0.19, 0.135]), L.coat, 'spine', 0.03);
    add(RC([-0.17, 1.47, -0.02], [0.17, 1.47, -0.02], 0.085, 0.085), L.coat, 'spine', 0.03);
    add(RC([0, 1.15, -0.012], [0, 0.74, -0.03], 0.185, 0.215), L.coat, 'hips', 0.035);
    add(RC([0, 1.52, -0.05], [0, 1.6, -0.06], 0.085, 0.07), L.coat, 'spine', 0.03); // collar
  }
  if (o.dress) add(RC([0, 1.02, 0], [0, 0.1, 0], 0.17, 0.38), L.pants, 'hips', 0.06);
  // neck & head
  add(RC([0, 1.5, -0.01], [0, 1.68, 0.0], 0.058, 0.052), L.skin, 'neck', 0.03);
  if (o.bandana) add(EL([0, 1.56, 0.0], [0.075, 0.035, 0.07]), L.bandana, 'neck', 0.01);
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
  if (o.hat) {
    add(RC([0, 1.835, -0.008], [0, 1.95, -0.008], 0.098, 0.09), L.hat, 'head', 0.01);
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

const humanCache = new Map();
function humanTemplate(outfit) {
  if (humanCache.has(outfit)) return humanCache.get(outfit);
  const o = OUTFITS[outfit];
  const prims = humanPrims(o);
  const geo = sculpt(prims, { cell: 0.0115, pad: 0.03 });
  labelAndSkin(geo, prims, { boneCount: HUMAN_BONES.length, sharpness: 0.018 });
  // open coat front reveals the vest/shirt; stubble on the jaw
  const p = geo.attributes.position, lab = geo.attributes.aLabel;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (o.coat && lab.getX(i) === L.coat && z > 0.06 && Math.abs(x) < 0.06 + (1.45 - y) * 0.06 && y > 1.02 && y < 1.5) lab.setX(i, o.vest ? L.vest : L.shirt);
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
    pal[12] = outfit === 'arthur' || r() < 0.6 ? skin.map((v, i) => v * 0.3 + hair[i] * 0.75) : skin.map((v) => v * 0.85); // beard / stubble
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
    for (const s of [-1, 1]) {
      const e = mesh(new THREE.SphereGeometry(0.0125, 12, 10), sclera, false);
      e.position.copy(at(bones.head, s * 0.033, 1.763, 0.082)); bones.head.add(e);
      const ir = mesh(new THREE.SphereGeometry(0.0062, 10, 8), iris, false);
      ir.position.copy(at(bones.head, s * 0.032, 1.763, 0.0925)); bones.head.add(ir);
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
      const brim = new THREE.RingGeometry(0.085, 0.195, 32, 3);
      brim.rotateX(-Math.PI / 2);
      const bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), z = bp.getZ(i), rr = Math.hypot(x, z);
        const curl = Math.max(0, rr - 0.13) * 0.9 * Math.pow(Math.abs(x) / rr, 3);
        bp.setY(i, curl - Math.abs(z) / rr * 0.16 * Math.max(0, rr - 0.11));
      }
      brim.computeVertexNormals();
      const hatM = std({ color: o.hat, roughness: 0.95, side: THREE.DoubleSide });
      const bm = mesh(brim, hatM); bm.position.copy(at(bones.head, 0, 1.838, -0.008)); bones.head.add(bm);
      const edge = new THREE.TorusGeometry(0.195, 0.004, 4, 40); edge.rotateX(Math.PI / 2);
      const ep = edge.attributes.position;
      for (let i = 0; i < ep.count; i++) {
        const x = ep.getX(i), z = ep.getZ(i), rr = Math.hypot(x, z) || 1;
        ep.setY(i, ep.getY(i) + Math.max(0, rr - 0.13) * 0.9 * Math.pow(Math.abs(x) / rr, 3) - Math.abs(z) / rr * 0.16 * Math.max(0, rr - 0.11));
      }
      const em = mesh(edge, hatM); em.position.copy(bm.position); bones.head.add(em);
      const band = new THREE.CylinderGeometry(0.099, 0.1, 0.022, 24, 1, true);
      const bandM = mesh(band, leather); bandM.position.copy(at(bones.head, 0, 1.85, -0.008)); bones.head.add(bandM);
    }
    // holster + revolver grip on the hip
    const holster = new THREE.BoxGeometry(0.06, 0.2, 0.08); holster.translate(0.19, -0.14, 0.02);
    bones.hips.add(mesh(holster, leather));
    const grip = new THREE.BoxGeometry(0.03, 0.08, 0.04); grip.rotateZ(-0.3); grip.translate(0.2, -0.01, 0.03);
    bones.hips.add(mesh(grip, std({ color: 0x5a3a24 })));
    // satchel strap for the hero
    if (outfit === 'arthur') {
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
      for (const a of A) { a.sh.rotation.x = -0.5; a.sh.rotation.z = -a.s * 0.12; a.el.rotation.x = -1.0; a.wr.rotation.x = 0.15; }
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
  bay: { coat: 0x5a3018, points: 0x16100c, mane: 0x120c08, belly: 0x6a3a20, pinto: 0 },
  pinto: { coat: 0x2e1c12, points: 0x1a120c, mane: 0x100c08, belly: 0x3a2418, pinto: 1 },
  grey: { coat: 0x8a8682, points: 0x4a4644, mane: 0xd0ccc4, belly: 0xa09c98, pinto: 0, dapple: 1 },
  black: { coat: 0x1a1614, points: 0x100c0a, mane: 0x0c0a08, belly: 0x221c18, pinto: 0 },
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
    { name: 'neck', parent: 'body', pos: [0, 1.5, 0.66] }, { name: 'head', parent: 'neck', pos: [0, 1.98, 1.02] }, { name: 'tail', parent: 'body', pos: [0, 1.52, -0.95] }];
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
  add(EL([0, 1.33, -0.05], [0.36 * bw, 0.36, 0.62]), QL.coat, 'body', 0.12);
  add(EL([0, 1.2, 0.02], [0.31 * bw, 0.24, 0.5]), QL.belly, 'body', 0.12);
  add(EL([0, 1.33, 0.52], [0.3 * bw, 0.38, 0.3]), QL.coat, 'body', 0.1);
  add(EL([0, 1.43, 0.44], [0.26 * bw, 0.32, 0.28]), QL.coat, 'body', 0.1);
  add(RC([0, 1.58, 0.4], [0, 1.6, 0.1], 0.1, 0.09), QL.coat, 'body', 0.12); // withers
  add(EL([0, 1.38, -0.6], [0.35 * bw, 0.37, 0.36]), QL.coat, 'body', 0.1);
  add(RC([0, 1.6, -0.45], [0, 1.54, -0.86], 0.14, 0.11), QL.coat, 'body', 0.1); // croup
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
  const hs = sheep ? 0.85 : deer ? 0.82 : 1;
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
  add(RC([0, 1.52, -0.9], [0, 1.44, -1.0], 0.07, 0.05), QL.coat, 'tail', 0.04);
  // legs
  const legset = (front, s) => {
    const nb = (k) => `${front ? 'f' : 'h'}${s < 0 ? 'L' : 'R'}${k}`;
    const x = s * 0.2;
    if (front) {
      add(RC([x * 0.95, 1.3, 0.52], [x, 0.92, 0.53], 0.14 * lw, 0.085 * lw), QL.coat, nb(0), 0.08);
      add(RC([x, 0.92, 0.53], [x, 0.53, 0.53], 0.085 * lw, 0.05 * lw), QL.coat, nb(1), 0.04);
      add(EL([x, 0.51, 0.535], [0.055 * lw, 0.06 * lw, 0.06 * lw]), QL.points, nb(2), 0.03);
      add(RC([x, 0.5, 0.535], [x, 0.18, 0.54], 0.043 * lw, 0.038 * lw), QL.points, nb(2), 0.02);
    } else {
      add(EL([x * 0.95, 1.18, -0.6], [0.17 * lw * bw, 0.3, 0.24]), QL.coat, nb(0), 0.1);
      add(RC([x, 0.97, -0.66], [x, 0.58, -0.74], 0.11 * lw, 0.055 * lw), QL.coat, nb(1), 0.05);
      add(EL([x, 0.56, -0.74], [0.05 * lw, 0.075 * lw, 0.07 * lw]), QL.points, nb(2), 0.03);
      add(RC([x, 0.55, -0.74], [x, 0.18, -0.72], 0.043 * lw, 0.038 * lw), QL.points, nb(2), 0.02);
    }
    const zf = front ? 0.54 : -0.72;
    add(EL([x, 0.17, zf], [0.05 * lw, 0.05 * lw, 0.06 * lw]), QL.points, nb(3), 0.025);
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
  const geo = sculpt(prims, { cell: SPECIES[kind].cell, pad: 0.04 });
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
      diffuseColor.rgb *= 0.92 + 0.08 * sin(rp.z * 60.0 + rp.y * 20.0) * body; // hair flow
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
    this.bodyMesh = body;
    this.body = bones.body; this.neck = bones.neck; this.head = bones.head; this.tail = bones.tail;
    this.legs = [];
    for (const front of [true, false]) for (const s of [-1, 1]) {
      const n = (k) => bones[`${front ? 'f' : 'h'}${s < 0 ? 'L' : 'R'}${k}`];
      this.legs.push({ top: n(0), j2: n(1), j3: n(2), j4: n(3), front, s });
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
      for (let i = 0; i < 22; i++) {
        const t = i / 21;
        const p = V(0, 1.68 + t * 0.36, 0.5 + t * 0.42);
        const g2 = new THREE.PlaneGeometry(0.19, 0.5 - t * 0.16, 1, 4);
        g2.translate(0, -0.1, 0);
        const gp = g2.attributes.position;
        for (let k = 0; k < gp.count; k++) gp.setZ(k, gp.getZ(k) + (gp.getY(k) + 0.1) * (gp.getY(k) + 0.1) * -0.6);
        g2.rotateY(Math.PI / 2); g2.rotateZ(-0.35 - r() * 0.15); g2.rotateX(-0.75);
        g2.translate(p.x + 0.04, p.y, p.z);
        cards.push(g2);
      }
      const forelock = new THREE.PlaneGeometry(0.08, 0.16); forelock.translate(0, -0.06, 0); forelock.rotateX(-0.6); forelock.translate(0, 2.12, 1.1);
      cards.push(forelock);
      const maneHair = std({ map: hairTexture(new THREE.Color(C.mane).lerp(new THREE.Color(0x4a3420), 0.35).getHex()), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, color: 0xffffff });
      const mm = new THREE.Mesh(mergeGeometriesSafe(cards), maneHair);
      mm.position.set(-bones.neck.userData.rest.x, -bones.neck.userData.rest.y, -bones.neck.userData.rest.z);
      mm.castShadow = true; bones.neck.add(mm);
      // tail: tapered strands
      // tail: a dock plus fanned, curved hair cards with alpha strands
      // many narrow, layered cards in a lifted-brown version of the mane colour, so strands and sheen read
      // instead of a solid black wedge
      const hairTex = hairTexture(new THREE.Color(C.mane).lerp(new THREE.Color(0x5a4030), 0.3).getHex());
      const hairM = std({ map: hairTex, alphaTest: 0.32, side: THREE.DoubleSide, roughness: 0.55 });
      const tcards = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 15 - 0.5) * 1.7 + (r() - 0.5) * 0.2;
        const len = 0.7 + r() * 0.45;
        const c = new THREE.PlaneGeometry(0.12 + r() * 0.04, len, 1, 7);
        c.translate(0, -len / 2, 0);
        const cp = c.attributes.position;
        for (let k = 0; k < cp.count; k++) { const y = -cp.getY(k); cp.setZ(k, -Math.sin(Math.min(y, 0.5) * 2.2) * 0.16 + y * 0.05); cp.setX(k, cp.getX(k) * (1 + y * 0.9)); }
        c.rotateZ((r() - 0.5) * 0.25);
        c.rotateY(a);
        c.translate((r() - 0.5) * 0.04, -0.02 - r() * 0.04, -0.03 - r() * 0.03);
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

  addTack(bones, r, at) {
    const body = bones.body;
    const leather = std({ color: 0x4a2c18, roughness: 0.5 });
    const blanket = std({ map: blanketTexture(r), roughness: 0.95 });
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
    const cant = new THREE.TorusGeometry(0.16, 0.03, 6, 12, Math.PI); cant.translate(0, 1.78, -0.36); body.add(mesh(cant, leather));
    const roll = new THREE.CylinderGeometry(0.12, 0.12, 0.75, 12); roll.rotateZ(Math.PI / 2); roll.translate(0, 1.83, -0.52);
    body.add(mesh(roll, std({ color: 0x5a5a48, roughness: 1 })));
    for (const sx of [-0.22, 0.22]) { const st = new THREE.TorusGeometry(0.125, 0.012, 5, 16); st.rotateY(Math.PI / 2); st.translate(sx, 1.83, -0.52); body.add(mesh(st, leather)); }
    for (const s of [-1, 1]) {
      const bag = sweep([{ p: V(s * 0.41, 1.53, -0.62), rx: 0.06, ry: 0.13 }, { p: V(s * 0.42, 1.53, -0.45), rx: 0.07, ry: 0.15 }, { p: V(s * 0.41, 1.53, -0.3), rx: 0.06, ry: 0.13 }], 8);
      body.add(mesh(bag, leather));
      const strap = new THREE.BoxGeometry(0.02, 0.5, 0.05); strap.translate(s * 0.38, 1.43, 0.05); body.add(mesh(strap, leather));
      const stir = new THREE.TorusGeometry(0.06, 0.012, 4, 10); stir.translate(s * 0.42, 1.14, 0.05);
      body.add(mesh(stir, std({ color: 0x3a3632, metalness: 0.6 })));
      const fender = new THREE.BoxGeometry(0.02, 0.4, 0.18); fender.translate(s * 0.36, 1.45, 0.02); body.add(mesh(fender, leather));
    }
    // rifle in a leather scabbard slung forward along the off-side shoulder
    const scab = new THREE.CylinderGeometry(0.035, 0.05, 0.8, 8);
    scab.rotateX(Math.PI / 2 - 0.55); scab.translate(0.37, 1.42, 0.38);
    body.add(mesh(scab, leather));
    const stock = new THREE.BoxGeometry(0.045, 0.09, 0.26); stock.rotateX(-0.55); stock.translate(0.37, 1.66, 0.0);
    body.add(mesh(stock, std({ color: 0x5a3820, roughness: 0.5 })));
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
