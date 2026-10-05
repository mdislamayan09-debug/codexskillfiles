// Procedural characters: humans (rider, townsfolk, outlaws) and quadrupeds (horse, deer, sheep),
// built from elliptical sweeps on a joint hierarchy and animated procedurally.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from './shared.js';
import { coatTexture } from './textures.js';
import { mulberry32 } from './noise.js';

// ---------------------------------------------------------------- sweep geometry
// rings: [{p:Vector3, rx, ry}] along a path; cross-section ellipse oriented by path tangent.
export function sweep(rings, seg = 14, caps = true) {
  const pos = [], uv = [], idx = [];
  const n = rings.length;
  const up = new THREE.Vector3(0, 1, 0);
  let lenAcc = 0;
  const frames = rings.map((r, i) => {
    const a = rings[Math.max(0, i - 1)].p, b = rings[Math.min(n - 1, i + 1)].p;
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    let ref = r.up ? r.up.clone() : up.clone();
    if (Math.abs(t.dot(ref)) > 0.95) ref = new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3().crossVectors(ref, t).normalize();
    const nrm = new THREE.Vector3().crossVectors(t, side).normalize();
    return { t, side, nrm };
  });
  for (let i = 0; i < n; i++) {
    const r = rings[i], f = frames[i];
    if (i > 0) lenAcc += r.p.distanceTo(rings[i - 1].p);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const sq = r.sq || 1; // squareness
      const cx = Math.sign(c) * Math.pow(Math.abs(c), sq), sy = Math.sign(s) * Math.pow(Math.abs(s), sq);
      const p = r.p.clone().addScaledVector(f.side, cx * r.rx).addScaledVector(f.nrm, sy * r.ry + (r.oy || 0));
      pos.push(p.x, p.y, p.z);
      uv.push(k / seg, lenAcc);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  if (caps) {
    for (const [i, flip] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3;
      pos.push(rings[i].p.x, rings[i].p.y + (rings[i].oy || 0) * 0, rings[i].p.z);
      uv.push(0.5, i === 0 ? 0 : lenAcc);
      for (let k = 0; k < seg; k++) {
        const a = i * row + k, b = a + 1;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = (x, y, z, rx, ry = rx, extra = {}) => ({ p: V(x, y, z), rx, ry, ...extra });

// limb along -y from origin
function limb(len, r0, r1, seg = 10, bulge = 0.15) {
  const rings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + Math.sin(t * Math.PI) * bulge);
    rings.push(R(0, -t * len, 0, r, r * 0.92, { up: V(0, 0, 1) }));
  }
  return sweep(rings, seg);
}

const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o }));
function mesh(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

// Merge sibling meshes that share a material (per joint group) to cut draw calls.
export function mergeByMaterial(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh) groups.push(o); });
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length || !c.position.equals(new THREE.Vector3()) || c.rotation.x || c.rotation.y || c.rotation.z || c.scale.x !== 1) continue;
      if (!buckets.has(c.material)) buckets.set(c.material, []);
      buckets.get(c.material).push(c);
    }
    for (const [mat, list] of buckets) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        return geo;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = list.some((m) => m.castShadow); mm.receiveShadow = true;
      mm.userData = list[0].userData;
      for (const m of list) g.remove(m);
      g.add(mm);
    }
  }
}

// ---------------------------------------------------------------- humans
const SKIN = [0xc89a7a, 0xb88462, 0x9a6a4c, 0x7a5038, 0xd8ae90];
export const OUTFITS = {
  arthur: { coat: 0x8a6a46, shirt: 0x5a6e88, pants: 0x3a3430, hat: 0x2a221c, vest: 0x2e2a26, bandana: null, boots: 0x2a1e16 },
  outlaw: { coat: 0x4a3e32, shirt: 0x8a7a64, pants: 0x403a32, hat: 0x3a3028, vest: 0x2a2420, bandana: 0x8a2018, boots: 0x261a12 },
  rancher: { coat: null, shirt: 0xb8a888, pants: 0x4a5468, hat: 0x7a6a50, vest: 0x5a4632, bandana: 0x6a5a40, boots: 0x3a2a1e },
  gent: { coat: 0x2a2a2e, shirt: 0xd8d4c8, pants: 0x2e2e32, hat: 0x1a1a1c, vest: 0x4a3a46, bandana: null, boots: 0x161210 },
  lady: { coat: null, shirt: 0x7a4a5a, pants: 0x5a3a48, hat: null, vest: 0x5a3a48, bandana: null, boots: 0x1e1612, dress: true },
  worker: { coat: null, shirt: 0x9a8a70, pants: 0x50463a, hat: 0x8a7a5a, vest: null, bandana: 0x3e4a5a, boots: 0x30261c },
};

