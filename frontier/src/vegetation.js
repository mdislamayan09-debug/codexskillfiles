// Vegetation: GPU grass fields, procedural trees (oak / pine / cypress) with distant impostors,
// bushes, ferns and rocks. Everything is instanced and streamed around the camera.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, GLSL_COMMON, GLSL_FOG_PARS, GLSL_SUNSHADOW, patchMaterial } from './shared.js';
import { HALF, WORLD_SIZE, TOWN, RANCH, CAMP, CHURCH, CABIN } from './world.js';
import { mulberry32, Simplex2 } from './noise.js';
import { leafCardTexture, pineCardTexture, barkTexture } from './textures.js';

// ---------------------------------------------------------------------------- wind
const WIND_VERT = /* glsl */ `
attribute float aSway;
varying vec3 vTreePos;
vec3 windOffset(vec3 wp, float sway, float flutter){
  float ph = dot(wp.xz, vec2(0.031, 0.027));
  float gust = vnoise(wp.xz*0.01 + uTime*0.15) * 1.4;
  float s = (sin(uTime*1.25 + ph) * 0.6 + sin(uTime*2.3 + ph*1.7) * 0.25 + 0.4) * gust;
  vec3 o = vec3(uWind.x, 0.0, uWind.y) * s * sway * 0.35 * uWindStrength;
  o += vec3(sin(uTime*7.0 + wp.x*2.1 + wp.y*1.3), sin(uTime*6.0 + wp.z*2.0)*0.6, cos(uTime*7.3 + wp.z*1.9)) * 0.035 * flutter * gust;
  return o;
}
`;
const WIND_BODY = /* glsl */ `
  vec3 transformed = vec3(position);
  {
    vec4 iw = vec4(0.0,0.0,0.0,1.0);
    #ifdef USE_INSTANCING
      iw = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
    #endif
    vTreePos = iw.xyz;
    vec3 wo = windOffset(iw.xyz + position, aSway, LEAF_FLUTTER);
    #ifdef USE_INSTANCING
      wo = (inverse(mat3(instanceMatrix)) * wo);
    #endif
    transformed += wo;
  }
`;

// Climate on foliage and bark, read at the tree's own position: snow settles on boughs and branch tops
// in the cold north, and broadleaf crowns turn orange, gold and red in the autumn hills.
const CLIMATE_FRAG = (pos) => /* glsl */ `
  #include <color_fragment>
  {
    vec4 cl = climateAt(${pos}.xz);
    #ifdef AUTUMN_LEAVES
    if (cl.b > 0.02) {
      float th = hash12(floor(${pos}.xz * 0.37) + 7.0);
      vec3 tint = th < 0.3 ? vec3(1.0, 0.42, 0.1) : th < 0.55 ? vec3(0.95, 0.72, 0.16) : th < 0.75 ? vec3(0.8, 0.22, 0.08) : vec3(0.0);
      float l = min(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), 0.22);
      vec3 autumnC = l * tint * 2.9 * (0.8 + 0.4 * hash12(floor(vWPos.xz * 1.5 + vWPos.y)));
      diffuseColor.rgb = mix(diffuseColor.rgb, autumnC, cl.b * step(th, 0.75));
    }
    #endif
    if (cl.r > 0.05) {
      vec3 fn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
      float up = abs(fn.y);
      float sk = smoothstep(0.35, 0.8, cl.r) * smoothstep(0.4, 0.85, up + 0.3 * (hash12(floor(vWPos.xz * 3.0 + vWPos.y * 2.0)) - 0.5));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.87, 0.92), sk * 0.9);
      #ifdef FROST_ALL
      // hoarfrost furs every twig of the dry brush in the cold country
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), smoothstep(0.4, 0.85, cl.r) * 0.5);
      #endif
    }
  }`;
function windMaterial(mat, flutter = 0, extra = {}, { autumn = false, frost = false, trans = null } = {}) {
  return patchMaterial(mat, {
    sunShadow: true,
    noFlip: flutter > 0,
    vertexHead: `#define LEAF_FLUTTER ${flutter.toFixed(2)}\n` + WIND_VERT,
    vertexBody: WIND_BODY,
    fragHead: 'varying vec3 vTreePos;\n' + (autumn ? '#define AUTUMN_LEAVES\n' : '') + (frost ? '#define FROST_ALL\n' : '') + (trans !== null ? `#define LEAF_TRANS ${trans.toFixed(3)}\n` : ''),
    fragColor: CLIMATE_FRAG('vTreePos'),
    ...extra,
  });
}
function windDepthMaterial(map, flutter = 0) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n#define LEAF_FLUTTER ${flutter.toFixed(2)}\n${WIND_VERT}`)
      .replace('#include <begin_vertex>', WIND_BODY);
  };
  return m;
}

// Foliage translucency + spherical-normal softening
const LEAF_EMISSIVE = /* glsl */ `
  #include <emissivemap_fragment>
  {
    vec3 vdir = normalize(vWPos - cameraPosition);
    float back = pow(max(dot(vdir, normalize(uSunDir)), 0.0), 3.0);
    // light through a leaf comes out yellow-green, not white
    #ifndef LEAF_TRANS
    #define LEAF_TRANS 0.18
    #endif
    totalEmissiveRadiance += diffuseColor.rgb * vec3(0.95, 1.05, 0.45) * uSunColor * gSunVis * back * LEAF_TRANS;
  }
`;

// ---------------------------------------------------------------------------- geometry helpers
function setSway(geo, fn) {
  const p = geo.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('aSway', new THREE.BufferAttribute(a, 1));
  return geo;
}

function branchGeo(start, end, r0, r1, radial = 7) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 2, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(start.x, start.y, start.z);
  // uv: v along length in metres for bark tiling
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(r0 * 6)), uv.getY(i) * len * 0.6);
  return g;
}

function cardGeo(size, center, normalCenter, rnd, aspect = 1, upBias = 0.4) {
  const g = new THREE.PlaneGeometry(size, size * aspect);
  g.rotateY(rnd() * Math.PI * 2);
  g.rotateX((rnd() - 0.5) * 1.6);
  g.rotateZ((rnd() - 0.5) * 1.6);
  g.translate(center.x, center.y, center.z);
  // spherical normals around canopy centre for soft volumetric shading
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(normalCenter).normalize();
    v.y += upBias; v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// Darken foliage toward the canopy core and underside (cheap self-shadowing).
function leafAO(geo, radial = false) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, c = bb.getCenter(new THREE.Vector3()), e = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d;
    if (radial) d = Math.hypot(x, z) / Math.max(0.5, (1 - (y - bb.min.y) / (2 * e.y)) * Math.max(e.x, e.z) + 0.3);
    else d = Math.hypot((x - c.x) / e.x, (y - c.y) / e.y, (z - c.z) / e.z);
    const top = (y - bb.min.y) / (2 * e.y);
    const ao = (0.25 + 0.75 * THREE.MathUtils.smoothstep(d, 0.15, 0.95)) * (0.82 + 0.12 * top);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ---------------------------------------------------------------------------- tree builders
function buildOak(seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = 9 + rnd() * 5;
  const canopyC = new THREE.Vector3(0, height * 0.72, 0);
  const tips = [];
  const grow = (start, dir, len, r, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    wood.push(branchGeo(start, end, r, r * 0.68, depth > 1 ? 7 : 5));
    if (depth === 0 || r < 0.05) { tips.push(end); return; }
    if (depth === 1) tips.push(start.clone().lerp(end, 0.6));
    const n = depth >= 3 ? 3 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      d.x += (rnd() - 0.5) * 1.6; d.z += (rnd() - 0.5) * 1.6; d.y += 0.15 + rnd() * 0.3;
      if (depth >= 3) { const a = (i / n) * Math.PI * 2 + rnd(); d.set(Math.cos(a) * 0.9, 0.55 + rnd() * 0.4, Math.sin(a) * 0.9); }
      d.normalize();
      grow(end, d, len * (0.62 + rnd() * 0.2), r * 0.62, depth - 1);
    }
  };
  // trunk with slight lean
  const trunkTop = new THREE.Vector3((rnd() - 0.5) * 0.6, height * 0.3, (rnd() - 0.5) * 0.6);
  wood.push(branchGeo(new THREE.Vector3(0, -0.5, 0), trunkTop, 0.5 + rnd() * 0.15, 0.36, 9));
  // root flare
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    wood.push(branchGeo(new THREE.Vector3(Math.cos(a) * 0.9, -0.3, Math.sin(a) * 0.9), new THREE.Vector3(Math.cos(a) * 0.1, 1.4, Math.sin(a) * 0.1), 0.16, 0.25, 5));
  }
  grow(trunkTop, new THREE.Vector3(0, 1, 0), height * 0.26, 0.36, 3);
  // leaf clusters
  const leafSize = 3.0 + rnd() * 0.9;
  for (const t of tips) {
    for (let k = 0; k < 3; k++) {
      const c = t.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.8, (rnd() - 0.35) * 1.3, (rnd() - 0.5) * 1.8));
      leaves.push(cardGeo(leafSize * (0.8 + rnd() * 0.5), c, canopyC, rnd));
    }
  }
  // fill the crown interior so it reads as a mass, not lollipops
  const crownR = Math.max(...tips.map((t) => Math.hypot(t.x, t.z))) * 0.75 + 1;
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * crownR;
    const c = new THREE.Vector3(Math.cos(a) * rr, canopyC.y + (rnd() - 0.5) * height * 0.22, Math.sin(a) * rr);
    leaves.push(cardGeo(leafSize * 1.1, c, canopyC, rnd));
  }
  const woodG = setSway(mergeGeometries(wood), (x, y) => Math.max(0, y - 2) / height * 0.6);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y) => Math.max(0, y - 2) / height));
  return { wood: woodG, leaves: leafG, height, radius: 6 };
}

