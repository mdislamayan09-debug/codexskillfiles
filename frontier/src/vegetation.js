// Vegetation: GPU grass fields, procedural trees (oak / pine / cypress) with distant impostors,
// bushes, ferns and rocks. Everything is instanced and streamed around the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, GLSL_COMMON, GLSL_FOG_PARS, GLSL_SUNSHADOW, patchMaterial } from './shared.js';
import { HALF, WORLD_SIZE, TOWN, RANCH, CAMP, CHURCH } from './world.js';
import { mulberry32, Simplex2 } from './noise.js';
import { leafCardTexture, pineCardTexture, barkTexture } from './textures.js';

// ---------------------------------------------------------------------------- wind
const WIND_VERT = /* glsl */ `
attribute float aSway;
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
    vec3 wo = windOffset(iw.xyz + position, aSway, LEAF_FLUTTER);
    #ifdef USE_INSTANCING
      wo = (inverse(mat3(instanceMatrix)) * wo);
    #endif
    transformed += wo;
  }
`;

function windMaterial(mat, flutter = 0, extra = {}) {
  return patchMaterial(mat, {
    sunShadow: true,
    noFlip: flutter > 0,
    vertexHead: `#define LEAF_FLUTTER ${flutter.toFixed(2)}\n` + WIND_VERT,
    vertexBody: WIND_BODY,
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
    totalEmissiveRadiance += diffuseColor.rgb * vec3(0.95, 1.05, 0.45) * uSunColor * gSunVis * back * 0.26;
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

function buildPine(seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const height = 14 + rnd() * 9;
  wood.push(branchGeo(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, height, 0), 0.38 + rnd() * 0.12, 0.04, 8));
  const whorls = 20 + Math.floor(rnd() * 6);
  const base = 2.5 + rnd() * 1.5;
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = base + t * (height - base);
    const r = (1 - t) * (3.4 + rnd() * 0.6) + 0.5;
    const n = 8 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.7 + w;
      const droop = 0.18 + rnd() * 0.25 + (1 - t) * 0.25;
      // cross cards: one lying along the branch, one standing on its edge, so the
      // silhouette reads from the side and from above
      for (const vert of [false, true]) {
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
  // top tuft
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.9, 2.2);
    g.rotateY((i / 3) * Math.PI);
    g.translate(0, height - 0.6, 0);
    leaves.push(g);
  }
  const woodG = setSway(mergeGeometries(wood), (x, y) => (y / height) ** 2 * 0.5);
  const leafG = leafAO(setSway(mergeGeometries(leaves), (x, y, z) => (y / height) ** 2 * 0.6 + Math.hypot(x, z) * 0.05), true);
  return { wood: woodG, leaves: leafG, height, radius: 3.5 };
}

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
      dens *= 1.0 - smoothstep(240.0, 280.0, h0);
      dens *= 1.0 - 0.6*smoothstep(0.3, 0.8, sp.b);
      float field = fbm2(xz/26.0);
      dens *= smoothstep(0.02, 0.28, field + 0.12);
      float alive = smoothstep(aOff.z - 0.02, aOff.z + 0.25, dens); // soft, ragged edges at roads/yards
      float macro = fbm2(xz/380.0);
      float dry = smoothstep(0.42, 0.68, macro + 0.15*fbm2(xz/11.0 + 3.0));
      float hgt = mix(0.18, 0.66, smoothstep(0.25, 0.8, field)) * (0.55 + 0.7*aOff.w) * (0.85 + 0.35*dry) * (0.7 + 0.6 * fbm2(xz / 9.0));
      hgt *= mix(0.42, 1.0, smoothstep(55.0, 110.0, length(xz - RANCH_XZ))); // grazed ranch pasture
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
      vGY = y;
      vGFar = smoothstep(9.0, 48.0, dist);
    `,
    beginNormal: /* glsl */ `
      vec3 objectNormal = vec3(0.0, 1.0, 0.0);
    `,
    fragHead: 'varying vec3 vGCol; varying float vGY; varying float vGFar;',
    fragColor: /* glsl */ `
      #include <color_fragment>
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
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = 1 + (seed % 3) * 0.3, sz = 0.8 + (seed % 5) * 0.12;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.32 * n.fbm(v.x * 1.4 + seed, v.y * 1.4 + v.z, 4) + 0.12 * n.noise(v.x * 5, v.z * 5 + v.y * 3);
    v.multiplyScalar(d);
    // facet/strata flattening
    v.y = Math.round(v.y * 6) / 6 * 0.35 + v.y * 0.65;
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
      vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
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
      float moss = smoothstep(0.55, 0.85, wn.y + (n1-0.5)*0.6);
      base = mix(base, srgbR(vec3(74,86,40)), moss*0.85);
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
    const leafMat = (map, color = 0xc4ccb0) => windMaterial(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color, vertexColors: true, envMapIntensity: 0.4 }), 1, leafExtra);

    this.treeBuilds = [];
    const oakMats = oakTex.map((t) => leafMat(t));
    for (let i = 0; i < 4; i++) {
      const b = buildOak(100 + i * 17);
      const lt = oakTex[i % 3];
      this.treeBuilds.push({ kind: 'oak', height: b.height, parts: [
        { geometry: b.wood, material: barkMat },
        { geometry: b.leaves, material: oakMats[i % 3], depth: windDepthMaterial(lt, 1) },
      ] });
    }
    const pineMat = leafMat(pineTex, 0xc8ccb4);
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
    this.bushes = new ScatterLayer(scene, bushBuilds, 6000, 140 * Math.sqrt(quality));

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
    }
  }

  scatter() {
    const w = this.world;
    const r = w.rng(77);
    const cell = 9;
    const avoid = [
      [TOWN.x, TOWN.z, 165], [RANCH.x, RANCH.z, 62], [CHURCH.x, CHURCH.z, 32], [CAMP.x, CAMP.z, 28],
    ];
    const blocked = (x, z, pad = 0) => avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + pad);
    const range = HALF - 40;
    for (let z = -range; z < range; z += cell) for (let x = -range; x < range; x += cell) {
      const px = x + r() * cell, pz = z + r() * cell;
      const sp = w.splatAt(px, pz);
      const h = w.heightAt(px, pz);
      if (h < 0.4 || h > 300 || sp.road > 0.1) { r(); r(); continue; }
      const n = w.normalAt(px, pz);
      if (n.y < 0.75) { if (r() < 0.012) this.rocks.add(px, h - 0.3, pz, r() * 6.28, 1 + r() * 3.5, Math.floor(r() * 4)); continue; }
      const swamp = px > 600 && pz > 650;
      let p = sp.forest * 0.6 + 0.012;
      if (blocked(px, pz)) p = 0;
      if (r() < p) {
        let v;
        if (swamp) v = 8 + Math.floor(r() * 2);
        else if (h > 70 || pz < -700) v = 4 + Math.floor(r() * 4);
        else v = r() < 0.75 ? Math.floor(r() * 4) : 4 + Math.floor(r() * 4);
        if (sp.forest < 0.2 && !swamp) v = Math.floor(r() * 4); // lone meadow oaks
        const s = 0.8 + r() * 0.5;
        this.trees.add(px, h - 0.2, pz, r() * 6.28, s, v);
        continue;
      }
      if (blocked(px, pz, -20) ) continue;
      if (r() < 0.05 + sp.forest * 0.45) this.bushes.add(px, h - 0.1, pz, r() * 6.28, 0.6 + r() * 0.8, Math.floor(r() * 3));
      if (r() < 0.006 + (1 - n.y) * 0.05) this.rocks.add(px, h - 0.25, pz, r() * 6.28, 0.4 + r() * 2.2, Math.floor(r() * 4));
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
        varying vec2 vUv; varying vec3 vW; varying float vFade; varying float vVar;
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
          vW = p; vVar = variant;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          if (vFade <= 0.0 || h <= 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uCols;
        ${GLSL_COMMON}
        ${GLSL_FOG_PARS}
        ${GLSL_SUNSHADOW}
        varying vec2 vUv; varying vec3 vW; varying float vFade; varying float vVar;
        float bayer(vec2 p){ vec2 q = mod(floor(p), 4.0); return mod(q.x*4.0+q.y*2.0 + q.y*q.x, 4.0)/4.0 + 0.125; }
        void main(){
          vec4 c = texture(uAtlas, vUv);
          if (c.a < 0.5) discard;
          if (vFade < bayer(gl_FragCoord.xy)) discard;
          vec3 alb = c.rgb; // atlas is alpha-tested, not premultiplied
          // fake rounded-canopy normal from the billboard UV, lit like the near trees
          vec2 q = fract(vUv * vec2(uCols, 2.0)) * 2.0 - 1.0;
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
            vec3 cAlb = mix(pow(vec3(34.0, 46.0, 26.0) / 255.0, vec3(2.2)), pow(vec3(52.0, 62.0, 32.0) / 255.0, vec3(2.2)), fbm2(vW.xz / 18.0));
            vec3 nT = normalAt(vW.xz);
            float ndlT = max(dot(nT, normalize(uSunDir)), 0.0);
            vec3 litT = cAlb * (uSunColor * ndlT * 0.3 * terrainSunShadow(vW + vec3(0.0, 2.0, 0.0)) + uFogColor * 0.32 * ao);
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
  }
}