export class Human {
  constructor(outfit = 'arthur', seed = 1) {
    const o = OUTFITS[outfit] || OUTFITS.arthur;
    const r = mulberry32(seed);
    this.outfit = outfit;
    const skin = std({ color: SKIN[Math.floor(r() * SKIN.length)], roughness: 0.6 });
    const mats = {
      skin,
      coat: o.coat ? std({ color: o.coat, roughness: 0.92 }) : null,
      shirt: std({ color: o.shirt }),
      pants: std({ color: o.pants }),
      hat: o.hat ? std({ color: o.hat, roughness: 0.95 }) : null,
      vest: o.vest ? std({ color: o.vest }) : null,
      boots: std({ color: o.boots, roughness: 0.6 }),
      leather: std({ color: 0x4a3220, roughness: 0.7 }),
      metal: std({ color: 0x8a8580, metalness: 0.85, roughness: 0.35 }),
      hair: std({ color: [0x2a2018, 0x3e2e1e, 0x1a1612, 0x5a4a3a][Math.floor(r() * 4)], roughness: 0.9 }),
      bandana: o.bandana ? std({ color: o.bandana }) : null,
    };
    this.mats = mats;
    const root = (this.root = new THREE.Group());
    const hips = (this.hips = new THREE.Group());
    hips.position.y = 0.98;
    root.add(hips);
    const torsoM = mats.vest || mats.shirt;
    // torso
    const torso = sweep([
      R(0, -0.02, 0, 0.16, 0.11), R(0, 0.12, 0, 0.155, 0.105), R(0, 0.28, 0.005, 0.17, 0.115),
      R(0, 0.42, 0.0, 0.195, 0.125), R(0, 0.52, -0.01, 0.2, 0.12), R(0, 0.58, -0.015, 0.16, 0.1), R(0, 0.61, -0.02, 0.07, 0.06),
    ], 16);
    this.spine = new THREE.Group(); hips.add(this.spine);
    this.spine.add(mesh(torso, torsoM));
    // shirt collar/sleeves undersuit visible at chest
    if (mats.vest) {
      const shirtFront = sweep([R(0, 0.36, 0.035, 0.08, 0.1), R(0, 0.56, 0.02, 0.06, 0.08)], 10);
      this.spine.add(mesh(shirtFront, mats.shirt));
    }
    // coat: flared skirt & shoulders
    if (mats.coat) {
      const coat = sweep([
        R(0, 0.6, -0.02, 0.17, 0.11), R(0, 0.52, -0.01, 0.215, 0.135), R(0, 0.36, 0, 0.205, 0.135), R(0, 0.16, 0, 0.18, 0.125),
        R(0, -0.02, 0, 0.19, 0.135), R(0, -0.25, 0, 0.215, 0.155), R(0, -0.42, -0.01, 0.235, 0.17),
      ], 18, false);
      // open front: hide a wedge by pushing front vertices back slightly to reveal vest
      const p = coat.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0.09 && p.getY(i) > -0.05) p.setZ(i, p.getZ(i) - 0.012);
      coat.computeVertexNormals();
      const cm = mesh(coat, mats.coat); cm.material = mats.coat.clone(); cm.material.side = THREE.DoubleSide;
      this.spine.add(cm);
      // collar
      const col = new THREE.TorusGeometry(0.1, 0.035, 6, 14, Math.PI * 1.4); col.rotateX(Math.PI / 2); col.rotateZ(Math.PI * 0.8); col.translate(0, 0.6, -0.01);
      this.spine.add(mesh(col, mats.coat));
    }
    if (o.dress) {
      const skirt = sweep([R(0, 0.05, 0, 0.17, 0.12), R(0, -0.3, 0, 0.26, 0.22), R(0, -0.7, 0, 0.34, 0.3), R(0, -0.95, 0, 0.38, 0.34)], 18, false);
      const sm = mesh(skirt, mats.pants); sm.material = mats.pants.clone(); sm.material.side = THREE.DoubleSide;
      hips.add(sm);
    }
    // belt + holster + revolver
    const belt = new THREE.TorusGeometry(0.165, 0.025, 6, 20); belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.72); belt.translate(0, -0.04, 0);
    hips.add(mesh(belt, mats.leather));
    const holster = new THREE.BoxGeometry(0.06, 0.2, 0.08); holster.translate(0.19, -0.14, 0.02);
    hips.add(mesh(holster, mats.leather));
    const grip = new THREE.BoxGeometry(0.03, 0.08, 0.04); grip.rotateZ(-0.3); grip.translate(0.2, -0.01, 0.03);
    hips.add(mesh(grip, std({ color: 0x5a3a24 })));
    // neck & head
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.6, -0.01); this.spine.add(this.neck);
    this.neck.add(mesh(limb(0.1, 0.055, 0.05).rotateX(Math.PI), mats.skin));
    this.head = new THREE.Group(); this.head.position.set(0, 0.1, 0.01); this.neck.add(this.head);
    const headG = sweep([
      R(0, 0.0, 0.0, 0.055, 0.05), R(0, 0.03, 0.01, 0.085, 0.085), R(0, 0.09, 0.012, 0.095, 0.1), R(0, 0.15, 0.005, 0.095, 0.1),
      R(0, 0.2, -0.005, 0.088, 0.095), R(0, 0.245, -0.01, 0.06, 0.07), R(0, 0.262, -0.012, 0.02, 0.025),
    ], 16);
    this.head.add(mesh(headG, mats.skin));
    // jaw / beard stubble
    const jaw = sweep([R(0, 0.02, 0.03, 0.06, 0.05), R(0, 0.07, 0.045, 0.08, 0.06), R(0, 0.1, 0.04, 0.075, 0.055)], 12);
    this.head.add(mesh(jaw, r() < 0.6 ? mats.hair : mats.skin));
    const nose = new THREE.ConeGeometry(0.016, 0.045, 6); nose.rotateX(Math.PI / 2 + 0.4); nose.translate(0, 0.115, 0.1);
    this.head.add(mesh(nose, mats.skin));
    for (const s of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.022, 6, 6); ear.scale(0.5, 1, 0.8); ear.translate(s * 0.094, 0.12, 0.0);
      this.head.add(mesh(ear, mats.skin));
      const eye = new THREE.SphereGeometry(0.009, 6, 6); eye.translate(s * 0.032, 0.135, 0.088);
      this.head.add(mesh(eye, std({ color: 0x1a1612, roughness: 0.2 }), false));
      const brow = new THREE.BoxGeometry(0.03, 0.007, 0.01); brow.translate(s * 0.033, 0.152, 0.09);
      this.head.add(mesh(brow, mats.hair, false));
    }
    // hair back
    const hairG = sweep([R(0, 0.08, -0.03, 0.09, 0.08), R(0, 0.16, -0.02, 0.1, 0.1), R(0, 0.23, -0.015, 0.085, 0.085), R(0, 0.26, -0.015, 0.03, 0.03)], 14);
    this.head.add(mesh(hairG, mats.hair));
    if (mats.hat) {
      // crown (pinched cattleman) + curled brim
      const crown = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; crown.push(new THREE.Vector2(0.105 - t * 0.01 - (t > 0.85 ? (t - 0.85) * 0.5 : 0), t * 0.13)); }
      crown.push(new THREE.Vector2(0.0, 0.115));
      const cg = new THREE.LatheGeometry(crown, 18);
      const p = cg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
        p.setX(i, x * 0.92); // oval
        if (y > 0.08) p.setY(i, y - Math.abs(x) * 0.25 * (y - 0.08) / 0.05 * 0.6 + (z > 0 ? -0.004 : 0)); // crease
      }
      cg.computeVertexNormals();
      cg.translate(0, 0.2, -0.005);
      this.head.add(mesh(cg, mats.hat));
      const brim = new THREE.RingGeometry(0.09, 0.2, 24, 2);
      brim.rotateX(-Math.PI / 2);
      const bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), z = bp.getZ(i);
        const rr = Math.hypot(x, z);
        const curl = Math.max(0, rr - 0.14) * 0.75 * Math.pow(Math.abs(x) / rr, 3);
        bp.setY(i, curl - Math.abs(z) / rr * 0.18 * Math.max(0, rr - 0.11));
        bp.setX(i, x * 0.95);
      }
      brim.computeVertexNormals();
      brim.translate(0, 0.205, -0.005);
      const bm = mesh(brim, mats.hat); bm.material = mats.hat.clone(); bm.material.side = THREE.DoubleSide;
      this.head.add(bm);
      const band = new THREE.CylinderGeometry(0.098, 0.1, 0.025, 18, 1, true); band.scale(0.92, 1, 1); band.translate(0, 0.222, -0.005);
      this.head.add(mesh(band, mats.leather));
    }
    if (mats.bandana) {
      const b = new THREE.TorusGeometry(0.065, 0.02, 6, 14); b.rotateX(Math.PI / 2 - 0.2); b.translate(0, 0.04, 0.0);
      this.neck.add(mesh(b, mats.bandana));
      const tri = new THREE.ConeGeometry(0.05, 0.08, 3); tri.rotateX(Math.PI); tri.translate(0, 0.0, 0.06);
      this.neck.add(mesh(tri, mats.bandana));
    }
    // arms
    const sleeve = mats.coat || mats.shirt;
    this.arms = [-1, 1].map((s) => {
      const sh = new THREE.Group(); sh.position.set(s * 0.215, 0.52, -0.015); this.spine.add(sh);
      sh.add(mesh(new THREE.SphereGeometry(0.068, 12, 8), sleeve));
      sh.add(mesh(limb(0.3, 0.064, 0.048, 12), sleeve));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      el.add(mesh(new THREE.SphereGeometry(0.049, 10, 8), sleeve));
      el.add(mesh(limb(0.26, 0.047, 0.038), sleeve));
      const wr = new THREE.Group(); wr.position.y = -0.26; el.add(wr);
      const hand = sweep([R(0, 0, 0, 0.032, 0.022), R(0, -0.05, 0.005, 0.042, 0.02), R(0, -0.1, 0.01, 0.035, 0.018), R(0, -0.12, 0.012, 0.015, 0.012)], 8);
      wr.add(mesh(hand, mats.skin));
      const thumb = limb(0.05, 0.012, 0.01, 6); thumb.rotateZ(s * 0.6); thumb.translate(-s * 0.02, -0.02, 0.02);
      wr.add(mesh(thumb, mats.skin));
      sh.rotation.z = s * 0.08;
      return { sh, el, wr, s };
    });
    // revolver in right hand (hidden until aiming)
    const gun = new THREE.Group();
    const barrel = new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8); barrel.rotateX(Math.PI / 2); barrel.translate(0, 0.0, 0.1);
    const cyl = new THREE.CylinderGeometry(0.02, 0.02, 0.045, 8); cyl.rotateX(Math.PI / 2); cyl.translate(0, -0.005, 0.02);
    const gripG = new THREE.BoxGeometry(0.022, 0.08, 0.03); gripG.rotateX(0.35); gripG.translate(0, -0.045, -0.02);
    gun.add(mesh(barrel, mats.metal), mesh(cyl, mats.metal), mesh(gripG, std({ color: 0x5a3a24 })));
    gun.position.set(0, -0.09, 0.03);
    gun.rotation.x = -Math.PI / 2;
    gun.visible = false;
    this.arms[1].wr.add(gun);
    this.gun = gun;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, 0.19); gun.add(this.muzzle);
    // rifle on back for outlaws
    if (outfit === 'outlaw') {
      const rifle = new THREE.Group();
      const st = new THREE.BoxGeometry(0.04, 0.05, 0.4); st.translate(0, 0, -0.3);
      const bb = new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6); bb.rotateX(Math.PI / 2); bb.translate(0, 0.01, 0.2);
      rifle.add(mesh(st, std({ color: 0x5a3a24 })), mesh(bb, mats.metal));
      rifle.position.set(0, 0.35, -0.16); rifle.rotation.set(0, 0, 0.9); rifle.rotateX(Math.PI / 2);
      this.spine.add(rifle);
    }
    // legs
    this.legs = [-1, 1].map((s) => {
      const hp = new THREE.Group(); hp.position.set(s * 0.095, -0.03, 0); hips.add(hp);
      hp.add(mesh(limb(0.45, 0.085, 0.06, 10, 0.1), mats.pants));
      const kn = new THREE.Group(); kn.position.y = -0.45; hp.add(kn);
      kn.add(mesh(new THREE.SphereGeometry(0.062, 10, 8), mats.pants));
      kn.add(mesh(limb(0.43, 0.058, 0.045), mats.pants));
      const an = new THREE.Group(); an.position.y = -0.43; kn.add(an);
      const boot = sweep([R(0, 0.14, -0.005, 0.055, 0.055), R(0, 0.0, -0.01, 0.05, 0.05), R(0, -0.06, 0.02, 0.048, 0.04), R(0, -0.07, 0.11, 0.038, 0.025), R(0, -0.072, 0.15, 0.015, 0.012)], 10);
      an.add(mesh(boot, mats.boots));
      // boot shaft over pants
      const shaft = limb(0.2, 0.06, 0.055); shaft.translate(0, 0.18, 0);
      an.add(mesh(shaft, mats.boots));
      // spur
      const spur = new THREE.TorusGeometry(0.018, 0.004, 4, 8); spur.translate(0, -0.03, -0.07);
      an.add(mesh(spur, mats.metal, false));
      return { hp, kn, an, s };
    });
    mergeByMaterial(root);
    root.traverse((m) => { if (m.isMesh) m.userData.owner = this; });
    this.phase = r() * 10;
    this.state = 'idle';
    this.aim = 0;
    this.speed = 0;
    this.dead = 0;
    this.lookYaw = 0;
  }

  // mode: 'ground' | 'ride'
  animate(dt, { speed = 0, mode = 'ground', aim = 0, aimPitch = 0, horsePhase = 0, gait = 0, deadT = 0 } = {}) {
    const L = this.legs, A = this.arms;
    this.aim = THREE.MathUtils.lerp(this.aim, aim, Math.min(1, dt * 10));
    const t = (this.phase += dt * (mode === 'ride' ? 0 : 1) * (1.2 + speed * 1.05));
    const breathe = Math.sin(performance.now() * 0.0018 + this.phase) * 0.012;
    if (deadT > 0) {
      // collapse
      const k = Math.min(1, deadT * 1.6);
      this.hips.position.y = THREE.MathUtils.lerp(0.98, 0.18, k);
      this.root.rotation.x = -k * Math.PI / 2 * 0.95;
      for (const l of L) { l.hp.rotation.x = -k * 0.3 * l.s; l.kn.rotation.x = k * 0.3; }
      for (const a of A) { a.sh.rotation.z = a.s * (0.08 + k * 1.2); a.sh.rotation.x = -k * 0.4; a.el.rotation.x = -k * 0.3; }
      this.spine.rotation.x = 0; this.gun.visible = false;
      return;
    }
    if (mode === 'ride') {
      this.hips.position.y = 0.98;
      const bob = Math.sin(horsePhase * Math.PI * 2 * (gait > 2 ? 1 : 2)) * (0.01 + 0.025 * gait);
      this.hips.position.y += bob;
      this.spine.rotation.x = 0.06 * gait + Math.cos(horsePhase * Math.PI * 2) * 0.02 * gait;
      for (const l of L) {
        l.hp.rotation.x = -1.15; l.hp.rotation.z = l.s * 0.38;
        l.kn.rotation.x = 1.35; l.an.rotation.x = -0.25;
      }
      for (const a of A) {
        a.sh.rotation.x = -0.55; a.sh.rotation.z = a.s * 0.18; a.el.rotation.x = -0.95; a.wr.rotation.x = 0.2;
      }
    } else {
      this.hips.position.y = 0.98 - Math.abs(Math.sin(t * 2)) * 0.02 * Math.min(speed, 3) + breathe * 0.2;
      const stride = Math.min(1, speed / 2) * 0.55 + Math.max(0, speed - 2) * 0.08;
      this.spine.rotation.x = 0.03 + Math.min(speed, 6) * 0.025;
      L.forEach((l, i) => {
        const ph = t * 2 + i * Math.PI;
        l.hp.rotation.z = l.s * 0.02;
        l.hp.rotation.x = -Math.sin(ph) * stride;
        l.kn.rotation.x = Math.max(0, Math.cos(ph)) * stride * 1.6 + 0.05;
        l.an.rotation.x = -Math.max(0, -Math.cos(ph)) * stride * 0.4;
      });
      A.forEach((a, i) => {
        const ph = t * 2 + i * Math.PI + Math.PI;
        a.sh.rotation.x = -Math.sin(ph) * stride * 0.7;
        a.sh.rotation.z = a.s * (0.1 + breathe);
        a.el.rotation.x = -0.15 - Math.max(0, Math.sin(ph)) * stride * 0.6 - Math.min(speed, 6) * 0.08;
        a.wr.rotation.x = 0;
      });
    }
    // aiming: right arm raised toward target
    if (this.aim > 0.01) {
      const a = A[1];
      a.sh.rotation.x = THREE.MathUtils.lerp(a.sh.rotation.x, -Math.PI / 2 - aimPitch, this.aim);
      a.sh.rotation.z = THREE.MathUtils.lerp(a.sh.rotation.z, 0.12, this.aim);
      a.el.rotation.x = THREE.MathUtils.lerp(a.el.rotation.x, 0, this.aim);
      a.wr.rotation.x = THREE.MathUtils.lerp(a.wr.rotation.x, 0, this.aim);
      this.gun.visible = this.aim > 0.4;
    } else this.gun.visible = false;
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, this.lookYaw, Math.min(1, dt * 4));
  }
}