// kind: 'pine' (heartlands), 'tall' (forest giants, bare lower trunk), 'fir' (dense cone to the ground)
function buildPine(seed, kind = 'pine') {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = kind === 'tall' ? 26 + rnd() * 9 : kind === 'fir' ? 11 + rnd() * 7 : 14 + rnd() * 9;
  wood.push(branchGeo(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, height - 2.4, 0), (kind === 'tall' ? 0.78 : 0.38) + rnd() * 0.12, 0.06, 8));
  const whorls = kind === 'tall' ? 30 + Math.floor(rnd() * 5) : 20 + Math.floor(rnd() * 6);
  const base = kind === 'tall' ? height * (0.42 + rnd() * 0.12) : kind === 'fir' ? 0.5 + rnd() * 0.4 : 2.5 + rnd() * 1.5;
  if (kind === 'tall') {
    // dead lower branch stubs on the bare trunk
    for (let i = 0; i < 9; i++) {
      const y = 2 + rnd() * (base - 2), a = rnd() * 6.28, L = 0.6 + rnd() * 1.4;
      wood.push(branchGeo(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * L, y - 0.2 - rnd() * 0.4, Math.sin(a) * L), 0.06, 0.02, 4));
    }
  }
  const spread = kind === 'tall' ? 3.3 : kind === 'fir' ? 3.1 : 3.4;
  const tall = kind === 'tall';
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = base + t * (height - base);
    // forest giants: a ragged columnar crown — missing whorls, uneven limbs — rather than a perfect cone
    if (tall && t < 0.85 && rnd() < 0.22) continue;
    const r = tall
      ? spread * (0.5 + 0.5 * Math.pow(1 - t, 0.6)) * (t > 0.82 ? (1 - t) / 0.18 : 1) + 0.45
      : Math.pow(1 - t, 0.9) * (spread + rnd() * 0.6) + (kind === 'fir' ? 0.45 : 0.55);
    const n = tall ? 4 + Math.floor(rnd() * 4) : 8 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * (tall ? 1.4 : 0.7) + w;
      const droop = 0.18 + rnd() * 0.25 + (1 - t) * 0.25 + (kind === 'fir' ? 0.18 : 0);
      const lr = tall ? r * (0.6 + rnd() * 0.65) : r;
      // cross cards: one lying along the branch, one standing on its edge, so the
      // silhouette reads from the side and from above
      for (const vert of [false, true]) {
        const r = lr;
        const g = new THREE.PlaneGeometry(r * 0.95, r * (vert ? 0.34 : 0.5));
        g.translate(r * 0.5, 0, 0);
        if (!vert) g.rotateX(Math.PI / 2 + (rnd() - 0.5) * 0.4);
        else g.rotateX((rnd() - 0.5) * 0.3);
        g.rotateZ(-droop);
        g.rotateY(a);
        g.translate(0, y, 0);
        const p = g.attributes.position, nn = g.attributes.normal;
        for (let k = 0; k < p.count; k++) {
          const v = new THREE.Vector3(p.getX(k), 0, p.getZ(k)).normalize();
          v.y = 0.75; v.normalize();
          nn.setXYZ(k, v.x, v.y, v.z);
        }
        leaves.push(g);
      }
    }
  }
  // top tuft: a ring of short up-swept shoots around a needled leader, so the crown ends in a
  // dense point rather than a bare pole with a blob on it
  for (let i = 0; i < 7; i++) {
    const L = 1.1 + rnd() * 0.5, y = height - 2.4 + (i / 7) * 1.6;
    const g = new THREE.PlaneGeometry(L, L * 0.5);
    g.translate(L * 0.5, 0, 0);
    g.rotateX((rnd() - 0.5) * 0.6);
    g.rotateZ(0.75 + (i / 7) * 0.45);
    g.rotateY((i / 7) * Math.PI * 2 * 1.6 + rnd());
    g.translate(0, y, 0);
    leaves.push(g);
  }
  for (let i = 0; i < 2; i++) {
    const g = new THREE.PlaneGeometry(1.5, 0.6);
    g.translate(0.75, 0, 0);
    g.rotateZ(Math.PI / 2);
    g.rotateY(i * Math.PI / 2);
    g.translate(0, height - 1.3, 0);
    leaves.push(g);
  }
  const woodG = setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), (x, y) => (y / height) ** 2 * 0.5);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y, z) => (y / height) ** 2 * 0.6 + Math.hypot(x, z) * 0.05), true);
  return { wood: woodG, leaves: leafG, height, radius: 3.5 };
}

// A long leaf/frond strip bent under its own weight: lies along +x, droops toward its tip.
function frondGeo(len, width, droop, lift, segs = 6) {
  const g = new THREE.PlaneGeometry(len, width, segs, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  const p = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / len;
    p.setY(i, lift * t * len - droop * t * t * len);
    nrm.setXYZ(i, 0.25 * (1 - t), 1, 0);
  }
  g.computeBoundingBox();
  return g;
}

function buildPalm(seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = 8 + rnd() * 6, lean = 0.12 + rnd() * 0.3, az = rnd() * 6.28;
  const P = (t) => new THREE.Vector3(Math.cos(az) * lean * height * t * t, height * t, Math.sin(az) * lean * height * t * t);
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = P(i / N), b = P((i + 1) / N);
    if (i === 0) a.y -= 0.6;
    wood.push(branchGeo(a, b, 0.3 - 0.1 * (i / N) + (i === 0 ? 0.08 : 0), 0.29 - 0.1 * ((i + 1) / N), 8));
  }
  const top = P(1);
  for (let k = 0; k < 4; k++) { // coconuts
    const s = new THREE.SphereGeometry(0.16, 6, 5); const a = rnd() * 6.28;
    s.translate(top.x + Math.cos(a) * 0.3, top.y - 0.35, top.z + Math.sin(a) * 0.3); wood.push(s.toNonIndexed());
  }
  const nF = 12 + Math.floor(rnd() * 4);
  for (let i = 0; i < nF; i++) {
    const g = frondGeo(3.6 + rnd() * 1.8, 1.25 + rnd() * 0.3, 0.55 + rnd() * 0.35, 0.35 - (i % 3) * 0.15);
    g.rotateY((i / nF) * Math.PI * 2 + rnd() * 0.4);
    g.translate(top.x, top.y, top.z);
    leaves.push(g);
  }
  const woodG = setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), (x, y) => (y / height) ** 2 * 0.7);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y, z) => 0.7 + Math.hypot(x - top.x, z - top.z) * 0.12), true);
  return { wood: woodG, leaves: leafG, height: height + 1.5, radius: 4.5 };
}

function buildJungleTree(seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [], vines = [];
  const height = 17 + rnd() * 9;
  // buttress roots flaring out of the forest floor
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.4, L = 1.8 + rnd() * 1.4;
    const fin = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * L, -0.3, Math.sin(a) * L), new THREE.Vector3(0, 2.6 + rnd() * 1.6, 0),
      new THREE.Vector3(0, 2.6 + rnd() * 1.6, 0), new THREE.Vector3(Math.cos(a) * L, -0.3, Math.sin(a) * L), new THREE.Vector3(0, 0, 0)]);
    fin.computeVertexNormals();
    fin.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0], 2));
    wood.push(fin);
  }
  const trunkTop = new THREE.Vector3((rnd() - 0.5) * 0.8, height * 0.6, (rnd() - 0.5) * 0.8);
  wood.push(branchGeo(new THREE.Vector3(0, -0.5, 0), trunkTop, 0.62 + rnd() * 0.15, 0.4, 10));
  const crownY = height * 0.72;
  const tips = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.6, L = 4 + rnd() * 3;
    const end = trunkTop.clone().add(new THREE.Vector3(Math.cos(a) * L, 1.5 + rnd() * 2.5, Math.sin(a) * L));
    wood.push(branchGeo(trunkTop, end, 0.3, 0.12, 6));
    tips.push(end);
    for (let k = 0; k < 3; k++) { // hanging lianas
      const g = new THREE.PlaneGeometry(0.5, 3 + rnd() * 6); g.translate(0, -(g.parameters.height / 2), 0);
      g.rotateY(rnd() * Math.PI); const at = trunkTop.clone().lerp(end, 0.4 + rnd() * 0.6);
      g.translate(at.x, at.y, at.z); vines.push(g);
    }
  }
  const canopyC = new THREE.Vector3(0, crownY - 2, 0);
  // a broad, flattened umbrella crown in two layers
  for (const t of tips) for (let k = 0; k < 9; k++) {
    const c = t.clone().add(new THREE.Vector3((rnd() - 0.5) * 5, (rnd() - 0.45) * 3.2, (rnd() - 0.5) * 5));
    leaves.push(cardGeo(4.2 + rnd() * 1.6, c, canopyC, rnd, 0.75, 0.9));
  }
  for (let k = 0; k < 22; k++) {
    const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * 6.5;
    leaves.push(cardGeo(4.6, new THREE.Vector3(Math.cos(a) * rr, crownY + (rnd() - 0.3) * 3.5, Math.sin(a) * rr), canopyC, rnd, 0.75, 0.9));
  }
  const woodG = setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), (x, y) => Math.max(0, y - 4) / height * 0.4);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y) => Math.max(0, y - 4) / height));
  const vineG = setSway(mergeGeometries(vines), () => 0.8);
  return { wood: woodG, leaves: leafG, moss: vineG, height: height + 2, radius: 7 };
}

