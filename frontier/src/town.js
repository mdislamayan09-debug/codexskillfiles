// Copper Hollow: procedurally assembled frontier town, church, ranch, outlaw camp and road furniture.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, U } from './shared.js';
import { plankTexture, shingleTexture, tinTexture, signTexture, windowTexture } from './textures.js';
import { TOWN, RANCH, CHURCH, CAMP, ROADS, RES, CELL, HALF } from './world.js';
import { mulberry32 } from './noise.js';

const TEX_M = 2.4; // metres per plank texture repeat

function canvasTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = mulberry32(3);
  g.fillStyle = '#d8ccb0'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) { g.fillStyle = `rgba(90,80,60,${0.05 + r() * 0.05})`; g.fillRect(0, i, 256, 1); g.fillRect(i, 0, 1, 256); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,55,35,${r() * 0.18})`; g.beginPath(); g.ellipse(r() * 256, r() * 256, 10 + r() * 40, 6 + r() * 24, 0, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(60,45,30,0.35)'; g.fillRect(0, 236, 256, 20); // mud line at the hem
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// Period handbill: wanted poster / reward / notice on yellowed paper
function posterTexture(kind, seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 356; const g = c.getContext('2d');
  const r = mulberry32(seed + 40);
  g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, 256, 356);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.08})`; g.fillRect(r() * 256, r() * 356, 2 + r() * 6, 1 + r() * 3); }
  const grd = g.createRadialGradient(128, 178, 80, 128, 178, 220); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(90,60,25,0.45)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 356);
  g.fillStyle = '#2a1c12'; g.textAlign = 'center';
  g.font = '44px "Rye", Georgia, serif'; g.fillText(kind, 128, 58);
  if (kind === 'WANTED') {
    g.font = '18px "IM Fell English SC", Georgia, serif'; g.fillText('DEAD OR ALIVE', 128, 84);
    g.fillStyle = '#8a7a5a'; g.fillRect(58, 98, 140, 150);
    g.fillStyle = '#3a2a1a'; g.beginPath(); g.ellipse(128, 160, 34, 42, 0, 0, 7); g.fill(); g.fillRect(84, 196, 88, 52);
    g.fillRect(80, 120, 96, 14); g.fillRect(98, 100, 60, 22);
    g.font = '30px "Rye", Georgia, serif'; g.fillStyle = '#2a1c12'; g.fillText('$' + (200 + seed * 150), 128, 290);
    g.font = '15px "IM Fell English", Georgia, serif'; g.fillText('for the Cutter Gang', 128, 318);
  } else {
    g.font = '15px "IM Fell English", Georgia, serif';
    const lines = kind === 'REWARD' ? ['Stolen from Hale\'s Ranch', 'one chestnut mare', 'white blaze, brand H', '', '$25 on return'] : ['Town Meeting', 'Saturday at the church', 'all citizens of', 'Copper Hollow', 'are called'];
    lines.forEach((l, i) => g.fillText(l, 128, 110 + i * 34));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Box with world-scaled UVs
function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / TEX_M, uv.getY(i) * dims[f][1] / TEX_M);
  }
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(r0, r1, h, x, y, z, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
function plane(w, h, x, y, z, ry = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
// Gable roof prism along local x (ridge along x)
function gableRoof(w, d, rise, overhang = 0.5) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const t = 0.2;
  const slope = Math.hypot(hd, rise);
  const left = new THREE.BoxGeometry(w + overhang * 2, t, slope);
  const ang = Math.atan2(rise, hd);
  const lp = left.clone(); lp.rotateX(-ang); lp.translate(0, rise / 2, -hd / 2);
  const rp = left.clone(); rp.rotateX(ang); rp.translate(0, rise / 2, hd / 2);
  for (const g of [lp, rp]) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w + overhang * 2) / 3, uv.getY(i) * slope / 3);
  }
  return [lp, rp];
}
function gableEnds(w, d, rise) {
  // triangular gable walls at +-x ends
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, rise); shape.lineTo(-d / 2, 0);
  const g = new THREE.ShapeGeometry(shape);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / TEX_M, uv.getY(i) / TEX_M);
  const a = g.clone(); a.rotateY(Math.PI / 2); a.translate(w / 2, 0, 0);
  const b = g.clone(); b.rotateY(-Math.PI / 2); b.translate(-w / 2, 0, 0);
  return [a, b];
}

class Bucket {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix) {
    if (!this.map.has(mat)) this.map.set(mat, []);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    // normalise attributes to position/normal/uv
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.map.get(mat).push(g);
  }
  build(scene) {
    const out = [];
    for (const [mat, list] of this.map) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = !mat.userData.noShadow;
      m.receiveShadow = true;
      scene.add(m);
      out.push(m);
    }
    return out;
  }
}