// ---------------------------------------------------------------- quadrupeds
const SPECIES = {
  horse: {
    scale: 1, coat: 'bay', legLen: [0.42, 0.38, 0.3, 0.12], legR: [0.13, 0.075, 0.045, 0.055],
    body: [
      [-0.98, 1.27, 0.12, 0.14], [-0.9, 1.33, 0.3, 0.32], [-0.7, 1.4, 0.38, 0.4], [-0.45, 1.39, 0.4, 0.42], [-0.15, 1.33, 0.42, 0.45],
      [0.18, 1.32, 0.41, 0.44], [0.48, 1.36, 0.36, 0.42], [0.7, 1.45, 0.3, 0.4], [0.86, 1.64, 0.22, 0.31], [1.0, 1.9, 0.16, 0.23], [1.1, 2.08, 0.12, 0.16],
    ],
    head: { len: 0.6, r0: [0.1, 0.14], r1: [0.07, 0.09], tilt: 1.1 },
    hipZ: -0.62, shoulderZ: 0.55, hipY: 1.25, legSpread: 0.2, ears: 0.12, mane: true, tail: 'horse',
  },
  deer: {
    scale: 0.62, coat: 'deer', legLen: [0.4, 0.42, 0.38, 0.1], legR: [0.11, 0.055, 0.032, 0.035],
    body: [
      [-0.9, 1.28, 0.12, 0.14], [-0.8, 1.34, 0.28, 0.3], [-0.55, 1.36, 0.32, 0.36], [-0.2, 1.32, 0.33, 0.38], [0.15, 1.33, 0.32, 0.38],
      [0.45, 1.38, 0.28, 0.36], [0.68, 1.5, 0.2, 0.28], [0.85, 1.78, 0.14, 0.18], [0.95, 2.02, 0.11, 0.13],
    ],
    head: { len: 0.5, r0: [0.1, 0.12], r1: [0.05, 0.06], tilt: 1.3 },
    hipZ: -0.58, shoulderZ: 0.45, hipY: 1.26, legSpread: 0.17, ears: 0.2, antlers: true, tail: 'short',
  },
  sheep: {
    scale: 0.55, coat: 'sheep', legLen: [0.32, 0.32, 0.26, 0.08], legR: [0.11, 0.06, 0.04, 0.04],
    body: [
      [-0.8, 1.15, 0.2, 0.2], [-0.7, 1.22, 0.42, 0.42], [-0.35, 1.28, 0.5, 0.5], [0.05, 1.28, 0.52, 0.52], [0.4, 1.27, 0.48, 0.48],
      [0.66, 1.25, 0.36, 0.38], [0.8, 1.3, 0.2, 0.22],
    ],
    head: { len: 0.45, r0: [0.12, 0.13], r1: [0.07, 0.08], tilt: 1.5, dark: true },
    hipZ: -0.5, shoulderZ: 0.45, hipY: 1.0, legSpread: 0.22, ears: 0.1, fluffy: true, tail: 'short',
  },
};