function buildCactus(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const ribbed = (r, h) => {
    const g = new THREE.CylinderGeometry(r, r * 1.05, h, 20, 6, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.09 * Math.cos(a * 10);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    const cap = new THREE.SphereGeometry(r * 1.02, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, h / 2, 0);
    return mergeGeometries([g.toNonIndexed(), cap.toNonIndexed()]);
  };
  const height = 4 + rnd() * 4, R = 0.3 + rnd() * 0.12;
  const trunk = ribbed(R, height); trunk.translate(0, height / 2 - 0.3, 0); parts.push(trunk);
  const arms = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < arms; i++) {
    const a = rnd() * 6.28, y0 = height * (0.35 + rnd() * 0.3), out = 0.7 + rnd() * 0.5, up = 1.2 + rnd() * 1.8;
    const elbow = new THREE.CylinderGeometry(R * 0.7, R * 0.7, out, 14); elbow.rotateZ(Math.PI / 2); elbow.translate(out / 2, 0, 0);
    elbow.rotateY(a); elbow.translate(0, y0, 0); parts.push(elbow.toNonIndexed());
    const arm = ribbed(R * 0.7, up); arm.translate(Math.cos(a) * out, y0 + up / 2, -Math.sin(a) * out); parts.push(arm);
  }
  const g = mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q));
  // rib shading and a paler crown in vertex colour
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const rib = 0.75 + 0.25 * Math.abs(Math.cos(Math.atan2(n.getZ(i), n.getX(i)) * 10));
    const v = rib * (0.8 + 0.25 * Math.min(1, p.getY(i) / height));
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { wood: setSway(g, () => 0), height: height + 0.5, radius: 1.5 };
}

function buildLog(seed) {
  const rnd = mulberry32(seed);
  const L = 5 + rnd() * 8, r = 0.28 + rnd() * 0.22;
  const parts = [branchGeo(new THREE.Vector3(-L / 2, r * 0.7, 0), new THREE.Vector3(L / 2, r * 0.6, 0), r, r * 0.8, 9)];
  for (let i = 0; i < 4; i++) { // snapped branch stubs
    const x = (rnd() - 0.5) * L * 0.8, a = rnd() * 6.28;
    parts.push(branchGeo(new THREE.Vector3(x, r, 0), new THREE.Vector3(x + 0.3, r + Math.cos(a) * 0.9, Math.sin(a) * 0.9), 0.07, 0.03, 4));
  }
  return setSway(mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g)), () => 0);
}

// ---- foliage textures for the new biomes
function cardCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), mulberry32(w * 7 + h));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// palm frond along +x: a rib with long leaflets angling toward the tip
const palmFrondTexture = () => cardCanvas(512, 128, (g, r) => {
  for (let x = 10; x < 500; x += 7) {
    const t = x / 512, L = 52 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 8;
    for (const s of [-1, 1]) {
      const v = 0.75 + r() * 0.35;
      g.strokeStyle = `rgb(${Math.round(78 * v)},${Math.round(118 * v)},${Math.round(44 * v)})`;
      g.lineWidth = 3.2 * (1 - t * 0.5);
      g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + L * 0.25, 64 + s * L * 0.6, x + L * 0.6, 64 + s * L); g.stroke();
    }
  }
  g.strokeStyle = '#8a8a4a'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 64); g.lineTo(512, 64); g.stroke();
});
// fern frond along +x
const fernTexture = () => cardCanvas(256, 128, (g, r) => {
  for (let x = 6; x < 250; x += 9) {
    const t = x / 256, L = 46 * (1 - t) * Math.min(1, t * 6) + 4;
    for (const s of [-1, 1]) {
      g.fillStyle = `rgb(${60 + r() * 20},${100 + r() * 30},${36 + r() * 10})`;
      g.beginPath(); g.ellipse(x + 4, 64 + s * L * 0.5, 3.5, L * 0.5, s * 0.5, 0, 7); g.fill();
    }
  }
  g.strokeStyle = '#4a5a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
});
// big heart-shaped jungle leaves
const bigLeafTexture = () => cardCanvas(256, 256, (g, r) => {
  g.fillStyle = '#3d6a26';
  g.beginPath(); g.moveTo(128, 20);
  g.bezierCurveTo(250, 40, 236, 200, 128, 246); g.bezierCurveTo(20, 200, 6, 40, 128, 20); g.fill();
  const gr = g.createRadialGradient(128, 140, 10, 128, 140, 130);
  gr.addColorStop(0, 'rgba(120,160,70,0.35)'); gr.addColorStop(1, 'rgba(20,40,10,0.35)');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(160,190,110,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 24); g.lineTo(128, 240); g.stroke();
  g.lineWidth = 1.5;
  for (let y = 50; y < 230; y += 22) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + s * 50, y + 10, 128 + s * 95, y + 34); g.stroke(); }
});
// dry desert / alpine scrub twigs
const twigTexture = () => cardCanvas(256, 256, (g, r) => {
  const branch = (x, y, a, L, w, d) => {
    const x2 = x + Math.cos(a) * L, y2 = y - Math.sin(a) * L;
    g.strokeStyle = `rgb(${110 + r() * 30},${92 + r() * 20},${70 + r() * 15})`; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    if (d > 0) for (let k = 0; k < 2 + (r() < 0.5); k++) branch(x2, y2, a + (r() - 0.5) * 1.3, L * (0.6 + r() * 0.2), w * 0.65, d - 1);
    else { g.fillStyle = `rgba(${150 + r() * 40},${140 + r() * 30},${90},0.8)`; g.fillRect(x2 - 2, y2 - 2, 4, 4); }
  };
  for (let i = 0; i < 7; i++) branch(128 + (r() - 0.5) * 40, 256, Math.PI / 2 + (r() - 0.5) * 1.2, 50 + r() * 30, 4, 4);
});

function buildCypress(seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = 12 + rnd() * 6;
  // buttressed base (lathe)
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.35 + 1.4 * Math.pow(1 - Math.min(1, t * 3), 2.5), t * height * 0.75 - 0.8));
  }
  const lathe = new THREE.LatheGeometry(pts, 10);
  wood.push(lathe);
  const top = new THREE.Vector3(0, height * 0.72, 0);
  const canopyC = new THREE.Vector3(0, height * 0.82, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd();
    const end = top.clone().add(new THREE.Vector3(Math.cos(a) * (3 + rnd() * 2), 1 + rnd() * 2, Math.sin(a) * (3 + rnd() * 2)));
    wood.push(branchGeo(top.clone().setY(top.y - 2 * rnd()), end, 0.18, 0.06, 5));
    for (let k = 0; k < 4; k++) {
      const c = end.clone().add(new THREE.Vector3((rnd() - 0.5) * 2.5, (rnd() - 0.2) * 0.8, (rnd() - 0.5) * 2.5));
      leaves.push(cardGeo(2.6 + rnd(), c, canopyC, rnd, 0.6, 0.8));
    }
  }
  const woodG = setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), (x, y) => Math.max(0, y - 3) / height * 0.4);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y) => Math.max(0, y - 3) / height));
  // moss strands as separate leaf geometry appended
  const moss = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = 1 + rnd() * 3.5;
    const g = new THREE.PlaneGeometry(0.7, 2.2 + rnd() * 1.5);
    g.translate(0, -1.1, 0);
    g.rotateY(rnd() * Math.PI);
    g.translate(Math.cos(a) * r, height * 0.75 + rnd() * 1.5, Math.sin(a) * r);
    moss.push(g);
  }
  const mossG = setSway(mergeGeometries(moss), () => 0.9);
  return { wood: woodG, leaves: leafG, moss: mossG, height, radius: 5 };
}

function mossTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(42);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(${120 + r() * 30},${130 + r() * 25},${100 + r() * 20},${0.5 + r() * 0.5})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * 64;
    g.beginPath(); g.moveTo(x, 0);
    g.quadraticCurveTo(x + (r() - 0.5) * 20, 128, x + (r() - 0.5) * 16, 60 + r() * 196); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------------- scatter layer