export class Town {
  constructor(world, scene, surf = {}) {
    this.world = world;
    this.scene = scene;
    this.colliders = [];
    this.lights = [];
    this.signs = [];
    this.windmills = [];
    this.campfires = [];
    this.hitches = [];
    this.interactables = [];
    // every town surface darkens toward the ground (splash-back grime + contact occlusion)
    const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o }), {
      fragColor: /* glsl */ `
        #include <color_fragment>
        {
          float above = vWPos.y - heightAt(vWPos.xz);
          float grime = smoothstep(0.0, 1.4, above);
          diffuseColor.rgb *= mix(0.5, 1.0, grime) * mix(vec3(0.92, 0.88, 0.8), vec3(1.0), grime);
          diffuseColor.rgb *= 0.9 + 0.2 * vnoise(vWPos.xy * 0.7 + vWPos.z * 0.3);
        }`,
    });
    const M = (this.mats = {
      bare: std({ map: surf.planks || plankTexture(1), normalMap: surf.planksN || null, color: 0xc2b6a2 }),
      bare2: std({ map: surf.planks || plankTexture(2, null, true), normalMap: surf.planksN || null, color: 0xa89a86 }),
      red: std({ map: plankTexture(3, [140, 58, 44]) }),
      redV: std({ map: plankTexture(13, [134, 54, 40], true) }),
      bareV: std({ map: plankTexture(14, null, true) }),
      teal: std({ map: plankTexture(4, [84, 104, 96]) }),
      cream: std({ map: plankTexture(5, [186, 174, 146]) }),
      blue: std({ map: plankTexture(6, [92, 104, 120]) }),
      ochre: std({ map: plankTexture(7, [168, 140, 88]) }),
      green: std({ map: plankTexture(8, [76, 92, 64]) }),
      white: std({ map: plankTexture(9, [212, 206, 190]) }),
      shingle: std({ map: shingleTexture(1) }),
      shingleDark: std({ map: shingleTexture(2, [70, 64, 58]) }),
      tin: std({ map: tinTexture(1), metalness: 0.4, roughness: 0.6 }),
      trim: std({ color: 0x3b2c20 }),
      dark: std({ color: 0x171310 }),
      iron: std({ color: 0x2a2826, metalness: 0.7, roughness: 0.5 }),
      stone: std({ color: 0x7d766c }),
      hay: std({ color: 0xb59a52, roughness: 1 }),
      canvas: std({ map: canvasTexture(), color: 0x9c907a, roughness: 1, side: THREE.DoubleSide }),
      rope: std({ color: 0x6e5a3e }),
      water: std({ color: 0x2a3330, roughness: 0.15 }),
    });
    // scanned plank relief on every painted clapboard surface too
    if (surf.planksN) for (const k of ['red', 'redV', 'bareV', 'teal', 'cream', 'blue', 'ochre', 'green', 'white']) {
      if (M[k]) { M[k].normalMap = surf.planksN; M[k].normalScale = new THREE.Vector2(0.7, 0.7); M[k].needsUpdate = true; }
    }
    const winTex = windowTexture();
    M.window = std({ map: winTex, emissive: 0xffa040, emissiveMap: winTex, emissiveIntensity: 0, roughness: 0.3 });
    M.window.userData.noShadow = true;
    M.lampGlass = std({ color: 0x2a1c10, emissive: 0xffa848, emissiveIntensity: 0, roughness: 0.2 });
    M.lampGlass.userData.noShadow = true;
    this.lampMat = M.lampGlass;
    this.windowMat = M.window;
    this.posterMats = ['WANTED', 'REWARD', 'NOTICE'].map((t, i) => std({ map: posterTexture(t, i), roughness: 0.95 }));
    this.bucket = new Bucket();

    this.buildMainStreet();
    this.buildChurch();
    this.buildRanch();
    this.buildCamp();
    this.buildTelegraph();
    this.wearGround();
    this.meshes = this.bucket.build(scene);
    for (const s of this.signs) scene.add(s);
  }

  h(x, z) { return this.world.heightAt(x, z); }

  // A false-front western building. Local frame: front faces +z, origin at front-centre on ground.
  building(cx, cz, face, o) {
    const B = this.bucket, M = this.mats;
    const { w, d, h, paint = 'bare', name = null, porch = true, balcony = false, frontExtra = 2.2, roof = 'shingle', stories = 1 } = o;
    const y0 = Math.max(this.h(cx - w / 2, cz), this.h(cx + w / 2, cz), this.h(cx, cz + (face > 0 ? d : -d))) ;
    const mtx = new THREE.Matrix4().makeRotationY(face > 0 ? 0 : Math.PI).setPosition(cx, y0, cz);
    const add = (mat, g) => B.add(mat, g, mtx);
    const wallM = M[paint];
    const fz = 0; // facade plane z
    // foundation & body
    add(M.stone, box(w + 0.2, 0.6, d + 0.2, 0, 0.0, -d / 2));
    add(wallM, box(w, h, d, 0, h / 2 + 0.3, -d / 2));
    // false front facade
    const fh = h + frontExtra;
    add(wallM, box(w + 0.3, fh, 0.25, 0, fh / 2 + 0.3, fz + 0.1));
    // cornice and trim
    add(M.trim, box(w + 0.7, 0.28, 0.5, 0, fh + 0.42, fz + 0.15));
    add(M.trim, box(w + 0.5, 0.16, 0.35, 0, fh + 0.1, fz + 0.15));
    add(M.trim, box(0.22, fh, 0.32, -w / 2 - 0.1, fh / 2 + 0.3, fz + 0.15));
    add(M.trim, box(0.22, fh, 0.32, w / 2 + 0.1, fh / 2 + 0.3, fz + 0.15));
    // stepped crown on wider buildings
    if (w > 9) add(wallM, box(w * 0.4, 0.9, 0.25, 0, fh + 0.95, fz + 0.1)), add(M.trim, box(w * 0.4 + 0.4, 0.2, 0.4, 0, fh + 1.45, fz + 0.15));
    // roof (gable running front-to-back hidden behind facade)
    const roofM = M[roof];
    const rise = Math.min(frontExtra - 0.5, w * 0.22);
    const rg = gableRoof(d, w, rise, 0.35);
    for (const g of rg) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.3, -d / 2); add(roofM, g); }
    for (const g of gableEnds(d, w, rise)) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.3, -d / 2); add(wallM, g); }
    // windows & doors on front
    const floors = stories;
    const nWin = Math.max(1, Math.floor((w - 3) / 2.6));
    for (let f = 0; f < floors; f++) {
      const wy = 0.3 + (f === 0 ? 1.9 : 1.9 + f * (h / floors));
      for (let i = 0; i < nWin; i++) {
        const wx = -w / 2 + (i + 0.5) * (w / nWin);
        if (f === 0 && Math.abs(wx) < 1.4) continue; // door slot
        const ww = f === 0 ? 1.5 : 1.0, wh = f === 0 ? 2.0 : 1.5;
        add(M.window, plane(ww, wh, wx, wy, fz + 0.24));
        add(M.trim, box(ww + 0.3, 0.14, 0.18, wx, wy + wh / 2 + 0.05, fz + 0.26));
        add(M.trim, box(ww + 0.2, 0.1, 0.25, wx, wy - wh / 2 - 0.05, fz + 0.28));
      }
    }
    // door
    add(M.dark, plane(1.7, 2.6, 0, 1.6, fz + 0.235));
    add(M.trim, box(2.2, 0.2, 0.2, 0, 3.0, fz + 0.27));
    // handbills tacked up beside the door, and a lantern on the porch post
    const pr = mulberry32(Math.floor(Math.abs(cx * 13 + cz * 7)) + 1);
    for (let k = 0; k < 2; k++) {
      if (pr() < 0.45) continue;
      const px = (k ? 1 : -1) * (1.25 + pr() * 0.5);
      const pm = this.posterMats[Math.floor(pr() * this.posterMats.length)];
      const g = plane(0.46, 0.64, px, 1.75 + pr() * 0.3, fz + 0.245);
      g.rotateZ((pr() - 0.5) * 0.08);
      add(pm, g);
    }
    if (porch) {
      add(M.iron, box(0.05, 0.3, 0.05, 1.5, 3.35, 3.45));
      add(M.lampGlass, box(0.16, 0.24, 0.16, 1.5, 3.08, 3.45));
    }
    if (name === 'SALOON') {
      // batwing doors
      add(M.bare, box(0.8, 1.0, 0.05, -0.42, 1.7, fz + 0.4));
      add(M.bare, box(0.8, 1.0, 0.05, 0.42, 1.7, fz + 0.4));
    }
    // side windows
    for (let i = 0; i < Math.floor(d / 5); i++) {
      const wz = -2.5 - i * 5;
      for (const sx of [-1, 1]) {
        const g = plane(1.0, 1.4, 0, 2.0, 0, sx * Math.PI / 2); g.translate(sx * (w / 2 + 0.02), 0.3, wz);
        add(M.window, g);
      }
    }
    // porch / boardwalk
    if (porch) {
      const pd = 3.2;
      add(M.bare2, box(w + 0.4, 0.25, pd, 0, 0.3, pd / 2 + 0.25));
      add(M.trim, box(w + 0.4, 0.35, 0.15, 0, 0.12, pd + 0.3));
      const posts = Math.max(2, Math.round(w / 3) + 1);
      for (let i = 0; i < posts; i++) {
        const px = -w / 2 + (i / (posts - 1)) * w;
        add(M.trim, box(0.2, 3.2, 0.2, px, 2.0, pd + 0.1));
      }
      if (!balcony) {
        const pr = box(w + 0.6, 0.12, pd + 0.4, 0, 3.7, pd / 2 + 0.2);
        pr.rotateX(0); add(M.tin, pr);
        add(M.trim, box(w + 0.6, 0.25, 0.12, 0, 3.55, pd + 0.4));
      } else {
        // second-floor balcony with railing
        add(M.bare2, box(w + 0.6, 0.2, pd + 0.4, 0, 3.7, pd / 2 + 0.2));
        add(M.trim, box(w + 0.6, 0.12, 0.12, 0, 4.75, pd + 0.4));
        for (let i = 0; i <= Math.round(w / 0.5); i++) add(M.bare, box(0.06, 0.95, 0.06, -w / 2 + i * 0.5, 4.25, pd + 0.4));
        for (let i = 0; i < posts; i++) add(M.trim, box(0.16, 2.4, 0.16, -w / 2 + (i / (posts - 1)) * w, 6.0, pd + 0.4));
        add(M.tin, box(w + 0.8, 0.12, pd + 0.6, 0, 7.25, pd / 2 + 0.2));
      }
      // steps
      add(M.bare2, box(1.8, 0.15, 0.45, 0, 0.12, pd + 0.6));
      // hitching rail + trough
      add(M.bare, box(3.4, 0.14, 0.14, w * 0.25, 1.0, pd + 2.2));
      this.hitches.push({ pos: new THREE.Vector3(w * 0.25, 0, pd + 3.0).applyMatrix4(mtx), yaw: face > 0 ? Math.PI / 2 : -Math.PI / 2 });
      add(M.bare, box(0.14, 1.05, 0.14, w * 0.25 - 1.6, 0.5, pd + 2.2));
      add(M.bare, box(0.14, 1.05, 0.14, w * 0.25 + 1.6, 0.5, pd + 2.2));
      // barrels / crates
      const r = mulberry32(Math.floor(cx * 7 + cz));
      for (let i = 0; i < 3; i++) {
        if (r() < 0.4) continue;
        const bx = -w / 2 + 0.6 + r() * (w - 1.2);
        if (Math.abs(bx) < 1.5) continue;
        if (r() < 0.5) add(M.bare, this.barrelGeo(bx, 0.42, 1.0 + r() * 1.5));
        else add(M.bare2, box(0.8, 0.8, 0.8, bx, 0.82, 1.0 + r() * 1.5, r()));
      }
    }
    // signage
    if (name) {
      const st = signTexture(name, { bg: ['#2b1d12', '#e8dcc0', '#3a2a1a', '#1d2a24'][name.length % 4], fg: name.length % 4 === 1 ? '#3a2214' : '#e8d6a8' });
      const sw = Math.min(w * 0.85, name.length * 0.75 + 1.5);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.19), patchMaterial(new THREE.MeshStandardMaterial({ map: st, roughness: 0.85 })));
      const sp = new THREE.Vector3(0, fh - 0.9, fz + 0.26).applyMatrix4(mtx);
      sm.position.copy(sp);
      sm.rotation.y = face > 0 ? 0 : Math.PI;
      sm.castShadow = false; sm.receiveShadow = true;
      this.signs.push(sm);
    }
    // collider (world AABB)
    const c0 = new THREE.Vector3(-w / 2 - 0.2, 0, -d - 0.2).applyMatrix4(mtx);
    const c1 = new THREE.Vector3(w / 2 + 0.2, 0, 0.3).applyMatrix4(mtx);
    this.colliders.push({ minx: Math.min(c0.x, c1.x), maxx: Math.max(c0.x, c1.x), minz: Math.min(c0.z, c1.z), maxz: Math.max(c0.z, c1.z) });
    // lantern by the door
    this.interactables.push({ type: 'door', name, pos: new THREE.Vector3(0, 0, 3).applyMatrix4(mtx) });
  }

  // Write worn ground into the splat map: dirt skirts round every footprint and trodden paths at the ranch.
  wearGround() {
    const W = this.world, S = W.splat;
    const stamp = (x, z, rad, amt) => {
      const i0 = Math.max(0, Math.floor((x - rad + HALF) / CELL)), i1 = Math.min(RES - 1, Math.ceil((x + rad + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((z - rad + HALF) / CELL)), j1 = Math.min(RES - 1, Math.ceil((z + rad + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = -HALF + i * CELL, pz = -HALF + j * CELL;
        const d = Math.hypot(px - x, pz - z) / rad;
        if (d >= 1) continue;
        const k = (j * RES + i) * 4 + 3;
        const v = amt * (1 - d * d) * 255 * (0.8 + 0.2 * Math.sin(px * 1.7 + pz * 2.3));
        if (v > S[k]) S[k] = v;
      }
    };
    for (const c of this.colliders) {
      const pad = 1.8;
      for (let x = c.minx - pad; x <= c.maxx + pad; x += 1.5) { stamp(x, c.minz - pad * 0.5, 3.2, 0.85); stamp(x, c.maxz + pad * 0.5, 3.2, 0.85); }
      for (let z = c.minz - pad; z <= c.maxz + pad; z += 1.5) { stamp(c.minx - pad * 0.5, z, 3.2, 0.85); stamp(c.maxx + pad * 0.5, z, 3.2, 0.85); }
    }
    const { x, z } = RANCH;
    const paths = [
      [[x - 20, z - 16], [x - 16, z - 9], [x - 12, z + 8], [x - 10, z + 30], [x - 40, z + 44], [x - 70, z + 60]],
      [[x - 48, z - 14], [x - 34, z - 13], [x - 20, z - 16]],
      [[x + 36, z - 20], [x + 46, z - 12], [x + 44, z + 12], [x + 30, z + 40], [x - 10, z + 30]],
      [[x - 40, z + 4], [x - 26, z + 2], [x - 16, z - 9]],
    ];
    for (const p of paths) for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.8);
      for (let k = 0; k <= n; k++) {
        const t = k / n, wob = Math.sin((ax + t * (bx - ax)) * 0.3) * 0.6;
        stamp(ax + (bx - ax) * t + wob, az + (bz - az) * t, 2.8, 1.0);
      }
    }
    W.splatTex.needsUpdate = true;
  }

  barrelGeo(x, y, z) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.32 + Math.sin(t * Math.PI) * 0.06, t * 0.9 - 0.45)); }
    const g = new THREE.LatheGeometry(pts, 12);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.4);
    g.translate(x, y, z);
    return g;
  }

  buildMainStreet() {
    const rows = [
      // north side (faces +z toward street at z = -11)
      { x: -122, w: 10, d: 16, h: 5.5, paint: 'bare', name: 'LIVERY & STABLES', roof: 'tin' },
      { x: -104, w: 9, d: 14, h: 5, paint: 'ochre', name: 'BUTCHER' },
      { x: -88, w: 10, d: 14, h: 5.2, paint: 'teal', name: 'GUNSMITH' },
      { x: -70, w: 13, d: 18, h: 8.2, paint: 'red', name: 'SALOON', balcony: true, stories: 2 },
      { x: -50, w: 11, d: 16, h: 5.6, paint: 'cream', name: 'GENERAL STORE' },
      { x: -32, w: 9, d: 13, h: 5, paint: 'bare', name: 'BARBER' },
      { x: -14, w: 10, d: 15, h: 5.4, paint: 'blue', name: 'SHERIFF' },
      { x: 14, w: 14, d: 20, h: 8.8, paint: 'white', name: 'HOTEL', balcony: true, stories: 2 },
      { x: 36, w: 10, d: 14, h: 5.2, paint: 'green', name: 'DOCTOR' },
      { x: 54, w: 11, d: 15, h: 5.8, paint: 'bare', name: 'POST OFFICE' },
      { x: 74, w: 12, d: 17, h: 6.2, paint: 'ochre', name: 'BANK', roof: 'shingleDark' },
      { x: 94, w: 9, d: 12, h: 5, paint: 'red', name: 'TAILOR' },
      { x: 112, w: 10, d: 14, h: 5, paint: 'bare', name: 'UNDERTAKER', roof: 'shingleDark' },
    ];
    const south = [
      { x: -118, w: 12, d: 14, h: 5.2, paint: 'bare', name: 'BLACKSMITH', roof: 'tin' },
      { x: -96, w: 10, d: 13, h: 5, paint: 'cream', name: 'BAKERY' },
      { x: -76, w: 12, d: 16, h: 7.6, paint: 'teal', name: 'BOARDING HOUSE', balcony: true, stories: 2 },
      { x: -54, w: 10, d: 14, h: 5, paint: 'red', name: 'ASSAY OFFICE' },
      { x: -34, w: 11, d: 14, h: 5.6, paint: 'bare', name: 'FEED & SEED' },
      { x: 30, w: 12, d: 16, h: 7.8, paint: 'ochre', name: 'THEATRE', balcony: true, stories: 2 },
      { x: 52, w: 10, d: 13, h: 5, paint: 'blue', name: 'TELEGRAPH' },
      { x: 72, w: 11, d: 15, h: 5.4, paint: 'cream', name: 'MERCANTILE' },
      { x: 94, w: 10, d: 13, h: 5, paint: 'green', name: 'DENTIST' },
    ];
    const streetHalf = 11.5;
    for (const b of rows) this.building(b.x, -streetHalf, 1, b);
    for (const b of south) this.building(b.x, streetHalf, -1, b);
    // street furniture: lamps, wagons
    const B = this.bucket, M = this.mats;
    const r = mulberry32(5);
    for (let x = -120; x <= 120; x += 30) {
      for (const s of [-1, 1]) {
        const lx = x + 6, lz = s * 7.2, ly = this.h(lx, lz);
        B.add(M.trim, cyl(0.09, 0.07, 3.6, lx, ly, lz));
        B.add(M.iron, box(0.38, 0.06, 0.38, lx, ly + 4.05, lz));
        B.add(M.iron, box(0.3, 0.06, 0.3, lx, ly + 3.56, lz));
        B.add(M.lampGlass, box(0.26, 0.42, 0.26, lx, ly + 3.8, lz));
        B.add(M.iron, new THREE.ConeGeometry(0.26, 0.2, 4).rotateY(Math.PI / 4).translate(lx, ly + 4.18, lz));
        this.lights.push(new THREE.Vector3(lx, ly + 3.8, lz));
      }
    }
    for (let i = 0; i < 4; i++) this.wagon(-90 + i * 60 + r() * 10, (r() < 0.5 ? -1 : 1) * 6.5, r() * 0.3 - 0.15 + (r() < 0.5 ? 0 : Math.PI));
    // water tower behind the street
    this.waterTower(-30, -38);
    // street clutter: troughs, hay, crates, barrels clustered by the boardwalks
    for (let i = 0; i < 26; i++) {
      const x = -125 + r() * 250, side = r() < 0.5 ? -1 : 1, z = side * (7.15 + r() * 0.3);
      const y = this.h(x, z);
      const k = r();
      if (k < 0.3) { B.add(M.bare, box(2.2, 0.55, 0.7, x, y + 0.28, z, r() * 0.2)); B.add(M.water, box(2.0, 0.05, 0.5, x, y + 0.5, z)); }
      else if (k < 0.55) { B.add(M.hay, box(1.1, 0.5, 0.55, x, y + 0.25, z, r())); if (r() < 0.5) B.add(M.hay, box(1.1, 0.5, 0.55, x + 0.2, y + 0.75, z, r())); }
      else if (k < 0.8) { for (let j = 0; j < 3; j++) B.add(M.bare, this.barrelGeo(x + j * 0.7, y + 0.45, z + (r() - 0.5) * 0.4)); }
      else { B.add(M.bare2, box(0.9, 0.9, 0.9, x, y + 0.45, z, r())); B.add(M.bare2, box(0.7, 0.7, 0.7, x + 0.2, y + 1.25, z, r())); }
    }
  }

  wagon(x, z, ry) {
    const B = this.bucket, M = this.mats;
    const y = this.h(x, z);
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    B.add(M.bare2, box(3.6, 0.5, 1.5, 0, 1.1, 0), m);
    B.add(M.bare, box(3.6, 0.6, 0.08, 0, 1.6, 0.72), m);
    B.add(M.bare, box(3.6, 0.6, 0.08, 0, 1.6, -0.72), m);
    B.add(M.trim, box(2.6, 0.08, 0.08, 2.9, 0.9, 0), m); // tongue
    for (const [wx, r] of [[-1.3, 0.62], [1.3, 0.5]]) for (const s of [-1, 1]) {
      const t = new THREE.TorusGeometry(r, 0.05, 6, 20); t.translate(wx, r, s * 0.85); B.add(M.iron, t, m);
      for (let k = 0; k < 8; k++) {
        const sp = new THREE.BoxGeometry(0.05, r * 2, 0.04); sp.rotateZ((k / 8) * Math.PI); sp.translate(wx, r, s * 0.85); B.add(M.trim, sp, m);
      }
    }
    if (Math.abs(Math.sin(x)) > 0.3) {
      // canvas bonnet
      for (let i = 0; i < 4; i++) {
        const t = new THREE.TorusGeometry(0.95, 0.03, 4, 12, Math.PI); t.translate(-1.4 + i * 0.93, 1.4, 0); t.rotateY(0);
        const tt = t.clone(); tt.rotateY(Math.PI / 2); tt.translate(0, 0, 0);
      }
      const c = new THREE.CylinderGeometry(0.95, 0.95, 3.4, 14, 1, true, -Math.PI / 2, Math.PI);
      c.rotateZ(Math.PI / 2); c.translate(0, 1.45, 0);
      B.add(M.canvas, c, m);
    } else {
      B.add(M.hay, box(1.2, 0.5, 0.6, -0.8, 1.6, 0.2), m);
      B.add(M.bare, this.barrelGeo(0.9, 1.8, -0.2), m);
    }
    this.colliders.push({ minx: x - 2, maxx: x + 2, minz: z - 1.2, maxz: z + 1.2 });
  }

  waterTower(x, z) {
    const B = this.bucket, M = this.mats;
    const y = this.h(x, z);
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) B.add(M.bare, box(0.3, 7, 0.3, x + dx, y + 3.5, z + dz));
    B.add(M.bare, box(3.6, 0.2, 3.6, x, y + 7, z));
    const tank = new THREE.CylinderGeometry(2.0, 2.0, 3.2, 18, 1, false);
    const uv = tank.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 1.3);
    tank.translate(x, y + 8.7, z); B.add(M.bare2, tank);
    const cone = new THREE.ConeGeometry(2.3, 1.2, 18); cone.translate(x, y + 10.9, z); B.add(M.shingleDark, cone);
    for (const yy of [7.6, 8.7, 9.8]) { const t = new THREE.TorusGeometry(2.02, 0.04, 4, 24); t.rotateX(Math.PI / 2); t.translate(x, y + yy, z); B.add(M.iron, t); }
    this.colliders.push({ minx: x - 2, maxx: x + 2, minz: z - 2, maxz: z + 2 });
  }

  buildChurch() {
    const B = this.bucket, M = this.mats;
    const { x, z } = CHURCH;
    const y = this.h(x, z);
    const m = new THREE.Matrix4().makeRotationY(-0.4).setPosition(x, y, z);
    const w = 9, d = 16, h = 6;
    B.add(M.stone, box(w + 0.4, 0.8, d + 0.4, 0, 0, 0), m);
    B.add(M.white, box(w, h, d, 0, h / 2 + 0.3, 0), m);
    for (const g of gableRoof(d, w, 3.6, 0.5)) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.3, 0); B.add(M.shingleDark, g, m); }
    for (const g of gableEnds(d, w, 3.6)) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.3, 0); B.add(M.white, g, m); }
    // steeple
    B.add(M.white, box(3.2, 6, 3.2, 0, h + 3.5, d / 2 - 1.6), m);
    B.add(M.trim, box(3.6, 0.3, 3.6, 0, h + 6.6, d / 2 - 1.6), m);
    B.add(M.white, box(2.6, 2.6, 2.6, 0, h + 8.0, d / 2 - 1.6), m);
    B.add(M.dark, box(1.0, 1.6, 2.7, 0, h + 8.0, d / 2 - 1.6), m);
    B.add(M.dark, box(2.7, 1.6, 1.0, 0, h + 8.0, d / 2 - 1.6), m);
    const spire = new THREE.ConeGeometry(2.0, 7.5, 4); spire.rotateY(Math.PI / 4); spire.translate(0, h + 13.1, d / 2 - 1.6);
    B.add(M.shingleDark, spire, m);
    B.add(M.iron, box(0.1, 1.4, 0.1, 0, h + 17.5, d / 2 - 1.6), m);
    B.add(M.iron, box(0.7, 0.1, 0.1, 0, h + 17.7, d / 2 - 1.6), m);
    B.add(M.dark, plane(1.8, 2.8, 0, 1.7, d / 2 + 0.01), m);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const g = plane(1.0, 2.2, 0, 3.0, 0, s * Math.PI / 2); g.translate(s * (w / 2 + 0.02), 0, -5 + i * 4.5); B.add(M.window, g, m);
    }
    // graveyard crosses
    const r = mulberry32(9);
    for (let i = 0; i < 14; i++) {
      const gx = -10 + r() * 6, gz = -8 + r() * 16;
      const p = new THREE.Vector3(gx, 0, gz).applyMatrix4(m);
      const gy = this.h(p.x, p.z);
      const mm = new THREE.Matrix4().makeRotationY(-0.4 + (r() - 0.5) * 0.2).setPosition(p.x, gy, p.z);
      B.add(M.bare, box(0.12, 1.1, 0.08, 0, 0.5, 0), mm);
      B.add(M.bare, box(0.6, 0.1, 0.08, 0, 0.8, 0), mm);
    }
    this.colliders.push({ minx: x - 9, maxx: x + 9, minz: z - 10, maxz: z + 10 });
  }

  barn(x, z, ry, w, d, h, paint) {
    const B = this.bucket, M = this.mats;
    const y = this.h(x, z);
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    B.add(M.stone, box(w + 0.3, 0.5, d + 0.3, 0, 0, 0), m);
    const wallM = paint === 'red' ? M.redV : paint === 'bare' ? M.bareV : M[paint];
    B.add(wallM, box(w, h, d, 0, h / 2 + 0.25, 0), m);
    // battens every 0.6 m on the gable walls and long sides
    for (let bx = -w / 2 + 0.3; bx < w / 2; bx += 0.6) for (const sz of [-1, 1]) B.add(M.trim, box(0.06, h, 0.04, bx, h / 2 + 0.25, sz * (d / 2 + 0.02)), m);
    for (let bz = -d / 2 + 0.3; bz < d / 2; bz += 0.6) for (const sx of [-1, 1]) B.add(M.trim, box(0.04, h, 0.06, sx * (w / 2 + 0.02), h / 2 + 0.25, bz), m);
    // corner boards and a fascia under the eaves
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(M.white, box(0.16, h, 0.16, cx * (w / 2 + 0.03), h / 2 + 0.25, cz * (d / 2 + 0.03)), m);
    const rise = w * 0.38;
    for (const g of gableRoof(d, w, rise, 0.6)) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.25, 0); B.add(M.shingleDark, g, m); }
    for (const g of gableEnds(d, w, rise)) { g.rotateY(Math.PI / 2); g.translate(0, h + 0.25, 0); B.add(wallM, g, m); }
    // big doors with white X bracing
    B.add(M.dark, plane(w * 0.42, h * 0.8, 0, h * 0.4 + 0.25, d / 2 + 0.02), m);
    B.add(M.white, box(w * 0.44, 0.14, 0.06, 0, h * 0.8 + 0.25, d / 2 + 0.05), m);
    for (const s of [-1, 1]) {
      const g = box(Math.hypot(w * 0.21, h * 0.8), 0.12, 0.05, 0, 0, 0);
      g.rotateZ(s * Math.atan2(h * 0.8, w * 0.21)); g.translate(-w * 0.105, h * 0.4 + 0.25, d / 2 + 0.06); B.add(M.white, g, m);
      const g2 = g.clone(); g2.translate(w * 0.21, 0, 0); B.add(M.white, g2, m);
    }
    // hayloft opening
    B.add(M.dark, plane(w * 0.2, h * 0.25, 0, h + rise * 0.35, d / 2 + 0.02), m);
    // lean-to shed
    B.add(M.bare, box(4, h * 0.6, d * 0.8, w / 2 + 2, h * 0.3 + 0.25, 0), m);
    const shed = box(4.6, 0.12, d * 0.85, w / 2 + 2, h * 0.62 + 0.4, 0); shed.rotateZ(0); B.add(M.tin, shed, m);
    const c = [new THREE.Vector3(-w / 2 - 0.3, 0, -d / 2 - 0.3), new THREE.Vector3(w / 2 + 4.3, 0, d / 2 + 0.3)].map((v) => v.applyMatrix4(m));
    this.colliders.push({ minx: Math.min(c[0].x, c[1].x), maxx: Math.max(c[0].x, c[1].x), minz: Math.min(c[0].z, c[1].z), maxz: Math.max(c[0].z, c[1].z) });
  }

  fence(points, closed = false) {
    const B = this.bucket, M = this.mats;
    const pts = closed ? [...points, points[0]] : points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 2.6));
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = this.h(x, z);
        B.add(M.bare, box(0.16, 1.5, 0.16, x, y + 0.6, z, Math.atan2(bx - ax, bz - az)));
      }
      const ang = Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = this.h(x0, z0), y1 = this.h(x1, z1);
        const seg = Math.hypot(x1 - x0, z1 - z0);
        for (const ry of [0.55, 1.05]) {
          const g = box(seg + 0.1, 0.11, 0.05, 0, 0, 0);
          g.rotateZ(Math.atan2(y1 - y0, seg));
          g.rotateY(-ang);
          g.translate((x0 + x1) / 2, (y0 + y1) / 2 + ry, (z0 + z1) / 2);
          B.add(M.bare2, g);
        }
      }
    }
  }

  buildRanch() {
    const { x, z } = RANCH;
    this.barn(x - 20, z - 28, 0, 14, 22, 6.5, 'red');
    this.barn(x + 26, z - 20, Math.PI / 2, 12, 18, 5.5, 'bare');
    this.building(x - 48, z - 18, 1, { w: 10, d: 12, h: 4.6, paint: 'cream', name: null, porch: true, roof: 'shingleDark' });
    // corrals like the Heartlands postcard
    this.fence([[x - 34, z - 10], [x + 6, z - 10], [x + 6, z + 22], [x - 34, z + 22]], true);
    this.fence([[x + 10, z - 4], [x + 44, z - 4], [x + 44, z + 26], [x + 10, z + 26]], true);
    this.fence([[x - 60, z + 40], [x - 10, z + 46], [x + 50, z + 44]]);
    // hay bales
    const B = this.bucket, M = this.mats;
    const r = mulberry32(31);
    for (let i = 0; i < 9; i++) {
      const hx = x - 4 + r() * 10, hz = z - 16 + r() * 4;
      const hy = this.h(hx, hz);
      B.add(M.hay, box(1.2, 0.55, 0.6, hx, hy + 0.27 + (i > 5 ? 0.55 : 0), hz, r()));
    }
    for (let i = 0; i < 3; i++) this.wagon(x + 10 + i * 6, z + 34, 0.4 + i * 0.3);
    // windmill
    const wx = x - 40, wz = z + 4, wy = this.h(wx, wz);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const g = box(0.14, 11, 0.14, 0, 0, 0); g.rotateZ(-dx * 0.08); g.rotateX(dz * 0.08); g.translate(wx + dx * 0.5, wy + 5.5, wz + dz * 0.5); B.add(M.bare, g);
    }
    B.add(M.bare, box(1.2, 0.15, 1.2, wx, wy + 11, wz));
    const rotor = new THREE.Group();
    const bladeM = this.mats.bare2;
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.0, 0.03), bladeM);
      b.position.set(0, 1.5, 0); const piv = new THREE.Group(); piv.add(b); piv.rotation.z = (i / 16) * Math.PI * 2; b.rotation.y = 0.5; rotor.add(piv);
      b.castShadow = true;
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.04, 4, 32), this.mats.iron); rotor.add(ring);
    rotor.position.set(wx, wy + 11.6, wz + 0.8);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 2.4), this.mats.bare); tail.position.set(wx, wy + 11.6, wz - 1.4);
    this.scene.add(rotor, tail);
    this.windmills.push(rotor);
    // trough
    B.add(M.bare, box(2.6, 0.6, 0.8, wx + 3, wy + 0.3, wz + 2));
  }

  buildCamp() {
    const B = this.bucket, M = this.mats;
    const { x, z } = CAMP;
    const r = mulberry32(55);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3, d = 9 + r() * 4;
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d, ty = this.h(tx, tz);
      const m = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(tx, ty, tz);
      // A-frame tent
      const tent = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 3, 1, true);
      tent.rotateZ(Math.PI / 2); tent.rotateX(Math.PI / 6); tent.translate(0, 0.75, 0);
      B.add(M.canvas, tent, m);
      B.add(M.bare, box(0.08, 2.4, 0.08, 1.6, 1.2, 0), m);
      B.add(M.bare, box(0.08, 2.4, 0.08, -1.6, 1.2, 0), m);
      this.colliders.push({ minx: tx - 1.8, maxx: tx + 1.8, minz: tz - 1.8, maxz: tz + 1.8 });
    }
    // campfire ring
    const y = this.h(x, z);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const s = new THREE.DodecahedronGeometry(0.22); s.translate(x + Math.cos(a) * 0.8, y + 0.1, z + Math.sin(a) * 0.8); B.add(M.stone, s);
    }
    for (let i = 0; i < 4; i++) { const l = box(1.4, 0.14, 0.14, 0, 0, 0); l.rotateY(i * 0.8); l.translate(x, y + 0.15, z); B.add(M.trim, l); }
    this.campfires.push(new THREE.Vector3(x, y + 0.3, z));
    for (let i = 0; i < 5; i++) {
      const a = i * 1.25 + 0.6, d = 4.6 + r() * 1.5;
      const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d, by = this.h(bx, bz);
      const roll = new THREE.CylinderGeometry(0.18, 0.18, 1.9, 10, 1); roll.rotateZ(Math.PI / 2); roll.scale(1, 0.55, 1); roll.rotateY(-a);
      roll.translate(bx, by + 0.1, bz); B.add(M.canvas, roll);
    }
    for (let i = 0; i < 4; i++) B.add(M.bare2, box(0.7, 0.55, 0.5, x - 6 + i * 0.8, this.h(x - 6, z - 5) + 0.27, z - 5 - (i % 2) * 0.6, i * 0.3));
    B.add(M.iron, this.barrelGeo(x + 5, this.h(x + 5, z + 2) + 0.45, z + 2));
    // logs to sit on
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1; const lg = new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8); lg.rotateZ(Math.PI / 2); lg.rotateY(a);
      lg.translate(x + Math.cos(a) * 3, y + 0.22, z + Math.sin(a) * 3); B.add(M.bare, lg);
    }
    // crates & lockbox
    B.add(M.bare2, box(0.9, 0.7, 0.6, x + 4, y + 0.35, z - 3));
    B.add(M.iron, box(0.6, 0.4, 0.4, x + 4, y + 0.9, z - 3));
    this.interactables.push({ type: 'loot', name: 'Strongbox', pos: new THREE.Vector3(x + 4, y + 0.9, z - 3), taken: false, value: 145 });
  }

  buildTelegraph() {
    const B = this.bucket, M = this.mats;
    const road = this.world.roads[0];
    const poles = [];
    let acc = 0;
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1], [bx, bz] = road[i];
      const seg = Math.hypot(bx - ax, bz - az);
      acc += seg;
      if (acc > 45) {
        acc = 0;
        const nx = -(bz - az) / seg, nz = (bx - ax) / seg;
        const px = bx + nx * 9, pz = bz + nz * 9;
        if (Math.abs(px) < 150 && Math.abs(pz) < 40) continue;
        const py = this.world.heightAt(px, pz);
        if (py < 0.5) continue;
        poles.push(new THREE.Vector3(px, py, pz));
      }
    }
    for (const p of poles) {
      B.add(M.bare, cyl(0.14, 0.11, 7.5, p.x, p.y - 0.3, p.z, 7));
      B.add(M.bare, box(1.8, 0.12, 0.12, p.x, p.y + 6.6, p.z));
    }
    // wires as thin sagging tubes
    const wireM = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const wires = [];
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      if (a.distanceTo(b) > 90) continue;
      for (const off of [-0.7, 0.7]) {
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const p = a.clone().lerp(b, t);
          p.y = a.y + (b.y - a.y) * t + 6.72 - Math.sin(t * Math.PI) * 0.9;
          p.x += off;
          pts.push(p);
        }
        wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.015, 3));
      }
    }
    if (wires.length) this.scene.add(new THREE.Mesh(mergeGeometries(wires), wireM));
  }

  update(dt, night) {
    for (const w of this.windmills) w.rotation.z += dt * 1.6;
    this.windowMat.emissiveIntensity = night * 2.2;
    this.lampMat.emissiveIntensity = night * 9;
  }

  collide(pos, radius) {
    for (const c of this.colliders) {
      const cx = Math.max(c.minx, Math.min(pos.x, c.maxx));
      const cz = Math.max(c.minz, Math.min(pos.z, c.maxz));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 < 1e-6) {
          // inside: push out along smallest axis
          const pen = [pos.x - c.minx, c.maxx - pos.x, pos.z - c.minz, c.maxz - pos.z];
          const k = pen.indexOf(Math.min(...pen));
          if (k === 0) pos.x = c.minx - radius; else if (k === 1) pos.x = c.maxx + radius;
          else if (k === 2) pos.z = c.minz - radius; else pos.z = c.maxz + radius;
        } else {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius; pos.z = cz + (dz / d) * radius;
        }
      }
    }
  }
}