export class Quadruped {
  constructor(kind = 'horse', seed = 1, coat = null) {
    const S = (this.spec = SPECIES[kind]);
    this.kind = kind;
    const r = mulberry32(seed);
    const coatTex = coatTexture(coat || S.coat, seed);
    coatTex.wrapS = coatTex.wrapT = THREE.RepeatWrapping;
    const coatM = std({ map: coatTex, roughness: kind === 'sheep' ? 1 : 0.55 });
    const darkM = std({ color: kind === 'sheep' ? 0x2a2420 : 0x1a1410, roughness: 0.6 });
    const legM = (coat || S.coat) === 'bay' || kind === 'sheep' ? darkM : coatM;
    const hoofM = std({ color: 0x1c1814, roughness: 0.5 });
    this.mats = { coatM, darkM };
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    // torso sweep
    const rings = S.body.map(([z, y, rx, ry]) => R(0, y, z, rx, ry, { up: V(0, 1, 0) }));
    const torsoG = sweep(rings, 20);
    if (S.fluffy) {
      const p = torsoG.attributes.position; const n = torsoG.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const b = 0.035 * (Math.sin(p.getX(i) * 40) * Math.sin(p.getY(i) * 38) * Math.sin(p.getZ(i) * 41));
        p.setXYZ(i, p.getX(i) + n.getX(i) * b, p.getY(i) + n.getY(i) * b, p.getZ(i) + n.getZ(i) * b);
      }
      torsoG.computeVertexNormals();
    }
    body.add(mesh(torsoG, coatM));
    // neck/head pivot at last ring
    const last = S.body[S.body.length - 1];
    this.neck = new THREE.Group(); this.neck.position.set(0, last[1], last[0]); body.add(this.neck);
    const H = S.head;
    const headG = sweep([
      R(0, 0, -0.02, H.r0[0] * 0.8, H.r0[1] * 0.9), R(0, 0, 0.05, H.r0[0], H.r0[1]), R(0, 0, H.len * 0.35, H.r0[0] * 0.85, H.r0[1] * 0.92),
      R(0, 0, H.len * 0.7, H.r1[0] * 1.1, H.r1[1] * 1.15), R(0, 0, H.len, H.r1[0], H.r1[1]), R(0, -0.01, H.len + 0.04, H.r1[0] * 0.6, H.r1[1] * 0.7),
    ], 14);
    const head = (this.head = new THREE.Group());
    head.rotation.x = H.tilt;
    head.add(mesh(headG, H.dark ? darkM : coatM));
    if (kind === 'horse') {
      // blaze & nostrils
      const blaze = sweep([R(0, H.r0[1] * 0.92, 0.1, 0.03, 0.01), R(0, H.r1[1] * 1.12, H.len * 0.75, 0.025, 0.01)], 6);
      if (r() < 0.6) head.add(mesh(blaze, std({ color: 0xe8e0d4 })));
    }
    for (const s of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.035, S.ears, 6); ear.translate(s * H.r0[0] * 0.6, H.r0[1] * 0.8 + S.ears * 0.4, 0.0); ear.rotateZ(-s * 0.25);
      head.add(mesh(ear, H.dark ? darkM : coatM));
      const eye = new THREE.SphereGeometry(0.022, 8, 6); eye.translate(s * H.r0[0] * 0.92, H.r0[1] * 0.35, H.len * 0.22);
      head.add(mesh(eye, std({ color: 0x0a0806, roughness: 0.15 }), false));
    }
    if (S.antlers && r() < 0.6) {
      const antM = std({ color: 0xc8b898, roughness: 0.8 });
      for (const s of [-1, 1]) {
        const pts = [V(s * 0.06, 0.12, 0.02), V(s * 0.16, 0.3, -0.05), V(s * 0.22, 0.48, 0.05), V(s * 0.2, 0.62, 0.15)];
        const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.018, 5);
        head.add(mesh(g, antM));
        for (let k = 1; k < 3; k++) {
          const b = pts[k];
          const tine = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([b, b.clone().add(V(s * 0.02, 0.14, 0.08))]), 3, 0.012, 4);
          head.add(mesh(tine, antM));
        }
      }
    }
    this.neck.add(head);
    // mane
    if (S.mane) {
      const maneM = std({ color: (coat || S.coat) === 'grey' ? 0xd8d4cc : 0x14100c, roughness: 0.9, side: THREE.DoubleSide });
      const pts = S.body.slice(-4).map(([z, y, rx, ry]) => V(0, y + ry * 0.95, z - 0.05));
      pts.push(V(0, last[1] + 0.18, last[0] + 0.06));
      const maneRings = pts.map((p, i) => R(p.x, p.y, p.z, 0.025, 0.07 + i * 0.01, { up: V(0, 1, 0) }));
      body.add(mesh(sweep(maneRings, 6), maneM));
      // forelock fringe cards hanging on the side
      const cards = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const g = new THREE.PlaneGeometry(0.05, a.distanceTo(b) * 1.2);
        g.rotateX(-Math.PI / 2 + Math.atan2(b.y - a.y, b.z - a.z) * 0);
        const card = new THREE.BufferGeometry().copy(new THREE.PlaneGeometry(a.distanceTo(b) * 1.1, 0.22));
        card.rotateY(Math.PI / 2); card.rotateX(-Math.atan2(b.y - a.y, b.z - a.z));
        card.translate(0.04, (a.y + b.y) / 2 - 0.08, (a.z + b.z) / 2);
        cards.push(card);
      }
      body.add(mesh(mergeGeometries(cards), maneM));
    }
    // tail
    this.tail = new THREE.Group();
    const t0 = S.body[0];
    this.tail.position.set(0, t0[1] + 0.05, t0[0] + 0.03);
    body.add(this.tail);
    if (S.tail === 'horse') {
      const tailM = std({ color: (coat || S.coat) === 'grey' ? 0xd0ccc4 : 0x120e0a, roughness: 0.9 });
      const tg = sweep([R(0, 0, 0, 0.05, 0.05), R(0, -0.12, -0.1, 0.07, 0.06), R(0, -0.4, -0.18, 0.1, 0.07), R(0, -0.75, -0.18, 0.11, 0.06), R(0, -1.0, -0.14, 0.05, 0.03)], 10);
      this.tail.add(mesh(tg, tailM));
    } else {
      const tg = new THREE.ConeGeometry(0.06, 0.16, 6); tg.rotateX(Math.PI * 0.85); tg.translate(0, -0.05, -0.03);
      this.tail.add(mesh(tg, kind === 'deer' ? std({ color: 0xe8e0d0 }) : coatM));
    }
    // legs
    const [l1, l2, l3, l4] = S.legLen, [r1, r2, r3, r4] = S.legR;
    this.legs = [];
    for (const front of [true, false]) for (const s of [-1, 1]) {
      const top = new THREE.Group();
      top.position.set(s * S.legSpread, S.hipY + (front ? 0.06 : 0.08), front ? S.shoulderZ : S.hipZ);
      body.add(top);
      top.add(mesh(limb(l1, r1, r2 * 1.1, 14, 0.25), coatM));
      const j2 = new THREE.Group(); j2.position.y = -l1; top.add(j2);
      j2.add(mesh(new THREE.SphereGeometry(r2 * 1.12, 12, 8), coatM));
      j2.add(mesh(limb(l2, r2 * 1.05, r3 * 1.15, 12, 0.12), coatM));
      const j3 = new THREE.Group(); j3.position.y = -l2; j2.add(j3);
      j3.add(mesh(new THREE.SphereGeometry(r3 * 1.25, 10, 8).scale(1, 1.2, 1.1), legM));
      j3.add(mesh(limb(l3, r3, r3 * 0.92, 10, 0.04), legM));
      const j4 = new THREE.Group(); j4.position.y = -l3; j3.add(j4);
      j4.add(mesh(new THREE.SphereGeometry(r3 * 1.3, 10, 8).scale(1, 1, 1.15), legM));
      const hoof = sweep([R(0, 0.02, 0, r4 * 0.8, r4 * 0.8), R(0, -l4 * 0.6, 0.01, r4 * 1.05, r4), R(0, -l4, 0.02, r4 * 1.25, r4 * 1.2)], 8);
      j4.add(mesh(hoof, kind === 'horse' ? hoofM : darkM));
      // horses: feathering/fetlock
      this.legs.push({ top, j2, j3, j4, front, s });
    }
    // saddle & tack for horses
    if (kind === 'horse') {
      const leather = std({ color: 0x4a2e1a, roughness: 0.55 });
      const blanket = std({ color: [0x7a2a20, 0x2a3a5a, 0x6a5a2a][Math.floor(r() * 3)], roughness: 0.95 });
      const bl = sweep([R(0, 1.79, -0.42, 0.42, 0.05), R(0, 1.81, 0.05, 0.44, 0.05), R(0, 1.79, 0.32, 0.42, 0.05)], 12);
      const bp = bl.attributes.position;
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i); bp.setY(i, bp.getY(i) - x * x * 1.6); }
      bl.computeVertexNormals();
      body.add(mesh(bl, blanket));
      const seat = sweep([R(0, 1.86, -0.35, 0.2, 0.06), R(0, 1.83, -0.1, 0.2, 0.05), R(0, 1.86, 0.15, 0.17, 0.06), R(0, 1.95, 0.25, 0.08, 0.08)], 12);
      const sp = seat.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i); sp.setY(i, sp.getY(i) - x * x * 1.2); }
      seat.computeVertexNormals();
      body.add(mesh(seat, leather));
      const horn = new THREE.CylinderGeometry(0.035, 0.025, 0.12, 8); horn.translate(0, 2.0, 0.27);
      body.add(mesh(horn, leather));
      // cantle
      const cant = new THREE.TorusGeometry(0.16, 0.03, 6, 12, Math.PI); cant.translate(0, 1.87, -0.36);
      body.add(mesh(cant, leather));
      // bedroll + saddlebags (like Arthur's)
      const roll = new THREE.CylinderGeometry(0.12, 0.12, 0.75, 12); roll.rotateZ(Math.PI / 2); roll.translate(0, 1.92, -0.52);
      body.add(mesh(roll, std({ color: 0x5a5a48, roughness: 1 })));
      for (const s of [-1, 1]) {
        const bag = sweep([R(s * 0.42, 1.62, -0.62, 0.06, 0.13), R(s * 0.43, 1.62, -0.45, 0.07, 0.15), R(s * 0.42, 1.62, -0.3, 0.06, 0.13)], 8);
        body.add(mesh(bag, leather));
        const strap = new THREE.BoxGeometry(0.02, 0.5, 0.05); strap.translate(s * 0.4, 1.5, 0.05);
        body.add(mesh(strap, leather));
        const stir = new THREE.TorusGeometry(0.06, 0.012, 4, 10); stir.translate(s * 0.44, 1.22, 0.05);
        body.add(mesh(stir, std({ color: 0x3a3632, metalness: 0.6 })));
      }
      // rope coil
      const rope = new THREE.TorusGeometry(0.12, 0.018, 6, 16); rope.rotateY(Math.PI / 2); rope.translate(0.24, 1.82, 0.22);
      body.add(mesh(rope, std({ color: 0x9a845a })));
      // bridle + reins
      const br = new THREE.TorusGeometry(0.12, 0.012, 4, 14); br.rotateY(Math.PI / 2); br.scale(1, 1, 0.8); br.translate(0, 0.02, 0.25);
      head.add(mesh(br, leather));
      const reinPts = [V(0.08, -0.1, 0.5), V(0.1, -0.2, 0.25), V(0.06, -0.15, -0.1)];
      head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(reinPts), 6, 0.008, 4), leather));
      head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(reinPts.map((p) => V(-p.x, p.y, p.z))), 6, 0.008, 4), leather));
    }
    root.scale.setScalar(S.scale);
    mergeByMaterial(root);
    root.traverse((m) => { if (m.isMesh) m.userData.owner = this; });
    this.phase = r();
    this.gait = 0; // 0 idle 1 walk 2 trot 3 canter 4 gallop
    this.grazing = 0;
    this.deadT = 0;
  }

  // speed in m/s drives gait selection; returns cycle phase for rider
  animate(dt, speed, turn = 0) {
    const s = speed / this.spec.scale;
    const gait = s < 0.1 ? 0 : s < 2.2 ? 1 : s < 5 ? 2 : s < 9 ? 3 : 4;
    this.gait = gait;
    const freq = [0, 0.9, 1.35, 1.7, 2.15][gait] * (gait ? Math.max(0.7, Math.min(1.3, s / [1, 1.6, 3.6, 7, 11][gait])) : 0);
    this.phase = (this.phase + dt * freq) % 1;
    const P = this.phase * Math.PI * 2;
    // phase offsets per leg: order front L, front R, hind L, hind R
    const offs = {
      1: [0.5, 0.0, 0.75, 0.25], // walk (lateral sequence)
      2: [0.0, 0.5, 0.5, 0.0], // trot (diagonal)
      3: [0.6, 0.5, 0.15, 0.0], // canter
      4: [0.62, 0.52, 0.12, 0.0], // gallop (rotary)
    }[gait] || [0, 0, 0, 0];
    const amp = [0, 0.3, 0.42, 0.62, 0.78][gait];
    if (this.deadT > 0) {
      const k = Math.min(1, this.deadT * 1.4);
      this.body.rotation.z = k * Math.PI / 2 * 0.95;
      this.body.position.y = -k * 0.9 * this.spec.hipY * 0.6;
      for (const L of this.legs) { L.top.rotation.x = k * 0.3; L.j2.rotation.x = 0; }
      return this.phase;
    }
    this.legs.forEach((L, i) => {
      const ph = P + offs[i] * Math.PI * 2;
      const swing = Math.sin(ph);
      const lift = Math.max(0, Math.cos(ph));
      if (L.front) {
        L.top.rotation.x = -swing * amp * 0.75;
        L.j2.rotation.x = 0;
        L.j3.rotation.x = -lift * amp * 1.9; // knee folds back under
        L.j4.rotation.x = lift * amp * 0.8 + 0.08;
      } else {
        L.top.rotation.x = -swing * amp * 0.65 + 0.12;
        L.j2.rotation.x = -0.35 - lift * amp * 0.5; // stifle
        L.j3.rotation.x = 0.4 + lift * amp * 0.9; // hock
        L.j4.rotation.x = -0.15 + lift * amp * 0.4;
      }
    });
    // body motion
    const bob = gait >= 3 ? Math.sin(P) * 0.07 * amp : Math.abs(Math.sin(P * 2)) * 0.025 * amp;
    this.body.position.y = bob;
    this.body.rotation.x = gait >= 3 ? Math.cos(P) * 0.06 * amp : 0;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -turn * 0.12, Math.min(1, dt * 4));
    // neck nod & grazing
    const want = gait === 0 && this.grazing > 0 ? 1 : 0;
    this.grazeK = THREE.MathUtils.lerp(this.grazeK || 0, want, Math.min(1, dt * 1.5));
    this.neck.rotation.x = (gait >= 3 ? Math.sin(P + 1) * 0.12 : Math.sin(P * 2) * 0.04 * amp) + this.grazeK * 1.1 - Math.min(gait, 2) * 0.03;
    this.tail.rotation.x = 0.2 + Math.sin(performance.now() * 0.002 + this.phase) * 0.05 + gait * 0.12;
    this.tail.rotation.z = Math.sin(performance.now() * 0.0013) * 0.15;
    return this.phase;
  }
}