class ScatterLayer {
  constructor(scene, variants, capacity, radius) {
    this.items = []; // {x,y,z,ry,s,v}
    this.radius = radius;
    this.variants = variants; // [{meshes:[...]}]
    this.capacity = capacity;
    this.meshes = variants.map((v) => v.parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.count = 0;
      m.castShadow = p.castShadow !== false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (p.depth) m.customDepthMaterial = p.depth;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    }));
    this.grid = new Map();
    this.cell = 64;
    this.last = new THREE.Vector3(1e9, 0, 0);
  }
  add(x, y, z, ry, s, v) {
    const it = { x, y, z, ry, s, v };
    this.items.push(it);
    const k = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(it);
  }
  update(pos, force = false) {
    if (!force && pos.distanceToSquared(this.last) < 64) return;
    this.last.copy(pos);
    const R = this.radius, R2 = R * R;
    const counts = this.variants.map(() => 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c0x = Math.floor((pos.x - R) / this.cell), c1x = Math.floor((pos.x + R) / this.cell);
    const c0z = Math.floor((pos.z - R) / this.cell), c1z = Math.floor((pos.z + R) / this.cell);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const list = this.grid.get(cx + ',' + cz);
      if (!list) continue;
      for (const it of list) {
        const dx = it.x - pos.x, dz = it.z - pos.z;
        if (dx * dx + dz * dz > R2) continue;
        const v = it.v;
        if (counts[v] >= this.capacity) continue;
        q.setFromAxisAngle(up, it.ry);
        m.compose(p.set(it.x, it.y, it.z), q, sc.setScalar(it.s));
        for (const mesh of this.meshes[v]) mesh.setMatrixAt(counts[v], m);
        counts[v]++;
      }
    }
    this.meshes.forEach((parts, v) => parts.forEach((mesh) => {
      mesh.count = counts[v];
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, counts[v] * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }));
  }
}

// ---------------------------------------------------------------------------- impostors
function renderImpostorAtlas(renderer, builds, cols) {
  const size = 256;
  const rt = new THREE.WebGLRenderTarget(size * cols, size * 2, { samples: 4 });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2.4); dl.position.set(0.3, 1, 1); scene.add(dl);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const prevTarget = renderer.getRenderTarget();
  const prevViewport = renderer.getViewport(new THREE.Vector4());
  const prevClear = renderer.getClearColor(new THREE.Color()); const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const prevAuto = renderer.autoClear; renderer.autoClear = false;
  builds.forEach((b, i) => {
    for (let row = 0; row < 2; row++) {
      const grp = new THREE.Group();
      for (const part of b.parts) {
        const src = part.material;
        const mm = new THREE.MeshBasicMaterial({ map: src.map, color: src.color, alphaTest: src.alphaTest || 0, side: THREE.DoubleSide, vertexColors: !!src.vertexColors && !!part.geometry.attributes.color });
        const mesh = new THREE.Mesh(part.geometry, mm);
        grp.add(mesh);
      }
      grp.rotation.y = row * Math.PI / 2;
      scene.add(grp);
      const h = b.height * 1.08, w = h;
      cam.left = -w / 2; cam.right = w / 2; cam.top = h - 0.5; cam.bottom = -0.5;
      cam.position.set(0, h / 2, 50); cam.lookAt(0, h / 2, 0); cam.updateProjectionMatrix();
      rt.viewport.set(i * size, row * size, size, size);
      rt.scissor.set(i * size, row * size, size, size);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      scene.remove(grp);
    }
  });
  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(prevTarget);
  renderer.setViewport(prevViewport);
  renderer.setClearColor(prevClear, prevAlpha);
  return rt;
}

