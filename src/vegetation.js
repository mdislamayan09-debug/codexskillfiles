// Vegetation: GPU grass fields, procedural trees (oak / pine / cypress) with distant impostors,
// bushes, ferns and rocks. Everything is instanced and streamed around the camera.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, GLSL_COMMON, GLSL_FOG_PARS, GLSL_SUNSHADOW, patchMaterial } from './shared.js';
import { HALF, WORLD_SIZE, TOWN, RANCH, CAMP, CHURCH, CABIN } from './world.js';
import { mulberry32, Simplex2 } from './noise.js';
import { leafCardTexture, pineCardTexture, pineTuftTexture, barkTexture, conBarkTextures } from './textures.js';

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
    #ifndef CONIFER_SNOW
    #ifdef USE_MAP
    {
      // every shrub and broadleaf crown its own shade: yellow-green new growth, dark old leaf, a few going brown
      float pv = hash12(floor(${pos}.xz * 1.7) + 2.3);
      diffuseColor.rgb *= mix(vec3(0.7, 0.76, 0.7), vec3(1.08, 1.02, 0.74), pv) * mix(vec3(1.0), vec3(1.1, 0.86, 0.62), step(0.86, fract(pv * 7.31)));
    }
    #endif
    #endif
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
      #if defined(CONIFER_SNOW) && defined(USE_MAP)
      // a spruce bough carries a load of snow along its upper side: on the standing cards the half above the
      // stem is white too, so each bough reads as a white shelf over dark needles
      // (in clumps along the bough, not a full coat: evenly coated firs read as frosted Christmas trees)
      // (broken and uneven, and on fewer boughs: a clean band on every card striped each spruce white and green like a
      // candy cane)
      sk = max(sk, smoothstep(0.35, 0.8, cl.r) * (1.0 - smoothstep(0.35, 0.6, up)) * smoothstep(0.58, 0.74, vMapUv.y + 0.22 * (vnoise(vWPos.xz * 3.1 + vWPos.y * 2.3) - 0.5)) * smoothstep(0.45, 0.7, hash12(floor(vWPos.xz * 1.3 + vWPos.y * 0.9) + 3.3)) * 0.8);
      #endif
      #if defined(FROST_ALL) && defined(USE_MAP)
      // and snow lodged in the upper crown of the brush, in clumps (snowless brush read as grey pom-poms on the snow)
      sk = max(sk, smoothstep(0.4, 0.85, cl.r) * smoothstep(0.5, 0.8, vMapUv.y) * smoothstep(0.35, 0.65, hash12(floor(vWPos.xz * 6.0 + vWPos.y * 5.0))));
      #endif
      #ifdef CONIFER_SNOW
      sk *= 0.45;   // dark green under a dusting: heavier, every spruce stood as a white cone
      #endif
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.87, 0.92), sk * 0.85);
      #ifdef FROST_ALL
      // hoarfrost furs every twig of the dry brush in the cold country
      // (a light rime, the twigs still dark through it: a heavy coat turned every shrub into a white coral ball)
      diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.33))), diffuseColor.rgb, 1.0 - 0.45 * smoothstep(0.4, 0.85, cl.r));   // winter-dead, greyed
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), smoothstep(0.4, 0.85, cl.r) * 0.3);
      #endif
    }
    #ifdef FROST_ALL
    // desert scrub is sun-bleached grey-tan, not dark twigs
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.43, 0.33) * (0.7 + 0.6 * dot(diffuseColor.rgb, vec3(0.33))), cl.a * 0.75);
    #endif
  }`;
function windMaterial(mat, flutter = 0, extra = {}, { autumn = false, frost = false, trans = null, backDark = null, conifer = false } = {}) {
  return patchMaterial(mat, {
    sunShadow: true,
    noFlip: flutter > 0,
    vertexHead: `#define LEAF_FLUTTER ${flutter.toFixed(2)}\n` + WIND_VERT,
    vertexBody: WIND_BODY,
    fragHead: 'varying vec3 vTreePos;\n' + (conifer ? '#define CONIFER_SNOW\n' : '') + (autumn ? '#define AUTUMN_LEAVES\n' : '') + (frost ? '#define FROST_ALL\n' : '') + (trans !== null ? `#define LEAF_TRANS ${trans.toFixed(3)}\n` : '') + (backDark !== null ? `#define BACKLIT_DARK ${backDark.toFixed(3)}\n#define UNDERSIDE_DARK 0.6\n` : ''),
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
    #ifndef BACKLIT_DARK
    #define BACKLIT_DARK 0.22
    #endif
    // cards keep one (outward, upward) normal on both sides; seen from underneath a bough is in its own shade,
    // not lit by the sky above it
    #ifndef UNDERSIDE_DARK
    #define UNDERSIDE_DARK 0.35
    #endif
    diffuseColor.rgb *= 1.0 - UNDERSIDE_DARK * smoothstep(0.0, -0.5, dot(normalize(vNormal), normalize(vViewPosition)));
    // seen against the sun a bough is mostly its own shadow: card normals alone would light the near side
    diffuseColor.rgb *= 1.0 - BACKLIT_DARK * pow(max(dot(vdir, normalize(uSunDir)), 0.0), 1.5) * smoothstep(-0.05, 0.15, uSunDir.y);
    // (most where the foliage is thin: the fringe of a spray lights up against the sun while its dense middle stays dark)
    float thinK = 1.0 + 2.6 * (1.0 - smoothstep(0.5, 0.98, diffuseColor.a));
    totalEmissiveRadiance += diffuseColor.rgb * vec3(0.95, 1.05, 0.45) * uSunColor * gSunVis * back * LEAF_TRANS * thinK;
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
  // many smaller sprays spread wide around each tip, so the crown is one broken, continuous mass of foliage with
  // sky holes and ragged edges, not a bunch of round pom-poms on sticks
  const leafSize = 1.35 + rnd() * 0.4;
  for (const t of tips) {
    for (let k = 0; k < 10; k++) {
      const c = t.clone().add(new THREE.Vector3((rnd() - 0.5) * 2.9, (rnd() - 0.4) * 1.9, (rnd() - 0.5) * 2.9));
      leaves.push(cardGeo(leafSize * (0.7 + rnd() * 0.6), c, canopyC, rnd));
    }
  }
  // fill the crown interior so it reads as a mass, not lollipops
  const crownR = Math.max(...tips.map((t) => Math.hypot(t.x, t.z))) * 0.8 + 1;
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * crownR;
    const c = new THREE.Vector3(Math.cos(a) * rr, canopyC.y + (rnd() - 0.5) * height * 0.28, Math.sin(a) * rr);
    leaves.push(cardGeo(leafSize * (0.8 + rnd() * 0.5), c, canopyC, rnd));
  }
  const woodG = setSway(mergeGeometries(wood), (x, y) => Math.max(0, y - 2) / height * 0.6);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y) => Math.max(0, y - 2) / height));
  return { wood: woodG, leaves: leafG, height, radius: 6 };
}

// a dead snag: a weathered grey bole snapped off partway up, bristling with dead limb stubs
function buildSnag(seed) {
  const rnd = mulberry32(seed);
  const height = 11 + rnd() * 10, r0 = 0.26 + rnd() * 0.1;
  const top = new THREE.Vector3((rnd() - 0.5) * 0.8, height, (rnd() - 0.5) * 0.8);
  const wood = [branchGeo(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 1.4, 0), r0 * 1.35, r0, 10), branchGeo(new THREE.Vector3(0, 1.4, 0), top, r0, r0 * 0.45, 9)];
  // the jagged break
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + rnd(), rr = r0 * 0.4; const p0 = top.clone().add(new THREE.Vector3(Math.cos(a) * rr, -0.1, Math.sin(a) * rr)); wood.push(branchGeo(p0, p0.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.1, 0.3 + rnd() * 0.7, (rnd() - 0.5) * 0.1)), 0.05, 0.006, 4)); }
  // dead limbs all the way up, long and drooping low down, short near the break: the silhouette of a dead pine,
  // not a bare pole
  for (let i = 0; i < 44; i++) {
    const y = 2 + rnd() * (height - 2.5), a = rnd() * 6.28, L = 0.5 + rnd() * 2.4 * Math.pow(1 - y / height, 0.7);
    const b0 = new THREE.Vector3(top.x * y / height, y, top.z * y / height);
    const tip = b0.clone().add(new THREE.Vector3(Math.cos(a) * L, -0.2 - rnd() * 0.5 * L, Math.sin(a) * L));
    wood.push(branchGeo(b0, tip, 0.06, 0.012, 4));
    if (L > 1.2) { const m = b0.clone().lerp(tip, 0.55); wood.push(branchGeo(m, m.clone().add(new THREE.Vector3(Math.cos(a + 0.9) * L * 0.35, 0.1, Math.sin(a + 0.9) * L * 0.35)), 0.025, 0.006, 3)); }
  }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + rnd(); wood.push(branchGeo(new THREE.Vector3(Math.cos(a) * r0 * 2.6, -0.25, Math.sin(a) * r0 * 2.6), new THREE.Vector3(Math.cos(a) * r0 * 0.3, 1.0, Math.sin(a) * r0 * 0.3), r0 * 0.22, r0 * 0.5, 5)); }
  return { wood: setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), () => 0), height };
}