// ---------------------------------------------------------------------------- grass
// Clump cards: two crossed alpha quads per instance, each carrying ~30 painted blades.
function grassClumpTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const r = mulberry32(77);
  for (let i = 0; i < 70; i++) {
    const x0 = 30 + r() * 452;
    const h = 220 + r() * 280;
    const lean = (r() - 0.5) * 140;
    const w = 3 + r() * 4;
    const dry = r() < 0.3;
    const gr = g.createLinearGradient(0, 512, 0, 512 - h);
    if (dry) { gr.addColorStop(0, '#4a4826'); gr.addColorStop(0.5, '#a09058'); gr.addColorStop(1, '#c8b880'); }
    else { gr.addColorStop(0, '#34441e'); gr.addColorStop(0.5, '#7e9046'); gr.addColorStop(1, '#b8c07a'); }
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x0 - w, 512);
    g.quadraticCurveTo(x0 - w * 0.6 + lean * 0.3, 512 - h * 0.6, x0 + lean, 512 - h);
    g.quadraticCurveTo(x0 + w * 0.6 + lean * 0.3, 512 - h * 0.6, x0 + w, 512);
    g.fill();
    if (r() < 0.12) { // seed head
      g.fillStyle = dry ? '#e8dcac' : '#c8c088';
      for (let k = 0; k < 9; k++) { g.beginPath(); g.ellipse(x0 + lean + (r() - 0.5) * 10, 512 - h + k * 7, 2.5, 6, lean * 0.004, 0, 7); g.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}
let CLUMP_TEX = null;

function clumpGeometry() {
  const pos = [], uv = [], idx = [];
  const rows = 3;
  for (let q = 0; q < 2; q++) {
    const base = pos.length / 3;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= 1; i++) {
      const x = i - 0.5, y = j / rows;
      if (q === 0) pos.push(x, y, 0); else pos.push(0, y, x);
      uv.push(i, y);
    }
    for (let j = 0; j < rows; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// Forest-floor clutter tiled around the camera like the grass: pine cones, fallen twigs, stones.
// mode 'litter' keeps to forest floors; 'stone' also scatters along trails and in the desert.
function makeClutter(scene, geo, { spacing, radius, smin, smax, color, roughness = 0.9, mode = 'litter', flat = false, seed = 1 }) {
  const tile = radius * 2, n = Math.floor(tile / spacing);
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index; g.attributes = geo.attributes;
  const off = new Float32Array(n * n * 4), r = mulberry32(seed);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { off[k++] = (i + r()) * spacing - radius; off[k++] = (j + r()) * spacing - radius; off[k++] = r(); off[k++] = r(); }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = n * n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, vertexColors: !!geo.attributes.color });
  patchMaterial(mat, {
    sunShadow: true,
    vertexHead: /* glsl */ `
      attribute vec4 aOff;
      #define TILE ${tile.toFixed(2)}
      #define RADIUS ${radius.toFixed(2)}
      mat3 cRot;
    `,
    beginNormal: /* glsl */ `
      vec2 cam = cameraPosition.xz;
      vec2 xz = aOff.xy + floor((cam - aOff.xy) / TILE + 0.5) * TILE;
      float ang = aOff.z * 6.2832;
      float ca = cos(ang), sa = sin(ang);
      float tilt = ${flat ? '0.0' : '(aOff.w - 0.5) * 0.6'};
      cRot = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca) * mat3(1.0, 0.0, 0.0, 0.0, cos(tilt), sin(tilt), 0.0, -sin(tilt), cos(tilt));
      vec3 objectNormal = cRot * normal;
    `,
    vertexBody: /* glsl */ `
      vec4 sp = splatAt(xz);
      vec4 cl = climateAt(xz);
      float dist = length(xz - cam);
      float dens = ${mode === 'stone'
        ? 'max(sp.b * 0.8, max(smoothstep(0.3, 0.8, sp.r) * 0.7, cl.a * 0.5)) * (1.0 - smoothstep(0.4, 0.7, sp.a))'
        : 'smoothstep(0.25, 0.6, sp.b) * (1.0 - smoothstep(0.2, 0.5, sp.r)) * (1.0 - cl.a)'};
      dens *= (1.0 - smoothstep(0.3, 0.6, cl.r)) * smoothstep(0.6, 1.5, heightAt(xz)) * smoothstep(RADIUS, RADIUS * 0.75, dist);
      float keep = step(aOff.w, dens);
      float sc = mix(${smin.toFixed(3)}, ${smax.toFixed(3)}, fract(aOff.z * 13.7 + aOff.w * 7.1)) * keep;
      vec3 transformed = cRot * position * sc;
      transformed.xz += xz;
      transformed.y += heightAt(xz) - 0.02;
    `,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function makeGrass(scene, spacing, radius, size, innerCut) {
  const tile = radius * 2;
  const n = Math.floor(tile / spacing);
  const g = clumpGeometry();
  const off = new Float32Array(n * n * 4);
  const r = mulberry32(Math.floor(spacing * 1000));
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    off[k++] = (i + r()) * spacing - radius;
    off[k++] = (j + r()) * spacing - radius;
    off[k++] = r(); off[k++] = r();
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = n * n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  CLUMP_TEX = CLUMP_TEX || grassClumpTexture();
  const mat = new THREE.MeshStandardMaterial({ map: CLUMP_TEX, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.45 });
  patchMaterial(mat, {
    noFlip: true,
    sunShadow: true,
    vertexHead: /* glsl */ `
      attribute vec4 aOff;
      varying vec3 vGCol;
      varying float vGY;
      varying float vGFar;
      varying float vGDry;
      #define TILE ${tile.toFixed(2)}
      #define RADIUS ${radius.toFixed(2)}
      #define INNER ${innerCut.toFixed(2)}
      #define CSIZE ${size.toFixed(3)}
      #define RANCH_XZ vec2(${RANCH.x.toFixed(1)}, ${RANCH.z.toFixed(1)})
      vec3 srgbV(vec3 c){ return pow(c/255.0, vec3(2.2)); }
    `,
    vertexBody: /* glsl */ `
      vec2 cam = cameraPosition.xz;
      vec2 xz = aOff.xy + floor((cam - aOff.xy) / TILE + 0.5) * TILE;
      float dist = length(xz - cam);
      float fade = smoothstep(RADIUS, RADIUS*0.72, dist) * smoothstep(INNER*0.8, INNER, dist);
      vec4 sp = splatAt(xz);
      float h0 = heightAt(xz);
      vec3 nrm = normalAt(xz);
      float slope = 1.0 - nrm.y;
      float edgeN = (vnoise(xz * 0.9) - 0.5) * 0.35 + (vnoise(xz * 3.1) - 0.5) * 0.12;
      float dens = (1.0 - smoothstep(0.2, 0.45, sp.r + edgeN)) * (1.0 - smoothstep(0.38, 0.7, sp.a + edgeN * 0.6));
      dens *= smoothstep(0.15, 0.9, h0) * (1.0 - smoothstep(0.3, 0.5, slope));
      dens *= 1.0 - smoothstep(700.0, 860.0, h0);
      dens *= 1.0 - 0.85*smoothstep(0.3, 0.8, sp.b);
      vec4 gcl = climateAt(xz);
      float snowG = smoothstep(0.3, 0.65, gcl.r);
      dens *= 1.0 - snowG;          // buried under snow
      dens *= 1.0 - 0.72 * gcl.a;   // desert: sparse bunch grass
      dens *= 1.0 - 0.55 * gcl.g * smoothstep(0.2, 0.6, sp.b); // jungle floor is litter and big leaves, not lawn
      float field = fbm2(xz/26.0);
      dens *= smoothstep(0.02, 0.28, field + 0.12);
      float alive = smoothstep(aOff.z - 0.02, aOff.z + 0.25, dens); // soft, ragged edges at roads/yards
      float macro = fbm2(xz/380.0);
      float dry = smoothstep(0.42, 0.68, macro + 0.15*fbm2(xz/11.0 + 3.0));
      float hgt = mix(0.18, 0.66, smoothstep(0.25, 0.8, field)) * (0.55 + 0.7*aOff.w) * (0.85 + 0.35*dry) * (0.7 + 0.6 * fbm2(xz / 9.0));
      hgt *= mix(0.42, 1.0, smoothstep(55.0, 110.0, length(xz - RANCH_XZ))); // grazed ranch pasture
      hgt *= (1.0 + 0.55 * gcl.g) * (1.0 - 0.3 * snowG);
      hgt *= alive * fade;
      float ang = aOff.z * 37.0 + aOff.w * 11.0;
      float ca = cos(ang), sa = sin(ang);
      vec2 local = vec2(position.x*ca - position.z*sa, position.x*sa + position.z*ca) * CSIZE * (0.8 + 0.4*aOff.w);
      float y = position.y;
      float gust = fbm2(xz*0.035 - uWind*uTime*0.6);
      float wv = sin(uTime*2.2 + dot(xz, vec2(0.21, 0.17)) + aOff.z*3.0) * 0.22 + gust * 1.2;
      vec2 lean = normalize(uWind) * wv * uWindStrength * 0.5;
      vec2 dp = xz - uPlayerPos.xz;
      float pd = length(dp);
      lean += (dp / max(pd, 0.01)) * smoothstep(1.6, 0.2, pd) * 1.2;
      float bend = y*y;
      vec3 transformed;
      transformed.xz = xz + local * (hgt > 0.0 ? 1.0 : 0.0) + lean * bend * hgt;
      transformed.y = h0 + y * hgt * (1.0 - 0.25*min(length(lean),1.0)*bend) - 0.02;
      vec3 lush = mix(srgbV(vec3(150,170,110)), srgbV(vec3(190,196,130)), aOff.w);
      vec3 dryc = mix(srgbV(vec3(235,205,140)), srgbV(vec3(210,190,130)), aOff.z);
      float midV = fbm2(xz / 34.0 + 9.0);
      float dryPatch = smoothstep(0.5, 0.72, fbm2(xz / 58.0 - 4.0));
      // brighter than the ground's own albedo: the clumps lose a lot to self-occlusion and GTAO
      vGCol = mix(lush, dryc, max(dry, dryPatch * 0.85)) * 1.45 * (0.68 + 0.62 * midV);
      vGCol = mix(vGCol, vGCol * vec3(1.08, 0.98, 0.78), smoothstep(0.6, 0.8, fbm2(xz / 18.0)) * 0.5);
      vGCol = mix(vGCol, mix(srgbV(vec3(240,196,110)), srgbV(vec3(222,160,86)), aOff.z) * 1.35, gcl.b * 0.85); // autumn gold
      vGCol = mix(vGCol, mix(srgbV(vec3(120,165,80)), srgbV(vec3(100,150,70)), aOff.w) * 1.2, gcl.g);           // jungle
      vGCol = mix(vGCol, srgbV(vec3(232,214,168)) * 1.3, gcl.a);                                                 // desert straw
      vGCol = mix(vGCol, mix(srgbV(vec3(112,140,66)), srgbV(vec3(138,156,80)), aOff.w) * 1.25 * (0.75 + 0.5 * midV), smoothstep(-700.0, -1250.0, xz.y) * (1.0 - gcl.r) * 0.85); // shaded pine-belt grass stays green
      vGCol = mix(vGCol, srgbV(vec3(236,236,232)) * 1.4, snowG * 0.75);                                          // frosted
      vGY = y;
      vGFar = smoothstep(9.0, 48.0, dist);
      vGDry = max(gcl.a, gcl.b * 0.6);
    `,
    beginNormal: /* glsl */ `
      vec3 objectNormal = vec3(0.0, 1.0, 0.0);
    `,
    fragHead: 'varying vec3 vGCol; varying float vGY; varying float vGFar; varying float vGDry;',
    fragColor: /* glsl */ `
      #include <color_fragment>
      // sun-cured blades: the green texture goes to straw in the desert and autumn
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(1.35, 1.1, 0.7), vGDry);
      // past ~10 m the dark blade roots average into mottled "lettuce"; settle toward the
      // clump's mean colour so the field reads as one soft sward, like the terrain under it
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.28, 0.07), vGFar * 0.6);
      diffuseColor.rgb *= vGCol;
      diffuseColor.rgb *= mix(mix(0.78, 1.0, smoothstep(0.0, 0.5, vGY)), 1.0, vGFar * 0.7); // root occlusion
      // keep thin blades from dissolving in lower mips (alpha-test coverage preservation)
      float mipL = max(0.0, log2(max(fwidth(vMapUv.x), fwidth(vMapUv.y)) * 512.0));
      diffuseColor.a = clamp(diffuseColor.a * (1.0 + mipL * 0.45), 0.0, 1.0);
    `,
    onShader: (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          float back = pow(max(dot(vdir, normalize(uSunDir)), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * gSunVis * back * 0.5 * vGY;
        }`);
    },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------- rocks
function rockGeometry(seed) {
  const n = new Simplex2(seed);
  // welded so the boulder gets smooth normals instead of a faceted, low-poly look
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 5).deleteAttribute('uv').deleteAttribute('normal'));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = 1 + (seed % 3) * 0.3, sz = 0.8 + (seed % 5) * 0.12;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.32 * n.fbm(v.x * 1.4 + seed, v.y * 1.4 + v.z, 4) + 0.12 * n.noise(v.x * 5, v.z * 5 + v.y * 3);
    v.multiplyScalar(d);
    // facet/strata flattening
    v.y = Math.round(v.y * 6) / 6 * 0.12 + v.y * 0.88;
    v.x *= sx; v.z *= sz;
    if (v.y < -0.2) v.y = -0.2 - (v.y + 0.2) * 0.2;
    p.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function rockMaterial(surf = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  return patchMaterial(m, {
    fragHead: 'uniform sampler2D tRockA; vec3 srgbR(vec3 c){ return pow(c/255.0, vec3(2.2)); }',
    onShader: (sh) => { sh.uniforms.tRockA = { value: surf.rock || null }; },
    fragColor: /* glsl */ `
      #include <color_fragment>
      // smooth world normal: snow and moss follow the rounded form, not individual triangles
      vec3 wn = normalize(inverseTransformDirection(normalize(vNormal), viewMatrix));
      float n1 = fbm2(vWPos.xz*0.8 + vWPos.y*0.6);
      float n2 = vnoise(vec2(vWPos.x+vWPos.z, vWPos.y)*3.0);
      vec3 base = mix(srgbR(vec3(118,112,104)), srgbR(vec3(92,86,80)), n1);
      base = mix(base, srgbR(vec3(130,112,90)), smoothstep(0.6, 0.8, vnoise(vec2(vWPos.y*1.5, vWPos.x*0.2))) * 0.6);
      {
        vec3 w = pow(abs(wn), vec3(4.0)); w /= (w.x + w.y + w.z);
        vec3 ra = texture(tRockA, vWPos.zy / 2.2).rgb * w.x + texture(tRockA, vWPos.xz / 2.2).rgb * w.y + texture(tRockA, vWPos.xy / 2.2).rgb * w.z;
        base *= clamp(dot(ra, vec3(0.2126, 0.7152, 0.0722)) / 0.13, 0.35, 2.2);
      }
      base *= 0.85 + 0.2*n2;
      vec4 rcl = climateAt(vWPos.xz);
      float moss = smoothstep(0.55, 0.85, wn.y + (n1-0.5)*0.6) * (1.0 - rcl.a) * (1.0 - rcl.r);
      base = mix(base, srgbR(vec3(74,86,40)), moss*0.85);
      base = mix(base, base * vec3(1.35, 0.85, 0.62), rcl.a);                 // desert: red sandstone
      float rsnow = smoothstep(0.35, 0.75, rcl.r) * smoothstep(0.25, 0.65, wn.y + (n1 - 0.5) * 0.5);
      base = mix(base, srgbR(vec3(228,233,240)), rsnow);                      // snow caps
      diffuseColor.rgb = base;
    `,
  });
}

// ---------------------------------------------------------------------------- main class
export class Vegetation {
  constructor(world, scene, renderer, quality = 1, surf = {}) {
    this.world = world;
    this.scene = scene;
    const barkMat = windMaterial(new THREE.MeshStandardMaterial({ map: barkTexture(5), roughness: 0.95 }), 0);
    const pineBark = windMaterial(new THREE.MeshStandardMaterial({ map: barkTexture(6, [74, 50, 36]), roughness: 0.95 }), 0);
    const leafExtra = { onShader: (s) => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', LEAF_EMISSIVE); } };
    const oakTex = [leafCardTexture(11, 82), leafCardTexture(12, 70), leafCardTexture(13, 92)];
    const pineTex = pineCardTexture(3);
    const cypTex = leafCardTexture(21, 100);
    const mossTex = mossTexture();
    const leafMat = (map, color = 0xc4ccb0, autumn = false, trans = null) => windMaterial(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color, vertexColors: true, envMapIntensity: 0.4 }), 1, leafExtra, { autumn, trans });

    this.treeBuilds = [];
    const oakMats = oakTex.map((t) => leafMat(t, 0xc4ccb0, true));
    for (let i = 0; i < 4; i++) {
      const b = buildOak(100 + i * 17);
      const lt = oakTex[i % 3];
      this.treeBuilds.push({ kind: 'oak', height: b.height, parts: [
        { geometry: b.wood, material: barkMat },
        { geometry: b.leaves, material: oakMats[i % 3], depth: windDepthMaterial(lt, 1) },
      ] });
    }
    const pineMat = leafMat(pineTex, 0xa4b294, false, 0.05);
    for (let i = 0; i < 4; i++) {
      const b = buildPine(300 + i * 23);
      this.treeBuilds.push({ kind: 'pine', height: b.height, parts: [
        { geometry: b.wood, material: pineBark },
        { geometry: b.leaves, material: pineMat, depth: windDepthMaterial(pineTex, 1) },
      ] });
    }
    const cypMat = leafMat(cypTex, 0xc8d0b0);
    const mossMat = windMaterial(new THREE.MeshStandardMaterial({ map: mossTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }), 1, leafExtra);
    for (let i = 0; i < 2; i++) {
      const b = buildCypress(500 + i * 31);
      this.treeBuilds.push({ kind: 'cypress', height: b.height, parts: [
        { geometry: b.wood, material: barkMat },
        { geometry: b.leaves, material: cypMat, depth: windDepthMaterial(cypTex, 1) },
        { geometry: b.moss, material: mossMat, castShadow: false },
      ] });
    }
    // world v2 biomes: forest giants, snow firs, palms, jungle canopy trees, saguaro
    const G = (this.groups = { oak: [0, 1, 2, 3], pine: [4, 5, 6, 7], cypress: [8, 9], tall: [], fir: [], palm: [], jungle: [], cactus: [] });
    const addB = (group, kind, b, parts) => { G[group].push(this.treeBuilds.length); this.treeBuilds.push({ kind, height: b.height, parts }); };
    for (let i = 0; i < 3; i++) {
      const b = buildPine(700 + i * 29, 'tall');
      addB('tall', 'pine', b, [{ geometry: b.wood, material: pineBark }, { geometry: b.leaves, material: pineMat, depth: windDepthMaterial(pineTex, 1) }]);
    }
    for (let i = 0; i < 2; i++) {
      const b = buildPine(760 + i * 31, 'fir');
      addB('fir', 'pine', b, [{ geometry: b.wood, material: pineBark }, { geometry: b.leaves, material: pineMat, depth: windDepthMaterial(pineTex, 1) }]);
    }
    const frondTex = palmFrondTexture();
    const palmMat = leafMat(frondTex, 0xd2dcb4);
    const palmBark = windMaterial(new THREE.MeshStandardMaterial({ map: barkTexture(9, [118, 100, 78]), roughness: 0.95 }), 0);
    for (let i = 0; i < 2; i++) {
      const b = buildPalm(800 + i * 37);
      addB('palm', 'palm', b, [{ geometry: b.wood, material: palmBark }, { geometry: b.leaves, material: palmMat, depth: windDepthMaterial(frondTex, 1) }]);
    }
    const jungleLeaf = leafMat(oakTex[1], 0x9cb488);
    const vineMat = windMaterial(new THREE.MeshStandardMaterial({ map: mossTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, color: 0x6a8a48 }), 1, leafExtra);
    for (let i = 0; i < 2; i++) {
      const b = buildJungleTree(840 + i * 41);
      addB('jungle', 'jungle', b, [{ geometry: b.wood, material: barkMat }, { geometry: b.leaves, material: jungleLeaf, depth: windDepthMaterial(oakTex[1], 1) }, { geometry: b.moss, material: vineMat, castShadow: false }]);
    }
    const cactusMat = windMaterial(new THREE.MeshStandardMaterial({ color: 0x6f8a52, roughness: 0.62, vertexColors: true }), 0);
    for (let i = 0; i < 2; i++) {
      const b = buildCactus(880 + i * 43);
      addB('cactus', 'cactus', b, [{ geometry: b.wood, material: cactusMat }]);
    }
    this.nearRadius = 190 * Math.sqrt(quality);
    this.trees = new ScatterLayer(scene, this.treeBuilds, 2600, this.nearRadius);

    // bushes / ferns
    const bushBuilds = [];
    for (let i = 0; i < 3; i++) {
      const rnd = mulberry32(900 + i);
      const cards = [];
      const c = new THREE.Vector3(0, 0.5, 0);
      for (let k = 0; k < 7; k++) cards.push(cardGeo(1.3 + rnd() * 0.6, new THREE.Vector3((rnd() - 0.5) * 1.2, 0.45 + rnd() * 0.5, (rnd() - 0.5) * 1.2), c, rnd, 1, 0.9));
      const g = leafAO(setSway(mergeGeometries(cards), (x, y) => y * 0.25));
      bushBuilds.push({ parts: [{ geometry: g, material: oakMats[i % 3], depth: windDepthMaterial(oakTex[i % 3], 1) }] });
    }
    // ferns (3, 4), big-leaf jungle plants (5, 6), dry scrub (7, 8)
    const fernT = fernTexture(), fernMat = leafMat(fernT, 0xc8d4ae);
    for (let i = 0; i < 2; i++) {
      const rnd = mulberry32(950 + i), fr = [];
      const n = 9 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) { const g = frondGeo(1.4 + rnd() * 0.8, 0.5, 1.05, 0.95); g.rotateY((k / n) * 6.28 + rnd() * 0.3); g.translate(0, 0.05, 0); fr.push(g); }
      bushBuilds.push({ parts: [{ geometry: leafAO(setSway(mergeGeometries(fr), (x, y, z) => Math.hypot(x, z) * 0.4), true), material: fernMat, castShadow: false }] });
    }
    const bigT = bigLeafTexture(), bigMat = leafMat(bigT, 0xd0dcc0);
    for (let i = 0; i < 2; i++) {
      const rnd = mulberry32(970 + i), lv = [];
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28, r0 = 0.2 + rnd() * 0.6, sz = 0.8 + rnd() * 0.7;
        const g = new THREE.PlaneGeometry(sz, sz); g.rotateX(-0.6 - rnd() * 0.6); g.translate(0, sz * 0.4, r0); g.rotateY(a); g.translate(0, 0.3 + rnd() * 0.9, 0);
        lv.push(g);
      }
      bushBuilds.push({ parts: [{ geometry: leafAO(setSway(mergeGeometries(lv), (x, y) => y * 0.3)), material: bigMat, depth: windDepthMaterial(bigT, 1) }] });
    }
    const twigT = twigTexture();
    const twigMat = windMaterial(new THREE.MeshStandardMaterial({ map: twigT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true, envMapIntensity: 0.4 }), 1, leafExtra, { frost: true });
    for (let i = 0; i < 2; i++) {
      const rnd = mulberry32(990 + i), tw = [];
      for (let k = 0; k < 5; k++) { const g = new THREE.PlaneGeometry(1.1 + rnd() * 0.5, 1.0 + rnd() * 0.4); g.translate(0, 0.45, 0); g.rotateY((k / 5) * Math.PI + rnd() * 0.4); tw.push(g); }
      // vertex colours: lighter toward the tips (the material reads them; without them the brush renders black)
      const tg = setSway(mergeGeometries(tw), (x, y) => y * 0.2), tp = tg.attributes.position, tc = new Float32Array(tp.count * 3);
      for (let k = 0; k < tp.count; k++) tc[k * 3] = tc[k * 3 + 1] = tc[k * 3 + 2] = 0.7 + 0.3 * Math.min(1, tp.getY(k) / 0.95);
      tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      bushBuilds.push({ parts: [{ geometry: tg, material: twigMat, castShadow: false }] });
    }
    this.bushes = new ScatterLayer(scene, bushBuilds, 6000, 140 * Math.sqrt(quality));
    // fallen logs on forest floors
    const logBuilds = [0, 1, 2].map((i) => ({ parts: [{ geometry: buildLog(1100 + i * 13), material: pineBark }] }));
    this.logs = new ScatterLayer(scene, logBuilds, 1200, 170 * Math.sqrt(quality));

    // rocks
    const rMat = rockMaterial(surf);
    const rockBuilds = [0, 1, 2, 3].map((i) => ({ parts: [{ geometry: rockGeometry(i + 3), material: rMat }] }));
    this.rocks = new ScatterLayer(scene, rockBuilds, 3000, 420);

    this.scatter();
    this.dressHomesteads();

    // impostors for every tree
    this.atlas = renderImpostorAtlas(renderer, this.treeBuilds, this.treeBuilds.length);
    this.buildImpostors(scene);

    // grass
    this.grass = [];
    if (quality > 0) {
      const q = quality;
      this.grass.push(makeGrass(scene, 0.3 / Math.sqrt(q), 28, 0.6, 0));
      this.grass.push(makeGrass(scene, 0.7 / Math.sqrt(q), 85, 1.2, 24));
      // forest-floor clutter
      const cone = (() => {
        const c = new THREE.ConeGeometry(0.045, 0.13, 7, 3); c.rotateZ(Math.PI / 2); c.translate(0, 0.035, 0);
        const p = c.attributes.position, col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const v = 0.7 + 0.3 * ((i * 7) % 5) / 4; col[i * 3] = 0.42 * v; col[i * 3 + 1] = 0.28 * v; col[i * 3 + 2] = 0.16 * v; }
        c.setAttribute('color', new THREE.BufferAttribute(col, 3)); return c;
      })();
      const twig = (() => { const t = new THREE.CylinderGeometry(0.018, 0.03, 1.0, 5); t.rotateZ(Math.PI / 2); t.translate(0, 0.02, 0); return t; })();
      const stone = (() => {
        const st = new THREE.IcosahedronGeometry(0.5, 1), p = st.attributes.position;
        for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k); }
        st.computeVertexNormals(); st.translate(0, 0.12, 0); return st;
      })();
      this.clutter = [
        makeClutter(scene, cone, { spacing: 0.9 / Math.sqrt(q), radius: 26, smin: 0.8, smax: 1.4, color: 0xffffff, seed: 3 }),
        makeClutter(scene, twig, { spacing: 1.6 / Math.sqrt(q), radius: 34, smin: 0.5, smax: 1.6, color: 0x5a4632, flat: true, seed: 5 }),
        makeClutter(scene, stone, { spacing: 2.2 / Math.sqrt(q), radius: 40, smin: 0.12, smax: 0.55, color: 0x8a8278, roughness: 0.85, mode: 'stone', seed: 9 }),
      ];
    }
  }

  scatter() {
    const w = this.world, G = this.groups;
    const r = w.rng(77);
    const cell = 9;
    const avoid = [
      [TOWN.x, TOWN.z, 165], [RANCH.x, RANCH.z, 62], [CHURCH.x, CHURCH.z, 32], [CAMP.x, CAMP.z, 28], [CABIN.x, CABIN.z, 30],
    ];
    const blocked = (x, z, pad = 0) => avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + pad);
    const pick = (list) => list[Math.floor(r() * list.length)];
    const range = HALF - 40;
    for (let z = -range; z < range; z += cell) for (let x = -range; x < range; x += cell) {
      const px = x + r() * cell, pz = z + r() * cell;
      const sp = w.splatAt(px, pz);
      const h = w.heightAt(px, pz);
      if (h < 0.4 || h > 980 || sp.road > 0.1) { r(); r(); continue; }
      const cl = w.climateAt(px, pz);
      const n = w.normalAt(px, pz);
      // boulder fields: talus and erratics gather in clusters rather than dotting the ground evenly
      const field = cl.snow > 0.3 ? THREE.MathUtils.smoothstep(w.n2.noise(px / 70 + 3.1, pz / 70 - 7.7), 0.15, 0.55) : 0;
      const boulders = ((pz < -700 ? 2.2 : 1) + cl.snow) * (1 + 7 * field);
      // firs cling to steeper ground in the mountains than broadleaf trees do lower down
      const steep = cl.snow > 0.4 ? 0.62 : 0.75;
      if (n.y < steep) { if (r() < 0.012 * boulders) { const sc = 1 + r() * 3.5; this.rocks.add(px, h - 0.3 - sc * 0.55 * (1 - n.y), pz, r() * 6.28, sc, Math.floor(r() * 4)); } continue; } // sunk into the slope, not perched on it
      if (cl.snow > 0.4 && n.y < 0.75 && !blocked(px, pz) && r() < sp.forest * 0.5) {
        this.trees.add(px, h - 0.3, pz, r() * 6.28, 0.7 + r() * 0.5, r() < 0.7 ? pick(G.fir) : pick(G.tall));
        continue;
      }
      const swamp = w.splatAt(px, pz).wet > 0.3 && px > 500 && pz > 600 && cl.jungle < 0.5;
      // desert: saguaro and scrub instead of forest
      if (cl.desert > 0.5) {
        if (blocked(px, pz)) continue;
        if (r() < 0.012 * cl.desert) this.trees.add(px, h - 0.2, pz, r() * 6.28, 0.8 + r() * 0.5, pick(G.cactus));
        else if (r() < 0.06) this.bushes.add(px, h - 0.05, pz, r() * 6.28, 0.6 + r() * 0.7, 7 + Math.floor(r() * 2));
        if (r() < 0.004) this.rocks.add(px, h - 0.25, pz, r() * 6.28, 0.5 + r() * 2.0, Math.floor(r() * 4));
        continue;
      }
      let p = sp.forest * 0.6 + 0.012;
      if (blocked(px, pz)) p = 0;
      if (r() < p) {
        let v;
        const beach = h < 7 && (cl.jungle > 0.3 || pz > 2900);
        if (beach) v = pick(G.palm);
        else if (cl.jungle > 0.45) v = r() < 0.28 ? pick(G.palm) : pick(G.jungle);
        else if (swamp) v = pick(G.cypress);
        else if (cl.snow > 0.45) v = r() < 0.75 ? pick(G.fir) : pick(G.tall);
        else if (pz < -700) v = r() < 0.6 ? pick(G.tall) : r() < 0.7 ? pick(G.pine) : pick(G.fir);
        else if (cl.autumn > 0.4) v = r() < 0.78 ? pick(G.oak) : pick(G.pine);
        else if (h > 70) v = pick(G.pine);
        else v = r() < 0.75 ? pick(G.oak) : pick(G.pine);
        if (sp.forest < 0.2 && cl.jungle < 0.4 && !swamp && cl.snow < 0.45 && pz > -700) v = pick(G.oak); // lone meadow oaks
        const s = 0.8 + r() * 0.5;
        this.trees.add(px, h - 0.2, pz, r() * 6.28, s, v);
        continue;
      }
      if (blocked(px, pz, -20)) continue;
      // ground cover by biome
      const under = 0.05 + sp.forest * 0.45;
      if (cl.jungle > 0.4) {
        if (r() < under * 2.6) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.8 + r() * 1.1, r() < 0.6 ? 5 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2));
      } else if (cl.snow > 0.5) {
        // dry alpine brush poking through the snow in clumps
        const brush = THREE.MathUtils.smoothstep(w.n.noise(px / 45 - 2.2, pz / 45 + 5.3), 0.1, 0.6);
        const nb = r() < 0.04 + 0.5 * brush ? 1 + Math.floor(r() * 3 * brush) : 0;
        for (let b = 0; b < nb; b++) {
          const bx = px + (r() - 0.5) * 5, bz = pz + (r() - 0.5) * 5;
          this.bushes.add(bx, w.heightAt(bx, bz) - 0.08, bz, r() * 6.28, 0.5 + r() * 0.7, 7 + Math.floor(r() * 2));
        }
      } else if (pz < -700) {
        if (r() < under * 1.2) this.bushes.add(px, h - 0.05, pz, r() * 6.28, 0.7 + r() * 0.7, r() < 0.85 ? 3 + Math.floor(r() * 2) : 7 + Math.floor(r() * 2));
      } else if (r() < under) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.6 + r() * 0.8, Math.floor(r() * 3));
      // saplings and young firs filling the gaps between the big trees
      if (sp.forest > 0.3 && cl.jungle < 0.4 && cl.desert < 0.3 && (pz < -700 || cl.snow > 0.4) && r() < 0.05 * sp.forest) {
        this.trees.add(px, h - 0.1, pz, r() * 6.28, 0.22 + r() * 0.3, r() < 0.6 ? pick(G.fir) : pick(G.pine));
        continue;
      }
      // fallen logs under forest
      if (sp.forest > 0.35 && cl.jungle < 0.5 && r() < 0.018 * sp.forest) this.logs.add(px, h - 0.1, pz, r() * 6.28, 0.8 + r() * 0.5, Math.floor(r() * 3));
      if (r() < (0.006 + (1 - n.y) * 0.05) * boulders) this.rocks.add(px, h - 0.25, pz, r() * 6.28, 0.4 + r() * 2.2, Math.floor(r() * 4));
    }
  }

  // hand-placed shade trees around homesteads (authored, like a set dresser would)
  dressHomesteads() {
    const w = this.world, R = RANCH;
    const spots = [[-72, -44], [-70, 18], [-4, -60], [58, -48], [64, 34], [-36, 52], [20, 56], [-92, -6]];
    spots.forEach(([dx, dz], i) => {
      const x = R.x + dx, z = R.z + dz;
      this.trees.add(x, w.heightAt(x, z) - 0.2, z, i * 1.7, 1.05 + (i % 3) * 0.15, i % 4);
    });
    // trees behind the main street buildings
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? 1 : -1;
      const x = -140 + i * 16 + (i % 3) * 3, z = side * (40 + (i % 4) * 9);
      this.trees.add(x, w.heightAt(x, z) - 0.2, z, i * 2.3, 0.9 + (i % 3) * 0.15, i % 4);
    }
  }

  buildImpostors(scene) {
    const items = this.trees.items;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(items.length * 4);
    items.forEach((it, i) => {
      a[i * 4] = it.x; a[i * 4 + 1] = it.y; a[i * 4 + 2] = it.z;
      a[i * 4 + 3] = it.v + Math.min(it.s, 3.99) / 4; // packed: variant + scale/4
    });
    g.setAttribute('aTree', new THREE.InstancedBufferAttribute(a, 4));
    const hs = new Float32Array(this.treeBuilds.length);
    this.treeBuilds.forEach((b, i) => (hs[i] = b.height * 1.08));
    g.instanceCount = items.length;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uAtlas: { value: this.atlas.texture }, uCols: { value: this.treeBuilds.length }, uHeights: { value: hs }, uNear: { value: this.nearRadius } },
      vertexShader: /* glsl */ `
        attribute vec4 aTree;
        uniform float uCols;
        uniform float uHeights[${this.treeBuilds.length}];
        uniform float uNear;
        uniform float uTime;
        varying vec2 vUv; varying vec3 vW; varying float vFade; varying float vVar; varying vec3 vBase;
        void main(){
          float variant = floor(aTree.w);
          float s = fract(aTree.w) * 4.0;
          float h = uHeights[int(variant)] * s;
          vec3 base = aTree.xyz;
          vec3 toCam = cameraPosition - base; toCam.y = 0.0;
          float d = length(toCam);
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
          vFade = smoothstep(uNear - 25.0, uNear, d);
          h *= smoothstep(1250.0, 900.0, d); // far trees sink smoothly into the canopy-tinted terrain
          vec3 p = base + right * position.x * h + vec3(0.0, (position.y * h) - 0.5 * s, 0.0);
          // gentle sway of top
          p += right * sin(uTime*1.2 + base.x*0.03) * 0.15 * position.y * position.y;
          float row = (abs(toCam.x) > abs(toCam.z)) ? 1.0 : 0.0;
          vUv = vec2((uv.x + variant) / uCols, (uv.y + row) * 0.5);
          vW = p; vVar = variant; vBase = base;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          if (vFade <= 0.0 || h <= 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uCols;
        ${GLSL_COMMON}
        ${GLSL_FOG_PARS}
        ${GLSL_SUNSHADOW}
        varying vec2 vUv; varying vec3 vW; varying float vFade; varying float vVar; varying vec3 vBase;
        float bayer(vec2 p){ vec2 q = mod(floor(p), 4.0); return mod(q.x*4.0+q.y*2.0 + q.y*q.x, 4.0)/4.0 + 0.125; }
        void main(){
          vec4 c = texture(uAtlas, vUv);
          if (c.a < 0.5) discard;
          if (vFade < bayer(gl_FragCoord.xy)) discard;
          vec3 alb = c.rgb; // atlas is alpha-tested, not premultiplied
          // fake rounded-canopy normal from the billboard UV, lit like the near trees
          vec2 q = fract(vUv * vec2(uCols, 2.0)) * 2.0 - 1.0;
          // climate, as on the near trees: autumn crowns on broadleaf variants, snow on the upper boughs
          vec4 icl = climateAt(vBase.xz);
          if (icl.b > 0.02 && vVar < 3.5) {
            float th = hash12(floor(vBase.xz * 0.37) + 7.0);
            vec3 tint = th < 0.3 ? vec3(1.0, 0.42, 0.1) : th < 0.55 ? vec3(0.95, 0.72, 0.16) : vec3(0.8, 0.22, 0.08);
            alb = mix(alb, dot(alb, vec3(0.3, 0.59, 0.11)) * tint * 2.5, icl.b * step(th, 0.75));
          }
          alb = mix(alb, vec3(0.84, 0.87, 0.92), smoothstep(0.35, 0.8, icl.r) * smoothstep(-0.5, 0.4, q.y + 0.5 * (hash12(floor(vUv * 90.0)) - 0.5)) * 0.6);
          vec3 toCam = normalize(cameraPosition - vW);
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
          vec3 N = normalize(right * q.x * 0.8 + vec3(0.0, 0.55 + 0.35 * q.y, 0.0) + toCam * 0.6);
          float ndl = max(dot(N, normalize(uSunDir)), 0.0);
          float ao = 0.55 + 0.45 * smoothstep(-0.6, 0.8, q.y);
          vec3 col = alb * (uSunColor * ndl * 0.13 * terrainSunShadow(vW + vec3(0.0, 2.0, 0.0)) + uFogColor * 0.24 * ao + vec3(0.005));
          // far trees take on the shading of the canopy-tinted terrain they sink into, so the fade band
          // reads as forest texture rather than pale or black specks
          float farK = smoothstep(620.0, 1050.0, length(cameraPosition - vW));
          if (farK > 0.0) {
            float cn = fbm2(vW.xz / 18.0);
            vec3 cAlb = mix(pow(vec3(34.0, 46.0, 26.0) / 255.0, vec3(2.2)), pow(vec3(52.0, 62.0, 32.0) / 255.0, vec3(2.2)), cn);
            cAlb = mix(cAlb, mix(pow(vec3(26.0, 50.0, 20.0) / 255.0, vec3(2.2)), pow(vec3(40.0, 68.0, 26.0) / 255.0, vec3(2.2)), cn), icl.g);
            cAlb = mix(cAlb, mix(pow(vec3(124.0, 58.0, 22.0) / 255.0, vec3(2.2)), pow(vec3(158.0, 112.0, 32.0) / 255.0, vec3(2.2)), cn), icl.b * 0.85);
            cAlb = mix(cAlb, mix(cAlb, vec3(0.55, 0.6, 0.65), 0.5), smoothstep(0.4, 0.8, icl.r));
            vec3 nT = normalAt(vW.xz);
            float ndlT = max(dot(nT, normalize(uSunDir)), 0.0);
            vec3 litT = cAlb * (uSunColor * ndlT * 0.3 * terrainSunShadow(vW + vec3(0.0, 2.0, 0.0)) + uFogColor * 0.2 * ao);
            col = mix(col, litT, farK * 0.85);
          }
          col = applyAtmosphere(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.impostors = mesh;
  }

  // push a circle out of tree trunks and big rocks
  collide(pos, radius) {
    for (const [layer, rad] of [[this.trees, 0.45], [this.rocks, 0.8]]) {
      const cx = Math.floor(pos.x / layer.cell), cz = Math.floor(pos.z / layer.cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const list = layer.grid.get((cx + dx) + ',' + (cz + dz));
        if (!list) continue;
        for (const it of list) {
          const rr = rad * it.s + radius;
          if (layer === this.rocks && it.s < 1.2) continue;
          const ox = pos.x - it.x, oz = pos.z - it.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = it.x + ox / d * rr; pos.z = it.z + oz / d * rr; }
        }
      }
    }
  }

  update(camPos, force = false) {
    this.trees.update(camPos, force);
    this.bushes.update(camPos, force);
    this.rocks.update(camPos, force);
    this.logs.update(camPos, force);
  }
}