// kind: 'pine' (heartlands), 'tall' (forest giants, bare lower trunk), 'fir' (dense cone to the ground)
function buildPine(seed, kind = 'pine') {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = kind === 'tall' ? 26 + rnd() * 9 : kind === 'fir' ? 11 + rnd() * 7 : 14 + rnd() * 9;
  // trunk in two tapering sections (flared base, then a steady taper to the leader)
  // lodgepole/ponderosa trunks: slim poles, not redwood columns
  const r0 = (kind === 'tall' ? 0.31 : 0.24) + rnd() * 0.09;
  wood.push(branchGeo(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 1.4, 0), r0 * 1.35, r0, 10));
  // (the bole in five sections, wandering a little off its line as it climbs: one straight taper read as a turned pole)
  const topX = (rnd() - 0.5) * 0.9, topZ = (rnd() - 0.5) * 0.9, bendA = rnd() * 6.28, bend = (kind === 'tall' ? 0.35 : 0.18) * (0.4 + rnd());
  const bole = (t) => new THREE.Vector3(topX * t + Math.cos(bendA) * bend * Math.sin(t * Math.PI) + Math.cos(bendA * 2.3) * bend * 0.3 * Math.sin(t * 6.3), 1.4 + (height - 3.8) * t, topZ * t + Math.sin(bendA) * bend * Math.sin(t * Math.PI) + Math.sin(bendA * 2.3) * bend * 0.3 * Math.sin(t * 6.3));
  const boleR = (t) => 0.05 + (r0 - 0.05) * Math.pow(1 - t, 0.8);
  for (let k = 0; k < 5; k++) wood.push(branchGeo(bole(k / 5), bole((k + 1) / 5), boleR(k / 5), boleR((k + 1) / 5), 10));
  // root flare: buttress roots spreading into the duff instead of a pole stuck in the ground
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.8, L = r0 * (kind === 'tall' ? 1.2 + rnd() * 0.45 : 1.6 + rnd() * 0.9);   // (a slight swell on the old boles, not a tent skirt)
    wood.push(branchGeo(new THREE.Vector3(Math.cos(a) * L, -0.3, Math.sin(a) * L), new THREE.Vector3(Math.cos(a) * r0 * 0.35, 0.7 + rnd() * 0.4, Math.sin(a) * r0 * 0.35), r0 * 0.28, r0 * 0.45, 7));   // rounder, lower buttresses
  }
  const whorls = kind === 'tall' ? 30 + Math.floor(rnd() * 5) : 20 + Math.floor(rnd() * 6);
  const base = kind === 'tall' ? height * (0.42 + rnd() * 0.12) : kind === 'fir' ? 0.5 + rnd() * 0.4 : 2.5 + rnd() * 1.5;
  if (kind === 'tall') {
    // dead lower branch stubs on the bare trunk
    for (let i = 0; i < 16; i++) {
      const y = 2 + Math.pow(rnd(), 0.7) * (base - 1), a = rnd() * 6.28, L = 0.5 + rnd() * 1.6 * (y / base);
      const b0 = bole((y - 1.4) / (height - 3.8));
      wood.push(branchGeo(b0, new THREE.Vector3(b0.x + Math.cos(a) * L, y - 0.2 - rnd() * 0.4, b0.z + Math.sin(a) * L), 0.06, 0.02, 4));
    }
    // and a few real dead limbs: thick at the bole, drooping, snapped short or ending in a fork of bare twigs
    for (let i = 0; i < 5; i++) {
      const y = base * (0.35 + rnd() * 0.6), a = rnd() * 6.28, L = 1.6 + rnd() * 2.6, b0 = bole((y - 1.4) / (height - 3.8));
      const mid = new THREE.Vector3(b0.x + Math.cos(a) * L * 0.55, y - 0.15 - rnd() * 0.3, b0.z + Math.sin(a) * L * 0.55);
      const tip = new THREE.Vector3(b0.x + Math.cos(a + 0.25) * L, y - 0.6 - rnd() * 0.9, b0.z + Math.sin(a + 0.25) * L);
      wood.push(branchGeo(b0, mid, 0.085, 0.05, 5), branchGeo(mid, tip, 0.05, 0.016, 4));
      if (rnd() < 0.7) wood.push(branchGeo(mid, new THREE.Vector3(mid.x + Math.cos(a - 0.9) * L * 0.4, mid.y + 0.1, mid.z + Math.sin(a - 0.9) * L * 0.4), 0.03, 0.008, 3));
    }
  }
  // each variant has its own habit: narrow spire-like subalpine firs to broad, heavy spruces
  // (fuller firs: the narrow spires read as spindly spikes against the reference's broad, snow-loaded spruce)
  const spread = (kind === 'tall' ? 3.3 : kind === 'fir' ? 3.2 : 3.4) * (kind === 'fir' ? 0.85 + rnd() * 0.45 : 0.85 + rnd() * 0.3);
  const tall = kind === 'tall';
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = base + t * (height - base);
    // forest giants: a ragged columnar crown — missing whorls, uneven limbs — rather than a perfect cone
    if (tall && t < 0.85 && rnd() < 0.15) continue;      // open crowns: sky shows between the limbs (not so open they read as poles)
    const r = tall
      ? spread * (0.5 + 0.5 * Math.pow(1 - t, 0.6)) * (t > 0.82 ? (1 - t) / 0.18 : 1) + 0.45
      : Math.pow(1 - t, 0.9) * (spread + rnd() * 0.6) + (kind === 'fir' ? 0.45 : 0.55);
    const n = tall ? 5 + Math.floor(rnd() * 4) : 9 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * (tall ? 1.4 : 0.7) + w;
      const droop = 0.18 + rnd() * 0.25 + (1 - t) * 0.25 + (kind === 'fir' ? 0.18 : 0);
      const lr = tall ? r * (0.6 + rnd() * 0.65) : r;
      // cross cards: one lying along the branch, one standing on its edge, so the silhouette reads from the side
      // and from above; each bough is three sprays along its length (sagging further out), so it reads as tufts
      // with sky between them rather than one flat sheet
      for (const vert of [false, true]) {
        const r = lr;
        for (let sgi = 0; sgi < 3; sgi++) {
          const t0 = 0.08 + sgi * 0.3, Ls = r * (0.5 - sgi * 0.07), Ws = r * (vert ? 0.28 : 0.4) * (1 - sgi * 0.14);
          const g = new THREE.PlaneGeometry(Ls, Ws);
          g.translate(r * t0 + Ls * 0.5, -sgi * sgi * 0.05 * r, 0);
          g.rotateY((rnd() - 0.5) * 0.35);
          if (!vert) g.rotateX(Math.PI / 2 + (rnd() - 0.5) * 0.5);
          else g.rotateX((rnd() - 0.5) * 0.4);
          g.rotateZ(-droop);
          g.rotateY(a);
          { const bq = bole(Math.min(1, Math.max(0, (y - 1.4) / (height - 3.8)))); g.translate(bq.x, y, bq.z); }   // (on the bole where it stands at this height)
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
  }
  // top tuft: a ring of short up-swept shoots around a needled leader, so the crown ends in a
  // dense point rather than a bare pole with a blob on it
  // (short, close shoots: a long up-swept ring forked above the crown and every tree ended in the same spike)
  for (let i = 0; i < 6; i++) {
    const L = 0.6 + rnd() * 0.35, y = height - 1.9 + (i / 6) * 1.1;
    const g = new THREE.PlaneGeometry(L, L * 0.55);
    g.translate(L * 0.5, 0, 0);
    g.rotateX((rnd() - 0.5) * 0.6);
    g.rotateZ(0.35 + (i / 6) * 0.35);
    g.rotateY((i / 6) * Math.PI * 2 * 1.6 + rnd());
    g.translate(topX, y, topZ);
    leaves.push(g);
  }
  for (let i = 0; i < 2; i++) {
    const g = new THREE.PlaneGeometry(0.85 + rnd() * 0.4, 0.42);
    g.translate(0.4, 0, 0);
    g.rotateZ(Math.PI / 2 - (rnd() - 0.5) * 0.3);
    g.rotateY(i * Math.PI / 2 + rnd() * 0.4);
    g.translate(topX, height - 1.2, topZ);
    leaves.push(g);
  }
  const woodG = setSway(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)), (x, y) => (y / height) ** 2 * 0.5);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y, z) => (y / height) ** 2 * 0.6 + Math.hypot(x, z) * 0.05), true);
  // every spray its own shade: new growth yellower and lighter, old needles darker and bluer
  {
    const col = leafG.attributes.color;
    for (let q = 0; q + 3 < col.count; q += 4) {
      const v = 0.82 + rnd() * 0.32, y2 = rnd();
      for (let k = q; k < q + 4; k++) col.setXYZ(k, col.getX(k) * v * (1.02 + 0.06 * y2), col.getY(k) * v * (1.0 + 0.04 * y2), col.getZ(k) * v * (1.04 - 0.1 * y2));
    }
  }
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
  // settled into the duff (not resting on top of it), the bole sagging a little where it spans a hollow
  // (a swollen, knotted, out-of-round bole, flattened where it lies: two smooth cylinders read as a striped tube)
  const trunk = new THREE.CylinderGeometry(r * 0.78, r, L, 16, 22, true).toNonIndexed();
  {
    const tp = trunk.attributes.position, tu = trunk.attributes.uv, ph = rnd() * 6.28;
    for (let k = 0; k < tp.count; k++) {
      const t = tp.getY(k), a = Math.atan2(tp.getZ(k), tp.getX(k)), rad = Math.hypot(tp.getX(k), tp.getZ(k));
      const kn = 1 + 0.1 * Math.sin(a * 2 + t * 0.9 + ph) + 0.07 * Math.sin(a * 5 - t * 2.3) + 0.09 * Math.sin(t * 3.7 + ph) * Math.sin(a * 3 + ph) + 0.16 * Math.exp(-((t - L * 0.18) ** 2) / 0.05) + 0.12 * Math.exp(-((t + L * 0.27) ** 2) / 0.04);
      let y = Math.sin(a) * rad * kn, z = Math.cos(a) * rad * kn;
      y = Math.max(y, -rad * 0.6);                                   // settled into the duff
      tp.setXYZ(k, t, y + r * 0.36 - 0.05 * Math.cos(t / L * Math.PI), z);
      tu.setXY(k, tu.getX(k) * 4, tu.getY(k) * L * 1.1);
    }
    trunk.computeVertexNormals();
  }
  const parts = [trunk];
  for (let i = 0; i < 5; i++) { // snapped branch stubs
    const x = (rnd() - 0.5) * L * 0.8, a = rnd() * 6.28;
    parts.push(branchGeo(new THREE.Vector3(x, r * 0.8, 0), new THREE.Vector3(x + 0.3, r * 0.8 + Math.cos(a) * 0.9, Math.sin(a) * 0.9), 0.07, 0.03, 4));
  }
  // the broken end: long splinters standing out of the snapped wood
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5, rr = r * (0.55 + rnd() * 0.35);
    const p0 = new THREE.Vector3(L / 2, r * 0.4 + Math.sin(a) * rr, Math.cos(a) * rr);
    parts.push(branchGeo(p0, p0.clone().add(new THREE.Vector3(0.25 + rnd() * 0.55, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.12)), 0.05 + rnd() * 0.03, 0.006, 4));
  }
  // the other end: a windthrown root plate standing up out of the ground
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd() * 0.4, len = r * (2.4 + rnd() * 1.6);
    const p0 = new THREE.Vector3(-L / 2, r * 0.42, 0);
    parts.push(branchGeo(p0, p0.clone().add(new THREE.Vector3(-0.15 - rnd() * 0.25, Math.max(-r * 0.4, Math.sin(a) * len), Math.cos(a) * len)), r * 0.28, 0.02, 5));
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
    else { g.fillStyle = `rgba(${62 + r() * 20},${48 + r() * 14},${34},0.9)`; g.fillRect(x2 - 1, y2 - 1, 2, 2); }   // dark buds (pale tips frosted into white dots)
  };
  for (let i = 0; i < 7; i++) branch(128 + (r() - 0.5) * 40, 256, Math.PI / 2 + (r() - 0.5) * 1.2, 50 + r() * 30, 4, 4);
});
// a bunchgrass tuft: long dry blades fanning up and out of the crown, straw and ochre with grey dead blades
const tuftTexture = () => cardCanvas(256, 256, (g, r) => {
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x0 = 128 + (r() - 0.5) * 50, a = Math.PI / 2 + (r() - 0.5) * 1.5, L = 120 + r() * 120;
    const bend = (r() - 0.5) * 0.9 + (a - Math.PI / 2) * 0.8;
    const dead = r() < 0.3, v = 0.75 + r() * 0.4;
    g.strokeStyle = dead ? `rgb(${Math.round(118 * v)},${Math.round(110 * v)},${Math.round(98 * v)})` : `rgb(${Math.round(176 * v)},${Math.round(138 * v)},${Math.round(76 * v)})`;
    g.lineWidth = 1.6 + r() * 1.8;
    const x1 = x0 + Math.cos(a) * L * 0.55, y1 = 256 - Math.sin(a) * L * 0.55;
    const x2 = x0 + Math.cos(a + bend) * L, y2 = 256 - Math.sin(a + bend) * L * 0.92;
    g.beginPath(); g.moveTo(x0, 256); g.quadraticCurveTo(x1, y1, x2, y2); g.stroke();
  }
});
// tall dead stalks (fireweed and dock gone to seed), with their seed heads
const stalkTexture = () => cardCanvas(128, 512, (g, r) => {
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x0 = 64 + (r() - 0.5) * 30, L = 280 + r() * 210, lean = (r() - 0.5) * 50;
    g.strokeStyle = `rgb(${92 + r() * 30},${76 + r() * 20},${60 + r() * 14})`; g.lineWidth = 2 + r() * 1.5;
    g.beginPath(); g.moveTo(x0, 512); g.quadraticCurveTo(x0 + lean * 0.3, 512 - L * 0.5, x0 + lean, 512 - L); g.stroke();
    // seed head and a few side shoots near the top
    for (let k = 0; k < 6; k++) {
      const t = 0.7 + k * 0.05, sx = x0 + lean * t * t, sy = 512 - L * t, sd = r() < 0.5 ? -1 : 1;
      g.lineWidth = 1.2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + sd * (8 + r() * 14), sy - 6 - r() * 10); g.stroke();
    }
    g.fillStyle = `rgb(${110 + r() * 30},${90 + r() * 20},${70})`;
    g.beginPath(); g.ellipse(x0 + lean, 512 - L - 8, 4, 12, lean * 0.004, 0, 7); g.fill();
  }
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
    const up = new THREE.Vector3(0, 1, 0), eul = new THREE.Euler();
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
        if (this.lean) {
          // trees stand a little off plumb, each its own way (a stand of perfectly vertical poles reads as planted)
          const hx = Math.sin(it.x * 12.9898 + it.z * 78.233) * 43758.5453, hz = Math.sin(it.x * 39.346 + it.z * 11.135) * 24634.6345;
          q.setFromEuler(eul.set((hx - Math.floor(hx) - 0.5) * 2 * this.lean, it.ry, (hz - Math.floor(hz) - 0.5) * 2 * this.lean, 'YXZ'));
        } else q.setFromAxisAngle(up, it.ry);
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
  for (let i = 0; i < 120; i++) {
    // a dome-shaped clump: tall blades in the middle, short ones at the sides, so no card shows a square edge
    const x0 = 256 + (r() + r() + r() - 1.5) * 150;
    const cx = (x0 - 256) / 226;
    const h = (180 + r() * 300) * Math.max(0.25, 1 - 0.75 * cx * cx);
    const lean = (r() - 0.5) * 140 + cx * 90;
    const w = 2.2 + r() * 3.2;
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
  // three cards at 60 degrees: a round clump from every side and from above
  for (let q = 0; q < 3; q++) {
    const base = pos.length / 3;
    const ca = Math.cos(q * Math.PI / 3), sa = Math.sin(q * Math.PI / 3);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= 1; i++) {
      const x = i - 0.5, y = j / rows;
      pos.push(x * ca, y, x * sa);
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
      varying float vDes;
    `,
    fragHead: 'varying float vDes;',
    // in the desert the loose stones are pale sandstone, not dark forest-floor rock
    fragColor: `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.27, 0.19) * (0.75 + 0.4 * fract(vWPos.x * 3.7 + vWPos.z * 1.3)), vDes);`,
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
      {
        vec4 cp = projectionMatrix * (viewMatrix * vec4(xz.x, heightAt(xz) + 0.1, xz.y, 1.0));
        if (cp.w < -3.5 || abs(cp.x) > cp.w * 1.15 + 4.0 || abs(cp.y) > cp.w * 1.25 + 4.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      }
      vec4 sp = splatAt(xz);
      vec4 cl = climateAt(xz);
      float dist = length(xz - cam);
      float dens = ${mode === 'stone'
        ? 'max(sp.b * 0.55, max(smoothstep(0.3, 0.8, sp.r) * 0.22, cl.a * 0.5)) * (1.0 - smoothstep(0.4, 0.7, sp.a))'
        : 'max(smoothstep(0.25, 0.6, sp.b), 0.85 * smoothstep(-700.0, -1250.0, xz.y)) * (1.0 - smoothstep(0.3, 0.62, sp.r)) * (1.0 - cl.a)'};
      dens *= (1.0 - smoothstep(0.3, 0.6, cl.r)) * smoothstep(0.6, 1.5, heightAt(xz)) * smoothstep(RADIUS, RADIUS * 0.75, dist);
      // gathered in drifts and clusters (under a tree, along a runnel), bare between: never an even sprinkle
      dens *= smoothstep(0.24, 0.66, fbm2(xz / 6.5 + ${(seed * 3.7).toFixed(2)})) * 1.9;
      vDes = cl.a;
      float keep = step(aOff.w, dens);
      float sc = mix(${smin.toFixed(3)}, ${smax.toFixed(3)}, fract(aOff.z * 13.7 + aOff.w * 7.1)) * keep;
      vec3 transformed = cRot * position * sc;
      transformed.xz += xz;
      transformed.y += heightAt(xz) - 0.02${mode === 'stone' ? ' - sc * 0.28' : ''};   ${mode === 'stone' ? '// stones half sunk in the duff' : ''}
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
      float h0 = heightAt(xz);
      // Clumps outside the lens's view are thrown out here, before any of the work below. The field is a square
      // all round the camera and three clumps in four are behind it or off to the side; each used to run this whole
      // shader for every one of its vertices, which cost more than any other part of the frame.
      {
        vec4 cp = projectionMatrix * (viewMatrix * vec4(xz.x, h0 + 0.3, xz.y, 1.0));
        if (cp.w < -2.5 || abs(cp.x) > cp.w * 1.15 + 3.5 || cp.y > cp.w * 1.2 + 3.5 || cp.y < -cp.w * 1.2 - 3.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      }
      vec4 sp = splatAt(xz);
      vec3 nrm = normalAt(xz);
      float slope = 1.0 - nrm.y;
      float edgeN = (vnoise(xz * 0.9) - 0.5) * 0.35 + (vnoise(xz * 3.1) - 0.5) * 0.12;
      float dens = (1.0 - smoothstep(0.2, 0.45, sp.r + edgeN)) * (1.0 - smoothstep(0.38, 0.7, sp.a + edgeN * 0.6));
      dens *= smoothstep(0.15, 0.9, h0) * (1.0 - smoothstep(0.3, 0.5, slope));
      dens *= 1.0 - smoothstep(700.0, 860.0, h0);
      dens *= 1.0 - 0.85*smoothstep(0.3, 0.8, sp.b);
      vec4 gcl = climateAt(xz);
      float snowG = smoothstep(0.3, 0.65, gcl.r);
      float field = fbm2(xz/26.0);
      // under snow there is no lawn at all (thin clumps squash flat into dark stars on the white); the dry
      // frosted brush scattered by the CPU is what pokes through
      dens *= 1.0 - smoothstep(0.15, 0.4, gcl.r);
      dens *= 1.0 - 0.9 * gcl.a;    // desert: sparse bunch grass
      dens *= 1.0 - 0.55 * gcl.g * smoothstep(0.2, 0.6, sp.b); // jungle floor is litter and big leaves, not lawn
      dens *= smoothstep(0.02, 0.28, field + 0.12);
      // under closed pine canopy the grass gives way to needle duff (it holds on in the light along the trail)
      dens *= 1.0 - 0.2 * smoothstep(0.5, 0.9, sp.b) * smoothstep(-700.0, -1250.0, xz.y) * (1.0 - smoothstep(0.05, 0.4, sp.r));   // (much more and the floor went bare)
      // and in the pine woods it grows in drifts where the light gets in, open duff between them (a clump every few
      // metres everywhere read as tufts dotted over the floor at regular spacing)
      dens *= mix(1.0, smoothstep(0.38, 0.6, field + 0.15 * (vnoise(xz / 3.1) - 0.5)), smoothstep(-700.0, -1250.0, xz.y) * (1.0 - smoothstep(0.3, 0.7, gcl.r)));
      float alive = smoothstep(aOff.z - 0.02, aOff.z + 0.25, dens); // soft, ragged edges at roads/yards
      float macro = fbm2(xz/380.0);
      float dry = smoothstep(0.42, 0.68, macro + 0.15*fbm2(xz/11.0 + 3.0));
      float hgt = mix(0.18, 0.66, smoothstep(0.25, 0.8, field)) * (0.55 + 0.7*aOff.w) * (0.85 + 0.35*dry) * (0.7 + 0.6 * fbm2(xz / 9.0));
      hgt *= mix(0.42, 1.0, smoothstep(55.0, 110.0, length(xz - RANCH_XZ))); // grazed ranch pasture
      hgt *= (1.0 + 0.55 * gcl.g) * (1.0 - 0.45 * snowG);
      // grass shortens toward a path or yard edge (trampled, grazed) instead of standing as a cut wall
      float edgeCut = smoothstep(0.08, 0.55, 1.0 - smoothstep(0.05, 0.45, sp.r + edgeN * 0.8));
      hgt *= alive * fade * mix(0.25, 1.0, edgeCut);
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
      // pine-belt grass: olive-green clumps mixed with cured straw ones (each clump its own), never one lime green
      {
        // (lighter and yellower in the low sun: dark olive clumps read as tufts stamped on the duff)
        vec3 pg = mix(srgbV(vec3(130,140,70)), srgbV(vec3(160,160,92)), aOff.w);
        vec3 ps = mix(srgbV(vec3(176,156,104)), srgbV(vec3(150,138,96)), aOff.w);
        vec3 pc = mix(pg, ps, clamp(step(0.62, aOff.z) * 0.8 + dryPatch * 0.5, 0.0, 1.0)) * 0.95 * (0.75 + 0.5 * midV);
        vGCol = mix(vGCol, pc, smoothstep(-700.0, -1250.0, xz.y) * (1.0 - gcl.r) * 0.85);
      }
      vGCol = mix(vGCol, mix(srgbV(vec3(150,128,92)), srgbV(vec3(118,100,74)), aOff.z) * 1.15, snowG);            // dry winter grass
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
function rockGeometry(seed, fractured = false, detail = 5, cutsN = 7, cutDepth = 0) {
  const n = new Simplex2(seed);
  // welded so the boulder gets smooth normals instead of a faceted, low-poly look
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('uv').deleteAttribute('normal'));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = 1 + (seed % 3) * 0.3, sz = 0.8 + (seed % 5) * 0.12;
  // fractured granite: a handful of joint planes shear the boulder into flat faces and hard edges, like the split
  // blocks and slabs in the references, instead of a pebble
  const lerp1 = (a, b, t) => a + (b - a) * t;
  const jr = mulberry32(seed * 13 + 5), jointM = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((jr() - 0.5) * 0.3, jr() * 6.28, (jr() - 0.5) * 0.3))), jointMi = jointM.clone().invert();
  const jstep = [0.3 + jr() * 0.16, 0.2 + jr() * 0.1, 0.34 + jr() * 0.16], jo = [jr(), jr(), jr()];
  const cuts = [];
  if (fractured) {
    const rr = mulberry32(seed * 7 + 1);
    for (let k = 0; k < cutsN; k++) {
      const th = rr() * Math.PI * 2, ph = (k === 0 ? 0.05 : 0.25 + rr() * 0.9);
      cuts.push({ n: new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)), o: 0.62 - cutDepth + rr() * 0.28 });
    }
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + (fractured ? 0.22 : 0.32) * n.fbm(v.x * 1.4 + seed, v.y * 1.4 + v.z, 4) + (fractured ? 0.05 : 0.12) * n.noise(v.x * 5, v.z * 5 + v.y * 3);
    v.multiplyScalar(d);
    if (cutDepth > 0.2) {
      // jointed rock: bedding planes and two sets of upright joints at right angles break it into stacked blocks
      // and stepped ledges (planes cut at random angles made crystal shards, not an outcrop)
      v.applyMatrix3(jointM);
      const wob = 0.06 * n.noise(v.x * 1.3 + 7.1, v.z * 1.3 - 2.2);
      v.x = lerp1(v.x, (Math.round((v.x + wob) / jstep[0] + jo[0]) - jo[0]) * jstep[0], 0.86);
      v.y = lerp1(v.y, (Math.round((v.y + wob * 0.6) / jstep[1] + jo[1]) - jo[1]) * jstep[1], 0.9);
      v.z = lerp1(v.z, (Math.round((v.z - wob) / jstep[2] + jo[2]) - jo[2]) * jstep[2], 0.86);
      v.applyMatrix3(jointMi);
    } else for (const c of cuts) { const t = v.dot(c.n) - c.o; if (t > 0) v.addScaledVector(c.n, -t * 0.97); }
    // facet/strata flattening
    v.y = Math.round(v.y * 6) / 6 * 0.12 + v.y * 0.88;
    v.x *= sx; v.z *= sz;
    if (v.y < -0.2) v.y = -0.2 - (v.y + 0.2) * 0.2;
    p.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  // deep-cut blocks come out much smaller than the unit boulder: bring the crown back to the same height, so
  // placement by scale means the same thing for every variant
  if (cutDepth > 0.2) {
    let top = 0, wide = 0;
    for (let i = 0; i < p.count; i++) { top = Math.max(top, p.getY(i)); wide = Math.max(wide, Math.hypot(p.getX(i), p.getZ(i))); }
    g.scale(0.56 / wide, 0.62 / top, 0.56 / wide);   // a block about as tall as it is broad
    // hard edges where the joint planes meet (smoothed across them, a split block shaded as a rounded lump)
    return toCreasedNormals(g, 0.7);
  }
  g.computeVertexNormals();
  return g;
}

function rockMaterial(surf = {}, bare = false) {
  // (dry granite is near-matte: at 0.88 with the full sky reflection the boulders read as shiny lumps)
  const m = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, envMapIntensity: 0.55 });
  return patchMaterial(m, {
    // bare: wind-scoured ledge granite (snow only in patches and cracks), for a lookout's own rock
    fragHead: (bare ? '#define BARE_LEDGE\n' : '') + /* glsl */ `uniform sampler2D tRockA; uniform sampler2D tRockN; vec3 srgbR(vec3 c){ return pow(c/255.0, vec3(2.2)); }
      // triplanar scanned relief in world space (whiteout blend), so a boulder scaled up to a ledge keeps its grain
      vec3 rockTriN(vec3 p, vec3 n, float sc) {
        vec3 w = pow(abs(n), vec3(12.0)); w /= (w.x + w.y + w.z);
        vec3 tx = texture(tRockN, p.zy / sc).xyz * 2.0 - 1.0;
        vec3 ty = texture(tRockN, p.xz / sc).xyz * 2.0 - 1.0;
        vec3 tz = texture(tRockN, p.xy / sc).xyz * 2.0 - 1.0;
        tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
        ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
        tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
        return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
      }
      float rockCrack(vec3 p) {
        // joint lines: thin dark seams where two noise fields cross mid-value, a few per metre at most
        float a = vnoise(vec2(dot(p, vec3(0.71, 0.3, 0.6)), dot(p, vec3(-0.25, 0.9, 0.33))) * 0.9);
        float b = vnoise(vec2(dot(p, vec3(-0.6, 0.45, 0.66)), dot(p, vec3(0.5, 0.2, -0.84))) * 1.6 + 3.7);
        return max(smoothstep(0.035, 0.0, abs(a - 0.5)), 0.7 * smoothstep(0.025, 0.0, abs(b - 0.5)) * step(0.45, a));
      }`,
    onShader: (sh) => {
      sh.uniforms.tRockA = { value: surf.rock || null };
      sh.uniforms.tRockN = { value: surf.rockN || null };
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 wn0 = normalize(inverseTransformDirection(normal, viewMatrix));
          float camD = length(vWPos - cameraPosition);
          vec3 wn1 = rockTriN(vWPos, wn0, 4.6);
          // the finer grain only where it resolves (close ledges)
          vec3 wn2 = rockTriN(vWPos + 3.1, wn1, 0.8);
          vec3 wnP = normalize(mix(wn1, wn2, 0.55 * smoothstep(30.0, 6.0, camD)));
          normal = normalize((viewMatrix * vec4(wnP, 0.0)).xyz);
        }`);
    },
    fragColor: /* glsl */ `
      #include <color_fragment>
      // smooth world normal: snow and moss follow the rounded form, not individual triangles
      vec3 wn = normalize(inverseTransformDirection(normalize(vNormal), viewMatrix));
      float n1 = fbm2(vWPos.xz*0.8 + vWPos.y*0.6);
      float n2 = vnoise(vec2(vWPos.x+vWPos.z, vWPos.y)*3.0);
      // weathered granite: warm grey-brown, as the reference's ledge, not slate blue
      vec3 base = mix(srgbR(vec3(128,118,104)), srgbR(vec3(98,90,80)), n1);
      base = mix(base, srgbR(vec3(130,112,90)), smoothstep(0.6, 0.8, vnoise(vec2(vWPos.y*1.5, vWPos.x*0.2))) * 0.6);
      {
        vec3 w = pow(abs(wn), vec3(12.0)); w /= (w.x + w.y + w.z);   // (a narrow blend: two projections of the scan's grain crossed into a weave on oblique faces)
        // (a wider lay of the scan: at 2.6 m it tiled in plain panels across any crag bigger than a boulder)
        vec3 ra = texture(tRockA, vWPos.zy / 4.6).rgb * w.x + texture(tRockA, vWPos.xz / 4.6).rgb * w.y + texture(tRockA, vWPos.xy / 4.6).rgb * w.z;
        // (a second lay of the scan, turned and shifted, mixed in by patches: one lay repeats as a weave on any flat face)
        {
          vec3 q2 = vWPos / 7.3 + 0.41;   // (not turned: its grain crossed the first lay's into a weave)
          vec3 ra2 = texture(tRockA, q2.zy).rgb * w.x + texture(tRockA, q2.xz).rgb * w.y + texture(tRockA, q2.xy).rgb * w.z;
          ra = mix(ra, ra2, smoothstep(0.46, 0.54, vnoise(vWPos.xz / 6.0 + vWPos.y / 5.0)));
        }
        // and the scan again at ledge scale, so a big outcrop is not one tile repeated
        vec3 rb = texture(tRockA, vWPos.zy / 23.0 + 0.37).rgb * w.x + texture(tRockA, vWPos.xz / 23.0 + 0.37).rgb * w.y + texture(tRockA, vWPos.xy / 23.0 + 0.37).rgb * w.z;
        base *= clamp(dot(ra, vec3(0.2126, 0.7152, 0.0722)) / 0.13, 0.35, 2.2) * mix(1.0, clamp(dot(rb, vec3(0.2126, 0.7152, 0.0722)) / 0.13, 0.55, 1.6), 0.6);
      }
      base *= 0.85 + 0.2*n2;
      // close to, the stone has grain: crystal-sized speckle and pitting the half-metre scan cannot carry
      {
        float nearR = smoothstep(26.0, 5.0, length(vWPos - cameraPosition));
        float grain = vnoise(vWPos.xz * 61.0 + vWPos.y * 47.0) * 0.6 + vnoise(vWPos.xy * 143.0 - vWPos.z * 97.0) * 0.4;
        base *= mix(1.0, 0.72 + 0.56 * grain, nearR);
      }
      // dark joint seams
      // (faint: dark winding seams at full strength read as the veins of wet marble, not jointed granite)
      float jointK = rockCrack(vWPos) * smoothstep(40.0, 8.0, length(vWPos - cameraPosition));
      base *= 1.0 - 0.22 * jointK;
      vec4 rcl = climateAt(vWPos.xz);
      float moss = smoothstep(0.55, 0.85, wn.y + (n1-0.5)*0.6) * (1.0 - rcl.a) * (1.0 - smoothstep(0.12, 0.4, rcl.r));   // no green moss in the snow country
      base = mix(base, srgbR(vec3(62,70,38)) * (0.8 + 0.4 * n2), moss * 0.7);
      base = mix(base, base * vec3(1.35, 0.85, 0.62), rcl.a);                 // desert: red sandstone
      // snow only lodges on flat tops and ledges, broken up; the faces stay rock with pale lichen
      // (a broad, noisy threshold: on a flat granite facet a tight one laid down a hard-edged white slab)
      float rsnow = smoothstep(0.35, 0.75, rcl.r) * smoothstep(0.55, 0.95, wn.y + (n1 - 0.5) * 0.7 + 0.35 * (n2 - 0.5) + 0.2 * (vnoise(vWPos.xz * 4.0) - 0.5)) * 0.9;
      // in drifts and crusts, not a smooth white cap: the grey stone and its lichen show through
      // (round grains of one size on a noise grid read as polka dots on a big ledge; these are torn, mixed-size flecks)
      // clean patches of old snow lying on the flats, with a ragged edge; elsewhere only a sparse frost of flecks
      float fleck = smoothstep(0.74, 0.8, vnoise(vWPos.xz * 7.0 + vWPos.y * 5.0) * 0.55 + vnoise(vWPos.xz * 19.0 - vWPos.y * 11.0) * 0.45) * smoothstep(0.1, 0.5, wn.y);
      float drift = smoothstep(0.4, 0.52, fbm2(vWPos.xz * 0.45 + vWPos.y * 0.3 + 7.0) + 0.1 * (vnoise(vWPos.xz * 6.0) - 0.5));
      // (a boulder's crown out in the snowfields keeps its cap: bare-topped boulders read as dark slabs on the snow)
      #ifdef BARE_LEDGE
      rsnow = max(rsnow * max(drift, 0.7 * fleck), 0.62 * smoothstep(0.35, 0.75, rcl.r) * smoothstep(0.88, 0.98, wn.y) * smoothstep(0.3, 0.6, n1 + 0.3 * n2));   // (and lying on the flat tops, in patches)
      base *= vec3(1.34, 1.27, 1.16);   // weathered grey ledge granite, a little warm
      #else
      rsnow *= max(max(drift, 0.7 * fleck), smoothstep(0.8, 0.95, wn.y + 0.1 * (n2 - 0.5)));
      #endif
      float lichen = smoothstep(0.55, 0.75, vnoise(vWPos.xz * 1.7 + vWPos.y * 2.3)) * (1.0 - rsnow) * smoothstep(0.2, 0.6, rcl.r);
      base = mix(base, srgbR(vec3(146,142,130)), lichen * 0.28);               // pale grey crust lichen (stronger and greener it read as algae)
      // and the warm ochre crust lichen of the reference's granite, in scattered rosettes
      float ochre = smoothstep(0.7, 0.82, vnoise(vWPos.xz * 2.3 - vWPos.y * 1.9 + 5.0)) * (1.0 - rsnow) * smoothstep(0.2, 0.6, rcl.r);
      base = mix(base, srgbR(vec3(150,128,82)), ochre * 0.45);
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
    const cb = conBarkTextures(6, [92, 76, 64], quality >= 2 ? 512 : 256, quality >= 2 ? 1024 : 512);
    const pineBark = windMaterial(new THREE.MeshStandardMaterial({ map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.92 }), 0);
    // ponderosa: cinnamon-orange plates between dark fissures (the grey-brown spruce bark on the pines read as
    // smooth grey poles down a sunlit forest)
    const cbP = conBarkTextures(11, [82, 60, 48], quality >= 2 ? 512 : 256, quality >= 2 ? 1024 : 512);
    const ponderosaBark = windMaterial(new THREE.MeshStandardMaterial({ map: cbP.map, normalMap: cbP.normalMap, normalScale: new THREE.Vector2(1.9, 1.9), roughness: 0.9 }), 0);
    // leaves and needles are near-matte: without this, card normals at grazing angles mirror the bright sky
    // (Fresnel) and every bough reads frosted
    const leafExtra = { onShader: (s) => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', LEAF_EMISSIVE)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor *= 0.25; material.specularF90 = 0.18;'); } };
    const oakTex = [leafCardTexture(11, 82), leafCardTexture(12, 70), leafCardTexture(13, 92)];
    const pineTex = pineCardTexture(3);
    const cypTex = leafCardTexture(21, 100);
    const mossTex = mossTexture();
    // (alpha to coverage softened the card edges but thinned every distant crown into a see-through snag)
    const leafMat = (map, color = 0xc4ccb0, autumn = false, trans = null, backDark = null, env = 0.4, conifer = false) => windMaterial(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color, vertexColors: true, envMapIntensity: env }), 1, leafExtra, { autumn, trans, backDark, conifer });

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
    // matte needles: no sky sheen; against the sun the boughs are dark but their thin edges glow olive-gold
    // (a warmer, deeper green than the old grey-blue)
    const pineMat = leafMat(pineTex, 0x9fb088, false, 0.32, 0.38, 0.15, true);
    // ponderosa and lodgepole carry their needles in tufts
    const tuftTex = pineTuftTexture(7), tuftMat = leafMat(tuftTex, 0xa8b48a, false, 0.32, 0.38, 0.15, true);
    for (let i = 0; i < 4; i++) {
      const b = buildPine(300 + i * 23);
      this.treeBuilds.push({ kind: 'pine', height: b.height, parts: [
        { geometry: b.wood, material: ponderosaBark },
        { geometry: b.leaves, material: tuftMat, depth: windDepthMaterial(tuftTex, 1) },
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
    const G = (this.groups = { oak: [0, 1, 2, 3], pine: [4, 5, 6, 7], cypress: [8, 9], tall: [], fir: [], palm: [], jungle: [], cactus: [], snag: [] });
    const addB = (group, kind, b, parts) => { G[group].push(this.treeBuilds.length); this.treeBuilds.push({ kind, height: b.height, parts }); };
    for (let i = 0; i < 4; i++) {
      const b = buildPine(700 + i * 29, 'tall');
      addB('tall', 'pine', b, [{ geometry: b.wood, material: ponderosaBark }, { geometry: b.leaves, material: tuftMat, depth: windDepthMaterial(tuftTex, 1) }]);
    }
    // dead snags, silver-grey and barkless
    const snagMat = windMaterial(new THREE.MeshStandardMaterial({ map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), color: new THREE.Color(1.55, 1.5, 1.45), roughness: 0.95 }), 0);   // weathered silver-grey
    for (let i = 0; i < 2; i++) { const b = buildSnag(1300 + i * 41); addB('snag', 'pine', b, [{ geometry: b.wood, material: snagMat }]); }
    // tree wells: under a snow-loaded spruce the boughs shelter a hollow of shaded, shallower snow round the trunk,
    // which seats every tree in the snowfield instead of leaving it standing on the white like a cut-out
    const wellTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 63);
      gr.addColorStop(0, 'rgb(230,230,230)'); gr.addColorStop(0.45, 'rgb(150,150,150)'); gr.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const wellMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8796ac, alphaMap: wellTex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), {
      fragColor: '#include <color_fragment>\n diffuseColor.a *= 0.55 * smoothstep(0.45, 0.8, climateAt(vWPos.xz).r);',
    });
    const wellGeo = new THREE.CircleGeometry(2.3, 28).rotateX(-Math.PI / 2).translate(0, 0.07, 0);
    for (let i = 0; i < 5; i++) {
      const b = buildPine(760 + i * 31, 'fir');
      addB('fir', 'pine', b, [{ geometry: b.wood, material: pineBark }, { geometry: b.leaves, material: pineMat, depth: windDepthMaterial(pineTex, 1) },
        { geometry: wellGeo, material: wellMat, castShadow: false }]);
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
    this.trees.lean = 0.065;   // (more: a stand of plumb trunks read as a colonnade)

    // bushes / ferns
    const bushBuilds = [];
    for (let i = 0; i < 3; i++) {
      const rnd = mulberry32(900 + i);
      const cards = [];
      const c = new THREE.Vector3(0, 0.5, 0);
      for (let k = 0; k < 7; k++) cards.push(cardGeo(1.3 + rnd() * 0.6, new THREE.Vector3((rnd() - 0.5) * 1.2, 0.45 + rnd() * 0.5, (rnd() - 0.5) * 1.2), c, rnd, 1, 0.9));
      const g = leafAO(setSway(mergeGeometries(cards), (x, y) => y * 0.25));
      // (thin leaves that glow when the sun is behind them)
      bushBuilds.push({ parts: [{ geometry: g, material: leafMat(oakTex[i % 3], 0xb4bca0, true, 0.42, 0.14), depth: windDepthMaterial(oakTex[i % 3], 1) }] });
    }
    // ferns (3, 4), big-leaf jungle plants (5, 6), dry scrub (7, 8)
    const fernT = fernTexture(), fernMat = leafMat(fernT, 0xb8bc9e);   // (muted: a saturated card green reads as pasted on)
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
    // bunchgrass tufts (9) that keep their straw and ochre in the snow, and tall frosted dead stalks (10)
    {
      const tuftT = tuftTexture(), stalkT = stalkTexture();
      const grassTuftMat = windMaterial(new THREE.MeshStandardMaterial({ map: tuftT, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92, vertexColors: true, envMapIntensity: 0.4 }), 1, leafExtra, { frost: true });   // (frosted and pale in the snow: bare straw read as cloned orange rosettes)
      const stalkMat = windMaterial(new THREE.MeshStandardMaterial({ map: stalkT, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92, vertexColors: true, envMapIntensity: 0.4 }), 1, leafExtra);
      const fan = (seed, n, w, h, tilt) => {
        const rnd = mulberry32(seed), cs = [];
        for (let k = 0; k < n; k++) { const g = new THREE.PlaneGeometry(w * (0.8 + rnd() * 0.4), h * (0.75 + rnd() * 0.5)); g.translate(0, g.parameters.height * 0.5, 0); g.rotateX((rnd() - 0.5) * tilt); g.rotateY((k / n) * Math.PI + rnd() * 0.5); cs.push(g); }
        const tg = setSway(mergeGeometries(cs), (x, y) => y * 0.35), tp = tg.attributes.position, tc = new Float32Array(tp.count * 3);
        for (let k = 0; k < tp.count; k++) tc[k * 3] = tc[k * 3 + 1] = tc[k * 3 + 2] = 0.6 + 0.4 * Math.min(1, tp.getY(k) / h);
        tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
        return tg;
      };
      bushBuilds.push({ parts: [{ geometry: fan(1010, 6, 0.85, 0.7, 0.5), material: grassTuftMat, castShadow: false }] });
      bushBuilds.push({ parts: [{ geometry: fan(1020, 3, 0.5, 1.2, 0.3), material: stalkMat, castShadow: false }] });
    }
    this.bushes = new ScatterLayer(scene, bushBuilds, Math.round(6000 * Math.max(1, quality * quality)), 140 * Math.sqrt(quality));
    // fallen logs on forest floors
    // an old fallen trunk: grey weathered bark, moss and lichen along its upper side (the trees' own bark, laid on
    // its side, read as a striped tube)
    const logMat = windMaterial(new THREE.MeshStandardMaterial({ map: cb.map, normalMap: cb.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), color: new THREE.Color(0.95, 0.9, 0.86), roughness: 0.96 }), 0, {
      fragColor: `#include <color_fragment>
        {
          vec3 wn = normalize(inverseTransformDirection(normalize(vNormal), viewMatrix));
          float n1 = fbm2(vWPos.xz * 1.6 + vWPos.y * 2.0), n2 = vnoise(vWPos.xz * 9.0 + vWPos.y * 7.0);
          diffuseColor.rgb *= 0.75 + 0.5 * n1;
          float moss = smoothstep(0.25, 0.75, wn.y + (n1 - 0.5) * 0.9) * (1.0 - smoothstep(0.3, 0.6, climateAt(vWPos.xz).r));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.085, 0.03) * (0.7 + 0.7 * n2), moss * 0.7);
        }` });
    const logBuilds = [0, 1, 2].map((i) => ({ parts: [{ geometry: buildLog(1100 + i * 13), material: logMat }] }));
    this.logs = new ScatterLayer(scene, logBuilds, 1200, 170 * Math.sqrt(quality));

    // rocks
    const rMat = rockMaterial(surf), rMatBare = rockMaterial(surf, true);
    rMatBare.envMapIntensity = 1.25;   // (open to the whole sky on a summit: at the boulders' 0.55 its shaded faces went near black)
    // 4 and 5: the fractured blocks again in wind-scoured bare granite, for lookout ledges
    // (the ledge blocks are cut by twice the joint planes, deeper: split granite with flat faces and hard edges, not
    // rounded lumps)
    const rockBuilds = [0, 1, 2, 3, 4, 5].map((i) => ({ parts: [{ geometry: i >= 4 ? rockGeometry(i + 7, true, 5, 14, 0.1) : rockGeometry(i + 3, i >= 2), material: i >= 4 ? rMatBare : rMat }] }));
    // 6-8: outcrop blocks for a lookout's own ledge, stood several metres tall beside the lens: cut right through by
    // many joint planes into stacked, square-shouldered blocks (the boulders above, scaled up, are smooth domes)
    for (const sd of [31, 47, 58]) rockBuilds.push({ parts: [{ geometry: rockGeometry(sd, true, 6, 30, 0.34), material: rMatBare }] });
    this.rocks = new ScatterLayer(scene, rockBuilds, 3000, 420);
    // crags: big split granite blocks breaking out of the steep snowy mountainsides, drawn out to the far slopes so
    // the faces read as rock with snow on its ledges rather than a smooth heightfield
    // (jointed blocks with hard edges and flat tops for the snow to lie on: the rounded boulder, scaled up to a crag,
    // was a pillow with a white cap)
    const cragBuilds = [5, 6, 9].map((sd) => ({ parts: [{ geometry: rockGeometry(sd + 40, true, 5, 22, 0.28).scale(1.7, 1.5, 1.7), material: rMat }] }));
    this.crags = new ScatterLayer(scene, cragBuilds, 6000, 2600);

    this.quality = quality;
    this.scatter();
    this.dressHomesteads();

    // impostors for every tree
    this.atlas = renderImpostorAtlas(renderer, this.treeBuilds, this.treeBuilds.length);
    this.buildImpostors(scene);

    // grass
    this.grass = [];
    if (quality > 0) {
      const q = quality;
      // (clump counts grow with the square of this: past 1.5 the lawn costs a third of the frame for little gain)
      const gq = Math.min(q, 1.5);
      this.grass.push(makeGrass(scene, 0.3 / Math.sqrt(gq), 28, 0.6, 0));
      this.grass.push(makeGrass(scene, 0.7 / Math.sqrt(gq), 85, 1.2, 24));
      // forest-floor clutter
      const cone = (() => {
        // (an ovoid, as a fallen cone is: the pointed cone primitive lay about the floor as dark triangular chips)
        const c = new THREE.SphereGeometry(0.036, 7, 5); c.scale(1.75, 0.95, 1); c.translate(0, 0.03, 0);
        const p = c.attributes.position, col = new Float32Array(p.count * 3);
        // (vertex colours are linear: these are dark, weathered cone browns, not the pale chips they read as before)
        for (let i = 0; i < p.count; i++) { const v = 0.7 + 0.3 * ((i * 7) % 5) / 4; col[i * 3] = 0.2 * v; col[i * 3 + 1] = 0.135 * v; col[i * 3 + 2] = 0.085 * v; }
        c.setAttribute('color', new THREE.BufferAttribute(col, 3)); return c;
      })();
      // a fallen twig: a bent stick with two side shoots (a plain cylinder read as a dropped dowel), and a longer
      // dead bough with its branchlets
      const stick = (segs) => mergeGeometries(segs.map(([ax, az, bx, bz, r0, r1, y]) => { const L = Math.hypot(bx - ax, bz - az); const t = new THREE.CylinderGeometry(r1, r0, L, 5); t.rotateZ(Math.PI / 2); t.rotateY(-Math.atan2(bz - az, bx - ax)); t.translate((ax + bx) / 2, y ?? 0.018, (az + bz) / 2); return t; }));
      const twig = stick([[-0.5, 0, 0.04, 0.035, 0.016, 0.013], [0.04, 0.035, 0.5, -0.05, 0.013, 0.006], [-0.12, 0.01, 0.16, 0.2, 0.009, 0.004], [0.14, 0.03, 0.36, -0.17, 0.008, 0.003]]);
      const bough = stick([[-1.4, 0, -0.3, 0.1, 0.045, 0.036, 0.04], [-0.3, 0.1, 0.8, -0.05, 0.036, 0.024, 0.035], [0.8, -0.05, 1.5, 0.12, 0.024, 0.01, 0.03], [-0.7, 0.05, -0.2, 0.55, 0.02, 0.008, 0.05], [0.1, 0.06, 0.7, -0.5, 0.018, 0.007, 0.06], [0.5, -0.02, 0.95, 0.4, 0.014, 0.005, 0.07], [-1.0, 0.02, -0.75, -0.4, 0.016, 0.006, 0.05]]);
      const stone = (() => {
        const st = new THREE.IcosahedronGeometry(0.5, 1), p = st.attributes.position;
        for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k); }
        st.computeVertexNormals(); st.translate(0, 0.12, 0); return st;
      })();
      this.clutter = [
        // (denser: clustering leaves bare duff between the drifts of cones and fallen sticks)
        makeClutter(scene, cone, { spacing: 0.8 / Math.sqrt(q), radius: 24, smin: 0.6, smax: 1.3, color: 0xffffff, seed: 3 }),
        // (weathered grey-brown and plentiful: the reference's floor is strewn with them)
        makeClutter(scene, twig, { spacing: 0.62 / Math.sqrt(q), radius: 28, smin: 0.3, smax: 1.3, color: 0x8a7964, flat: true, seed: 5 }),
        makeClutter(scene, bough, { spacing: 4.6 / Math.sqrt(q), radius: 44, smin: 0.6, smax: 1.3, color: 0x74624e, flat: true, seed: 11 }),
        makeClutter(scene, stone, { spacing: 1.7 / Math.sqrt(q), radius: 36, smin: 0.08, smax: 0.42, color: 0x5a554c, roughness: 0.9, mode: 'stone', seed: 9 }),
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
    const rc = w.rng(91);   // the crags draw from their own stream so the rest of the scatter is unchanged
    const range = HALF - 40;
    for (let z = -range; z < range; z += cell) for (let x = -range; x < range; x += cell) {
      const px = x + r() * cell, pz = z + r() * cell;
      const sp = w.splatAt(px, pz);
      const h = w.heightAt(px, pz);
      if (h < 0.4 || h > 980) { r(); r(); continue; }
      if (sp.road > 0.1) {
        // trail verges: ferns and scrub crowd the edges of forest tracks (never the wheel line itself)
        if (pz < -700 && !blocked(px, pz)) {
          const cl0 = w.climateAt(px, pz);
          if (cl0.snow < 0.4 && cl0.jungle < 0.4) for (let k = 0; k < 7; k++) {
            const bx = x + r() * cell, bz = z + r() * cell, rs = w.splatAt(bx, bz);
            if (rs.road > 0.05 && rs.road < 0.55 && r() < 0.6) this.bushes.add(bx, w.heightAt(bx, bz) - 0.05, bz, r() * 6.28, 0.45 + r() * 0.6, r() < 0.75 ? 3 + Math.floor(r() * 2) : 7 + Math.floor(r() * 2));
          }
        }
        continue;
      }
      const cl = w.climateAt(px, pz);
      const n = w.normalAt(px, pz);
      // boulder fields: talus and erratics gather in clusters rather than dotting the ground evenly
      const field = cl.snow > 0.3 ? THREE.MathUtils.smoothstep(w.n2.noise(px / 70 + 3.1, pz / 70 - 7.7), 0.15, 0.55) : 0;
      const boulders = ((pz < -700 ? 2.2 : 1) + cl.snow) * (1 + 7 * field);
      // firs cling to steeper ground in the mountains than broadleaf trees do lower down
      const steep = cl.snow > 0.4 ? 0.62 : cl.jungle > 0.4 ? 0.5 : 0.75;
      if (n.y < 0.72 && cl.snow > 0.4 && rc() < 0.05 * (1 - n.y)) { const sc = 4 + rc() * 12; this.crags.add(px, h - sc * 0.62, pz, rc() * 6.28, sc, Math.floor(rc() * 3)); }
      if (n.y < steep) { if (r() < 0.012 * boulders) { const sc = 1 + r() * 3.5; this.rocks.add(px, h - 0.3 - sc * 0.55 * (1 - n.y), pz, r() * 6.28, sc, Math.floor(r() * 4)); } continue; } // sunk into the slope, not perched on it
      if (cl.snow > 0.4 && n.y < 0.75 && !blocked(px, pz) && r() < sp.forest * 0.5) {
        this.trees.add(px, h - 0.3, pz, r() * 6.28, 0.6 + r() * 0.7, pick(G.fir));
        continue;
      }
      // jungle ridges: rainforest clings to steep ground, with ferns and big-leaf plants beneath
      if (cl.jungle > 0.4 && n.y < 0.75 && !blocked(px, pz)) {
        if (r() < 0.55) this.trees.add(px, h - 0.4, pz, r() * 6.28, 0.7 + r() * 0.6, r() < 0.15 ? pick(G.palm) : pick(G.jungle));
        else if (r() < 0.7) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.8 + r() * 1.0, r() < 0.6 ? 5 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2));
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
      // (a flat background chance sprinkled lone trees evenly over open snow like pepper; up there trees keep to stands)
      // in the mountains a thinning forest ends in clean stand edges rather than an even stipple of lone trees
      // (and inside a stand the spruce grow close: a sparse stand left the darkened ground under it showing as grey
      // camouflage patches across the mountainsides, with too few trees on them to read as forest)
      const fK = cl.snow > 0.45 ? THREE.MathUtils.smoothstep(sp.forest, 0.22, 0.62) : sp.forest;
      let p = fK * (cl.snow > 0.45 ? 1.0 : cl.jungle > 0.45 ? 0.95 : 0.6) + (cl.snow > 0.45 ? 0.0015 : 0.012);
      // trees grow in clumps and thickets with gaps between them, not one to every grid cell
      p *= 0.35 + 1.3 * THREE.MathUtils.smoothstep(w.n3.noise(px / 28 + 7.7, pz / 28 - 3.1), -0.45, 0.55);
      if (blocked(px, pz)) p = 0;
      if (r() < p) {
        let v;
        const beach = h < 7 && (cl.jungle > 0.3 || pz > 2900);
        if (beach) v = pick(G.palm);
        else if (cl.jungle > 0.45) v = r() < 0.28 ? pick(G.palm) : pick(G.jungle);
        else if (swamp) v = pick(G.cypress);
        else if (cl.snow > 0.45) v = r() < 0.01 ? pick(G.snag) : pick(G.fir);
        // the pine belt is open lodgepole/ponderosa forest: tall clear boles with high crowns, a few full-skirted
        // spruce and young firs among them
        else if (pz < -700) v = r() < 0.04 ? pick(G.snag) : r() < 0.8 ? pick(G.tall) : r() < 0.65 ? pick(G.pine) : pick(G.fir);
        else if (cl.autumn > 0.4) v = r() < 0.78 ? pick(G.oak) : pick(G.pine);
        else if (h > 70) v = pick(G.pine);
        else v = r() < 0.75 ? pick(G.oak) : pick(G.pine);
        if (sp.forest < 0.2 && cl.jungle < 0.4 && !swamp && cl.snow < 0.45 && pz > -700) v = pick(G.oak); // lone meadow oaks
        // spruce stands of mixed ages, the mature trees 20 m and more (smaller, a valley's timber read as pepper)
        let s = cl.snow > 0.45 ? 0.72 + r() * r() * 1.2 + r() * 0.4 : 0.8 + r() * 0.5;
        // the pine belt's middle storey: young full-skirted firs among the tall clear boles, and the mature pines
        // of mixed ages (one size of tall pine in an even stand read as planted poles)
        if (pz < -700 && cl.snow <= 0.45 && cl.jungle <= 0.45 && !swamp && !beach) {
          if (rc() < 0.15) { v = G.fir[Math.floor(rc() * G.fir.length)]; s = 0.42 + rc() * 0.45; } else s *= 0.68 + rc() * 0.46;
        }
        this.trees.add(px, h - 0.2, pz, r() * 6.28, s, v);
        // the pine woods' floor is shrubby under the trees too (tree cells used to skip their undergrowth, leaving
        // bare duff wherever the stand was dense)
        if (pz < -700 && cl.snow < 0.4 && cl.desert < 0.3) {
          const ur = rc();
          const nu = ur < 0.85 ? 2 + Math.floor(rc() * 4) : 0;
          for (let b = 0; b < nu; b++) {
            const a = rc() * 6.28, d = 1.8 + rc() * 5, bx = px + Math.cos(a) * d, bz = pz + Math.sin(a) * d;
            const t = rc();
            this.bushes.add(bx, w.heightAt(bx, bz) - 0.05, bz, rc() * 6.28, t < 0.5 ? 0.7 + rc() * 0.8 : 0.8 + rc() * 0.9, t < 0.5 ? Math.floor(rc() * 3) : t < 0.92 ? 3 + Math.floor(rc() * 2) : 7 + Math.floor(rc() * 2));
          }
        }
        // closed-canopy stands on capable machines: a second, younger tree in every dense cell
        if ((this.quality || 1) >= 1.5 && sp.forest > 0.55 && !blocked(px, pz)) {
          const qx = x + ((px - x + cell * 0.5) % cell), qz = z + ((pz - z + cell * 0.5) % cell);
          const qh = w.heightAt(qx, qz);
          if (w.normalAt(qx, qz).y > 0.62 && w.splatAt(qx, qz).road < 0.1) this.trees.add(qx, qh - 0.2, qz, (px + pz) % 6.28, s * (0.55 + 0.35 * ((px * 7.31) % 1 + 1) % 1), v);
        }
        continue;
      }
      if (blocked(px, pz, -20)) continue;
      // ground cover by biome
      // the pine belt keeps its undergrowth right out to the trail edges, where the light gets in
      const under = 0.05 + (pz < -700 && cl.snow < 0.4 ? Math.max(sp.forest, 0.5) : sp.forest) * 0.45;
      if (cl.jungle > 0.4) {
        if (r() < under * 2.6) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.8 + r() * 1.1, r() < 0.6 ? 5 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2));
      } else if (cl.snow > 0.5) {
        // dark boulders standing out of the snow, and dry alpine brush poking through in clumps
        if (r() < 0.012 + 0.05 * field) { const sc = 0.6 + r() * 1.8; this.rocks.add(px, h - 0.35 - sc * 0.3, pz, r() * 6.28, sc, Math.floor(r() * 4)); }   // half buried in the snow
        const brush = THREE.MathUtils.smoothstep(w.n.noise(px / 45 - 2.2, pz / 45 + 5.3), 0.1, 0.6);
        const nb = r() < 0.04 + 0.5 * brush ? 1 + Math.floor(r() * 3 * brush) : 0;
        for (let b = 0; b < nb; b++) {
          const bx = px + (r() - 0.5) * 5, bz = pz + (r() - 0.5) * 5;
          this.bushes.add(bx, w.heightAt(bx, bz) - 0.08, bz, r() * 6.28, 0.5 + r() * 0.7, [7, 8, 9, 9, 7][Math.floor(r() * 5)]);   // (no lone dead stalks: out on the snow they read as black stakes)
        }
      } else if (pz < -700) {
        // undergrowth in patches: fern beds and scrub where light gets through, bare litter elsewhere
        const patch = THREE.MathUtils.smoothstep(w.n.noise(px / 30 + 1.7, pz / 30 - 4.4), -0.2, 0.5);
        const qd = (this.quality || 1) >= 2 ? 1.8 : 1;   // cinematic: lush, layered understorey
        // (denser, and a mix: low leafy huckleberry-like shrubs, fern beds, a little dead brush, in drifts across the
        // whole floor rather than lining the trail)
        const nb = r() < Math.min(0.97, (under + 0.18) * (0.7 + 2.4 * patch) * qd) ? 1 + Math.floor(r() * (4 + qd) * (0.35 + patch)) : 0;
        for (let b = 0; b < nb; b++) {
          const bx = px + (r() - 0.5) * 7, bz = pz + (r() - 0.5) * 7;
          const t = r();
          this.bushes.add(bx, w.heightAt(bx, bz) - 0.05, bz, r() * 6.28, t < 0.45 ? 0.7 + r() * 0.8 : 0.7 + r() * 0.9, t < 0.45 ? Math.floor(r() * 3) : t < 0.87 ? 3 + Math.floor(r() * 2) : 7 + Math.floor(r() * 2));
        }
      } else if (r() < under) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.6 + r() * 0.8, Math.floor(r() * 3));
      // saplings and young firs filling the gaps between the big trees
      if (sp.forest > 0.3 && cl.jungle < 0.4 && cl.desert < 0.3 && (pz < -700 || cl.snow > 0.4) && r() < (pz < -700 && cl.snow < 0.4 ? 0.1 : 0.05) * sp.forest) {
        this.trees.add(px, h - 0.1, pz, r() * 6.28, 0.22 + r() * 0.3, r() < 0.6 ? pick(G.fir) : pick(G.pine));
        continue;
      }
      // fallen logs under forest
      if (sp.forest > 0.35 && cl.jungle < 0.5 && cl.snow < 0.4 && r() < (pz < -700 ? 0.04 : 0.018) * sp.forest) this.logs.add(px, h - 0.1, pz, r() * 6.28, 0.8 + r() * 0.5, Math.floor(r() * 3));
      // (the pine woods are strewn with mossy granite: boulders half sunk in the duff)
      if (r() < ((pz < -700 && cl.snow < 0.4 ? 0.016 : 0.006) + (1 - n.y) * 0.05) * boulders) { const sc = 0.4 + r() * 2.2; this.rocks.add(px, h - 0.2 - sc * 0.25, pz, r() * 6.28, sc, Math.floor(r() * 4)); }
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
      // cinematic: billboards carry on out to ~4 km (beyond the old 1.25 km the far forest was only a grey tint
      // on the ground, which read as camouflage blotches with no trees on them)
      uniforms: { ...U, uAtlas: { value: this.atlas.texture }, uCols: { value: this.treeBuilds.length }, uHeights: { value: hs }, uNear: { value: this.nearRadius }, uFar: { value: (this.quality || 1) >= 2 ? 4200 : 1250 } },
      vertexShader: /* glsl */ `
        attribute vec4 aTree;
        uniform float uCols;
        uniform float uHeights[${this.treeBuilds.length}];
        uniform float uNear;
        uniform float uFar;
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
          h *= smoothstep(uFar, uFar * 0.72, d); // far trees sink smoothly into the canopy-tinted terrain
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
          // rainforest crowns read lush and mid-green from afar, not black
          alb = mix(alb, alb * vec3(0.9, 1.25, 0.8) * 1.6, icl.g);
          // snow on the upper boughs, fading out with distance: a few-pixel tree with a white cap is what turns a
          // far forest into salt-and-pepper speckle
          float dCam = length(cameraPosition - vW);
          alb = mix(alb, vec3(0.84, 0.87, 0.92), smoothstep(0.35, 0.8, icl.r) * smoothstep(-0.5, 0.4, q.y + 0.5 * (hash12(floor(vUv * 90.0)) - 0.5)) * 0.32 * smoothstep(520.0, 220.0, dCam));   // (whiter, the crown vanished into the snow and fog and left a bare pin)
          vec3 toCam = normalize(cameraPosition - vW);
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
          vec3 N = normalize(right * q.x * 0.8 + vec3(0.0, 0.55 + 0.35 * q.y, 0.0) + toCam * 0.6);
          float ndl = max(dot(N, normalize(uSunDir)), 0.0);
          float ao = 0.55 + 0.45 * smoothstep(-0.6, 0.8, q.y);
          vec3 col = alb * (uSunColor * ndl * 0.13 * terrainSunShadow(vW + vec3(0.0, 2.0, 0.0)) + uFogColor * 0.24 * ao + vec3(0.005));
          // far trees take on the shading of the canopy-tinted terrain they sink into, so the fade band
          // reads as forest texture rather than pale or black specks
          float farK = smoothstep(mix(620.0, 260.0, smoothstep(0.4, 0.8, icl.r)), mix(1050.0, 640.0, smoothstep(0.4, 0.8, icl.r)), length(cameraPosition - vW));
          if (farK > 0.0) {
            float cn = fbm2(vW.xz / 18.0);
            vec3 cAlb = mix(pow(vec3(34.0, 46.0, 26.0) / 255.0, vec3(2.2)), pow(vec3(52.0, 62.0, 32.0) / 255.0, vec3(2.2)), cn);
            cAlb = mix(cAlb, mix(pow(vec3(26.0, 50.0, 20.0) / 255.0, vec3(2.2)), pow(vec3(40.0, 68.0, 26.0) / 255.0, vec3(2.2)), cn), icl.g);
            cAlb = mix(cAlb, mix(pow(vec3(124.0, 58.0, 22.0) / 255.0, vec3(2.2)), pow(vec3(158.0, 112.0, 32.0) / 255.0, vec3(2.2)), cn), icl.b * 0.85);
            cAlb = mix(cAlb, pow(vec3(30.0, 38.0, 36.0) / 255.0, vec3(2.2)), smoothstep(0.4, 0.8, icl.r));   // matches the snow-country canopy
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

  // after a shot's dressing clears trees or sets new ones down, re-pack the billboards from the current list (the
  // far forest is all billboards: a cleared sightline or a cleared homestead yard otherwise kept its distant trees)
  refreshImpostors() {
    if (!this.impostors) return;
    const items = this.trees.items, g = this.impostors.geometry, a = new Float32Array(Math.max(1, items.length) * 4);
    items.forEach((it, i) => { a[i * 4] = it.x; a[i * 4 + 1] = it.y; a[i * 4 + 2] = it.z; a[i * 4 + 3] = it.v + Math.min(it.s, 3.99) / 4; });
    g.setAttribute('aTree', new THREE.InstancedBufferAttribute(a, 4));
    g.instanceCount = items.length;
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
    this.crags.update(camPos, force);
    this.logs.update(camPos, force);
  }
}
