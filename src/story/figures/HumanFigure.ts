import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../../core/rng';
import type { NpcDef } from '../StoryData';
import { buildEyelids, buildHead, HEAD_B, HEAD_C } from './head';
import { applySkinShading } from './skinShading';
import { bakeCloth, bakeHair, bakeIris, bakeLeather, bakeSkin, type Cloth } from './textures';

// A survivor, built from their description: a sculpted head (head.ts), a
// body in proportion under clothes that are cut and hung like cloth, hands
// with jointed fingers, boots, and what they carry. The rig is a few pivots
// (waist, neck, head, eyes) so they can breathe, shift their weight, blink
// and turn to look at whoever is talking to them.
//
// Built facing +z, turned inside `group` so the figure faces -z like the
// rest of the game's people.

type Look = NpcDef['look'];

export interface HumanFigure {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  /** Idle life; `look` is a world point to look at (null: gaze drifts). */
  update(dt: number, time: number, look: THREE.Vector3 | null): void;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Keep position, normal and uv (and colour, white if missing) so parts merge. */
function prep(g: THREE.BufferGeometry, color: boolean): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(color && name === 'color')) out.deleteAttribute(name);
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (color && !out.getAttribute('color')) out.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 3).fill(1), 3));
  return out;
}

function merge(parts: THREE.BufferGeometry[], color = false): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => prep(p, color)), false) ?? new THREE.BufferGeometry();
}

// ---------------------------------------------------------------------------
// Lofting cloth

interface Ring {
  y: number;
  /** Half width (x) and half depth (z) of the cross-section, and its centre. */
  w: number;
  d: number;
  z?: number;
  /** Superellipse exponent: 2 an ellipse, higher squarer. */
  n?: number;
}

function ringPoint(r: Ring, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const n = r.n ?? 2.2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const pz = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  return out.set(px * r.w, r.y, (r.z ?? 0) + pz * r.d);
}

/** Interpolated ring at height y (rings ordered top to bottom). */
function ringAt(rings: Ring[], y: number): Ring {
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a = rings[i];
    const b = rings[i + 1];
    if (y <= a.y && y >= b.y) {
      const t = (a.y - y) / (a.y - b.y || 1);
      return { y, w: a.w + (b.w - a.w) * t, d: a.d + (b.d - a.d) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t, n: (a.n ?? 2.2) + ((b.n ?? 2.2) - (a.n ?? 2.2)) * t };
    }
  }
  return y > rings[0].y ? rings[0] : rings[rings.length - 1];
}

/**
 * A garment surface through rings (top to bottom), `seg` round and `steps`
 * down between each pair. `fold` pushes the cloth out along the ring's
 * outward direction (theta 0 = +x, π/2 = front). `arc` leaves an opening.
 */
function loft(rings: Ring[], seg: number, steps: number, tile: number, fold?: (theta: number, y: number) => number, arc?: [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const t0 = arc ? arc[0] : 0;
  const t1 = arc ? arc[1] : Math.PI * 2;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const heights: number[] = [];
  for (let i = 0; i < rings.length - 1; i += 1) for (let k = 0; k < steps; k += 1) heights.push(rings[i].y + (rings[i + 1].y - rings[i].y) * (k / steps));
  heights.push(rings[rings.length - 1].y);
  for (const y of heights) {
    const r = ringAt(rings, y);
    let arcLen = 0;
    ringPoint(r, t0, q);
    for (let j = 0; j <= seg; j += 1) {
      const th = t0 + ((t1 - t0) * j) / seg;
      ringPoint(r, th, p);
      arcLen += p.distanceTo(q);
      q.copy(p);
      const f = fold ? fold(th, y) : 0;
      pos.push(p.x + Math.cos(th) * f, p.y, p.z + Math.sin(th) * f);
      uv.push(arcLen / tile, y / tile);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < heights.length - 1; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // Outward winding: (b - a) runs round, (c - a) runs down.
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The inside of an open garment piece (collar, hood): the same surface, turned in. */
function inside(g: THREE.BufferGeometry, inset: number): THREE.BufferGeometry {
  const h = g.clone();
  const pos = h.getAttribute('position') as THREE.BufferAttribute;
  const nrm = h.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) pos.setXYZ(i, pos.getX(i) - nrm.getX(i) * inset, pos.getY(i) - nrm.getY(i) * inset, pos.getZ(i) - nrm.getZ(i) * inset);
  const index = h.getIndex() as THREE.BufferAttribute;
  for (let k = 0; k < index.count; k += 3) {
    const b = index.getX(k + 1);
    index.setX(k + 1, index.getX(k + 2));
    index.setX(k + 2, b);
  }
  h.computeVertexNormals();
  return h;
}

interface TubePoint {
  p: THREE.Vector3;
  r: number;
}

/** A tube (sleeve, trouser leg, finger) along points, radius varying, parallel-transport frames. */
function tube(points: TubePoint[], seg: number, tile: number, wrinkle?: (t: number, a: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  T.subVectors(points[1].p, points[0].p).normalize();
  N.set(1, 0, 0);
  if (Math.abs(T.dot(N)) > 0.9) N.set(0, 0, 1);
  B.crossVectors(T, N).normalize();
  N.crossVectors(B, T).normalize();
  let len = 0;
  const total = points.reduce((s, q, i) => (i ? s + q.p.distanceTo(points[i - 1].p) : 0), 0);
  const tmp = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      len += points[i].p.distanceTo(points[i - 1].p);
      const next = i < points.length - 1 ? points[i + 1].p : points[i].p;
      const nt = tmp.subVectors(next, points[i - 1].p).normalize();
      axis.crossVectors(T, nt);
      const sn = axis.length();
      if (sn > 1e-6) {
        axis.divideScalar(sn);
        const ang = Math.asin(Math.min(1, sn));
        N.applyAxisAngle(axis, ang);
        B.applyAxisAngle(axis, ang);
      }
      T.copy(nt);
    }
    const { p, r } = points[i];
    const t = total > 0 ? len / total : 0;
    for (let s = 0; s <= seg; s += 1) {
      const a = (s / seg) * Math.PI * 2;
      const rr = r + (wrinkle ? wrinkle(t, a) : 0);
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      pos.push(p.x + (N.x * cx + B.x * sx) * rr, p.y + (N.y * cx + B.y * sx) * rr, p.z + (N.z * cx + B.z * sx) * rr);
      uv.push(((s / seg) * Math.PI * 2 * r) / tile, len / tile);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let s = 0; s < seg; s += 1) {
      const a = i * row + s;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points along a quadratic curve through a middle control point. */
function curve(a: THREE.Vector3, m: THREE.Vector3, b: THREE.Vector3, radii: [number, number, number], count: number): TubePoint[] {
  const pts: TubePoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const p = new THREE.Vector3()
      .addScaledVector(a, (1 - t) * (1 - t))
      .addScaledVector(m, 2 * (1 - t) * t)
      .addScaledVector(b, t * t);
    const r = t < 0.5 ? radii[0] + (radii[1] - radii[0]) * (t / 0.5) : radii[1] + (radii[2] - radii[1]) * ((t - 0.5) / 0.5);
    pts.push({ p, r });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Hands and boots

/**
 * A relaxed hand hanging at the side: palm, four jointed fingers curled a
 * little, the thumb forward. `side` +1 for the right hand (on +x).
 */
function buildHand(s: number, side: number, rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Local frame: fingers down (-y), palm facing -x for the right hand, thumb toward +z.
  const palm = new THREE.SphereGeometry(1, 16, 12);
  palm.scale(0.0155 * s, 0.05 * s, 0.041 * s);
  palm.translate(0, -0.047 * s, 0.002 * s);
  parts.push(palm);
  const fingers: [number, number][] = [
    [0.026, 0.074],
    [0.009, 0.083],
    [-0.009, 0.077],
    [-0.025, 0.061],
  ];
  const curl = [0.25, 0.4, 0.32];
  for (const [fz, len] of fingers) {
    let p = new THREE.Vector3(-0.002 * s, -0.093 * s, fz * s);
    let ang = 0.08 + (rng() - 0.5) * 0.08;
    const lens = [len * 0.46, len * 0.3, len * 0.24];
    const rad = [0.0088, 0.0079, 0.0071];
    for (let k = 0; k < 3; k += 1) {
      ang += curl[k] * (0.8 + rng() * 0.4);
      // Curling toward the palm (-x).
      const dir = new THREE.Vector3(-Math.sin(ang), -Math.cos(ang), 0);
      const L = lens[k] * s;
      const cap = new THREE.CapsuleGeometry(rad[k] * s, L, 4, 10);
      cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      const mid = p.clone().addScaledVector(dir, L / 2);
      cap.translate(mid.x, mid.y, mid.z);
      parts.push(cap);
      p = p.clone().addScaledVector(dir, L);
    }
  }
  // Thumb: from the heel of the palm, forward and down.
  let tp = new THREE.Vector3(-0.012 * s, -0.03 * s, 0.03 * s);
  const tdirs = [new THREE.Vector3(-0.35, -0.7, 0.6).normalize(), new THREE.Vector3(-0.45, -0.85, 0.28).normalize()];
  const tl = [0.036 * s, 0.03 * s];
  for (let k = 0; k < 2; k += 1) {
    const cap = new THREE.CapsuleGeometry((0.0105 - k * 0.0015) * s, tl[k], 4, 10);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tdirs[k]));
    const mid = tp.clone().addScaledVector(tdirs[k], tl[k] / 2);
    cap.translate(mid.x, mid.y, mid.z);
    parts.push(cap);
    tp = tp.clone().addScaledVector(tdirs[k], tl[k]);
  }
  const hand = merge(parts);
  if (side < 0) {
    hand.scale(-1, 1, 1);
    flip(hand);
  }
  return hand;
}

function flip(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Non-indexed after merge: swap the second and third vertex of each triangle.
  for (let k = 0; k < pos.count; k += 3) {
    const bx = pos.getX(k + 1);
    const by = pos.getY(k + 1);
    const bz = pos.getZ(k + 1);
    pos.setXYZ(k + 1, pos.getX(k + 2), pos.getY(k + 2), pos.getZ(k + 2));
    pos.setXYZ(k + 2, bx, by, bz);
  }
  g.computeVertexNormals();
}

/** A boot: a shaped foot with a toe cap and heel, a shaft to `top`, a thick sole. */
function buildBoot(s: number, top: number, width: number): { upper: THREE.BufferGeometry; sole: THREE.BufferGeometry } {
  // Foot rings along z (heel to toe): half width, height.
  const prof: [number, number, number][] = [
    [-0.07, 0.034, 0.085],
    [-0.04, 0.041, 0.11],
    [0.0, 0.045, 0.115],
    [0.05, 0.047, 0.088],
    [0.11, 0.046, 0.058],
    [0.16, 0.041, 0.047],
    [0.195, 0.03, 0.038],
    [0.21, 0.012, 0.03],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const seg = 16;
  prof.forEach(([z, w, h], i) => {
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 0.8) * w * width * s;
      const y = h * s * (0.5 + 0.5 * Math.sign(sn) * Math.pow(Math.abs(sn), 0.7)) + 0.018 * s;
      pos.push(x, y, z * s);
      uv.push(j / seg, z * 4);
      void i;
    }
  });
  const row = seg + 1;
  for (let i = 0; i < prof.length - 1; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = i * row + j;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const foot = new THREE.BufferGeometry();
  foot.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  foot.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  foot.setIndex(idx);
  foot.computeVertexNormals();
  // The shaft rises from the ankle, a little flared at the top.
  const shaft = tube(
    [
      { p: new THREE.Vector3(0, 0.06 * s, -0.018 * s), r: 0.047 * s },
      { p: new THREE.Vector3(0, 0.11 * s, -0.012 * s), r: 0.046 * s },
      { p: new THREE.Vector3(0, top * 0.7, -0.008 * s), r: 0.054 * s },
      { p: new THREE.Vector3(0, top, -0.006 * s), r: 0.058 * s + (top - 0.1) * 0.03 },
    ],
    16,
    0.2,
    (t, a) => 0.0015 * Math.sin(a * 5 + t * 9) * (t < 0.5 ? 1 : 0.3),
  );
  const upper = merge([foot, shaft]);
  const sole = new THREE.BoxGeometry(0.09 * width * s, 0.022 * s, 0.27 * s);
  sole.translate(0, 0.011 * s, 0.068 * s);
  return { upper, sole };
}

// ---------------------------------------------------------------------------
// The figure

export function buildHumanFigure(look: Look, echo: THREE.MeshStandardMaterial | null): HumanFigure {
  const p = look.person;
  const H = look.height;
  const s = H / 1.75;
  const rng = createRng(p.seed);
  const male = p.sex === 'm';
  const build = p.build;

  // Proportions (metres).
  const sw = (male ? 0.19 : 0.17) * s + 0.02 * build;
  const cw = (male ? 0.16 : 0.145) * s + 0.035 * build;
  const cd = (male ? 0.11 : 0.105) * s + 0.035 * build;
  const ww = (male ? 0.14 : 0.122) * s + 0.06 * build;
  const wd = 0.095 * s + 0.055 * build;
  const hw = (male ? 0.16 : 0.178) * s + 0.035 * build;
  const hd = 0.105 * s + 0.03 * build;
  const headScale = H / 7.35 / (2 * HEAD_B);
  // The head sits down into the collar a little: necks are short.
  const headY = H - HEAD_B * headScale - 0.012;
  const waistY = 0.605 * H;

  // Materials ----------------------------------------------------------------
  const materials: THREE.MeshStandardMaterial[] = [];
  const add = <M extends THREE.MeshStandardMaterial>(m: M) => {
    materials.push(m);
    return m;
  };
  const skinTex = bakeSkin(p, look.skin);
  const skin = add(new THREE.MeshStandardMaterial({ map: skinTex.map, normalMap: skinTex.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.52, vertexColors: true, side: THREE.DoubleSide }));
  applySkinShading(skin, new THREE.Color(0.9, 0.35, 0.26).multiplyScalar(p.sex === 'm' ? 0.85 : 1));
  const eyeMat = add(new THREE.MeshStandardMaterial({ map: bakeIris(p.eyes, p.seed), roughness: 0.07 }));
  const hairTex = bakeHair(p);
  const hairMat = add(new THREE.MeshStandardMaterial({ map: hairTex.map, normalMap: hairTex.normalMap, roughness: 0.58, side: THREE.DoubleSide }));
  // Fine strands: the texture repeats round the head.
  for (const t of [hairTex.map, hairTex.normalMap]) t.repeat.set(p.hair.style === 'coils' ? 3 : 5, p.hair.style === 'coils' ? 2 : 3);
  const clothKind: Cloth = p.coat === 'greatcoat' ? 'wool' : p.coat === 'workcoat' ? 'canvas' : p.coat === 'fieldcoat' ? 'waxed' : 'linen';
  const coatTex = bakeCloth(clothKind, look.coat, p.seed);
  const coat = add(new THREE.MeshStandardMaterial({ map: coatTex.map, normalMap: coatTex.normalMap, roughness: clothKind === 'waxed' ? 0.62 : 0.9, side: THREE.DoubleSide }));
  const trouserTex = bakeCloth('serge', p.coat === 'workcoat' ? 0x3a3530 : p.coat === 'fieldcoat' ? 0x5a5040 : 0x22252c, p.seed + 1);
  const trousers = add(new THREE.MeshStandardMaterial({ map: trouserTex.map, normalMap: trouserTex.normalMap, roughness: 0.88 }));
  const leatherTex = bakeLeather(p.coat === 'greatcoat' ? 0x1a1512 : 0x4a3222, p.seed);
  const leather = add(new THREE.MeshStandardMaterial({ map: leatherTex.map, normalMap: leatherTex.normalMap, roughness: p.coat === 'greatcoat' ? 0.38 : 0.55, side: THREE.DoubleSide }));
  const sole = add(new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 0.8 }));
  const brassTrim = look.trim === 0xb08d4a || p.coat === 'workcoat';
  const metal = add(new THREE.MeshStandardMaterial({ color: brassTrim ? 0xb08d4a : look.trim, roughness: 0.32, metalness: brassTrim ? 1 : 0.8 }));
  const lining = add(new THREE.MeshStandardMaterial({ map: bakeCloth('canvas', look.trim, p.seed + 3).map, roughness: 0.85, side: THREE.DoubleSide }));
  const glass = add(new THREE.MeshStandardMaterial({ color: 0x1a2426, roughness: 0.05, metalness: 0.2 }));

  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI;
  group.add(inner);
  const body = new THREE.Group();
  inner.add(body);
  const legs = new THREE.Group();
  body.add(legs);
  const torso = new THREE.Group();
  torso.position.y = waistY;
  body.add(torso);
  const neck = new THREE.Group();
  neck.position.y = 0.84 * H - waistY;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.set(0, headY - 0.84 * H, 0.004);
  head.scale.setScalar(headScale);
  neck.add(head);

  const meshes: THREE.Mesh[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, name: string) => {
    const x = new THREE.Mesh(g, m);
    x.name = `figure:${name}`;
    x.castShadow = true;
    x.receiveShadow = true;
    parent.add(x);
    meshes.push(x);
    return x;
  };
  // Parts attached to the torso are built in body space, then shifted to its pivot.
  const toTorso = (g: THREE.BufferGeometry) => g.translate(0, -waistY, 0);

  // Head -------------------------------------------------------------------
  const hp = buildHead(p);
  mesh(hp.skin, skin, head, 'head');
  const lidsGeo = buildEyelids(hp.eyes, 0);
  mesh(lidsGeo, skin, head, 'lids');
  const eyes: THREE.Group[] = [];
  for (const e of hp.eyes) {
    const pivot = new THREE.Group();
    pivot.position.copy(e);
    head.add(pivot);
    const ball = new THREE.Mesh(hp.eyeball, eyeMat);
    ball.castShadow = false;
    pivot.add(ball);
    eyes.push(pivot);
  }
  if (hp.hair && p.hair.style !== 'crop') mesh(hp.hair, hairMat, head, 'hair');
  if (hp.beard) mesh(hp.beard, hairMat, head, 'beard');
  if (p.hair.style === 'bun') {
    // Hair drawn back into a low bun under the cap.
    const bun = new THREE.SphereGeometry(0.03, 20, 14);
    bun.scale(1, 0.8, 0.85);
    bun.translate(0, -0.035, -HEAD_C * 1.02);
    mesh(bun, hairMat, head, 'bun');
  }

  // Neck, from under the jaw into the collar.
  const neckR = (male ? 0.063 : 0.055) * s + 0.012 * build;
  const neckGeo = tube(
    [
      { p: new THREE.Vector3(0, headY - 0.035 * s, -0.012), r: neckR * 0.95 },
      { p: new THREE.Vector3(0, 0.865 * H, -0.006), r: neckR },
      { p: new THREE.Vector3(0, 0.815 * H, 0), r: neckR * 1.3 },
    ],
    20,
    0.2,
  );
  // Plain skin from the back of the head's texture (below the nape).
  remapUv(neckGeo, 0.02, 0.17, 0.04);
  neckGeo.translate(0, -0.84 * H, 0);
  mesh(merge([neckGeo], true), skin, neck, 'neck');

  // The arms hang outside the body: the chest under them is narrower than
  // the shoulders, and the hands clear the coat's skirt.
  const armR = (male ? 0.056 : 0.05) * s + 0.012 * build;
  const armX = sw + 0.012;
  const chestW = Math.min(cw + 0.02, armX - armR - 0.012);
  const waistW = Math.min(ww + 0.02, chestW - 0.01);
  const hipW = Math.min(hw + 0.03, armX + 0.01);
  // Coat -------------------------------------------------------------------
  const hem = p.coat === 'greatcoat' ? 0.25 * H : p.coat === 'robe' ? 0.03 * H : p.coat === 'workcoat' ? 0.4 * H : 0.43 * H;
  const flare = p.coat === 'robe' ? 0.07 : p.coat === 'greatcoat' ? 0.06 : 0.025;
  const rings: Ring[] = [
    { y: 0.842 * H, w: neckR + 0.006, d: neckR + 0.004, n: 2 },
    { y: 0.832 * H, w: neckR + 0.024, d: neckR + 0.018, n: 2 },
    { y: 0.826 * H, w: sw * 0.55, d: cd * 0.78, n: 2.1 },
    { y: 0.818 * H, w: sw * 0.78, d: cd * 0.86, n: 2.15 },
    { y: 0.808 * H, w: sw * 0.94, d: cd * 0.92, n: 2.2 },
    { y: 0.794 * H, w: armX + armR * 0.6, d: cd * 0.96, n: 2.3 },
    { y: 0.772 * H, w: chestW + 0.012, d: cd + 0.02, z: 0.004, n: 2.3 },
    { y: 0.735 * H, w: chestW, d: cd + 0.03, z: 0.012, n: 2.3 },
    { y: 0.685 * H, w: chestW - 0.006, d: cd + 0.022, z: 0.008, n: 2.2 },
    { y: 0.64 * H, w: waistW + 0.004, d: wd + 0.025, z: 0.004, n: 2.2 },
    { y: waistY, w: waistW, d: wd + 0.02, n: 2.2 },
    { y: 0.565 * H, w: waistW + 0.014, d: wd + 0.03, n: 2.2 },
    { y: 0.515 * H, w: hipW, d: hd + 0.03, z: -0.004, n: 2.2 },
    { y: 0.47 * H, w: hipW + 0.012, d: hd + 0.045, z: -0.006, n: 2.1 },
  ];
  const skirtTop = 0.47 * H;
  if (hem < skirtTop - 0.01) {
    const fl = flare * (skirtTop - hem) / (0.2 * H);
    rings.push({ y: (skirtTop + hem) / 2, w: hipW + 0.018 + fl * 0.5, d: hd + 0.05 + fl * 0.4, z: -0.008, n: 2 });
    rings.push({ y: hem, w: hipW + 0.024 + fl, d: hd + 0.055 + fl * 0.8, z: -0.01, n: 2 });
  } else {
    rings[rings.length - 1].y = hem;
  }
  const phase = rng() * 6;
  const coatFold = (th: number, y: number) => {
    // Hanging folds below the waist, deeper toward the hem and at the back.
    const below = smooth(waistY - 0.02, hem, y);
    const back = 0.6 + 0.4 * smooth(0.3, -0.8, Math.sin(th));
    let f = below * back * (0.007 + 0.005 * flare * 10) * (Math.sin(th * 9 + phase + y * 3) * 0.6 + Math.sin(th * 5 - phase * 0.7) * 0.4);
    // Drag creases across the back and under the arms.
    f += 0.002 * smooth(0.72 * H, 0.78 * H, y) * (1 - smooth(0.78 * H, 0.8 * H, y)) * Math.sin(th * 14 + phase);
    // The front edge overlaps: a step where the right panel lies over the left.
    if (y < 0.8 * H) f += 0.0045 * Math.exp(-((th - (Math.PI / 2 + 0.11)) ** 2) / 0.0012) * smooth(0.8 * H, 0.78 * H, y);
    return f;
  };
  const coatGeo = loft(rings, 64, 4, 0.35, coatFold);
  mesh(toTorso(coatGeo), coat, torso, 'coat');
  // The hem's inside, so the coat has thickness when seen from below.
  if (hem < skirtTop) {
    const inner2 = inside(loft(rings.slice(-3), 64, 2, 0.35, coatFold), 0.006);
    mesh(toTorso(inner2), lining, torso, 'lining');
  }

  // Sleeves, from the shoulder round the elbow to the cuff.
  const hands: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    // The skirt at the wrist's height: the hand must hang clear of it.
    const skirtW = ringAt(rings, 0.48 * H).w;
    const shoulder = new THREE.Vector3(side * armX, 0.785 * H, -0.004);
    const elbow = new THREE.Vector3(side * (armX + 0.012 + 0.015 * build), 0.618 * H, -0.024);
    const wrist = new THREE.Vector3(side * Math.max(armX + 0.004, skirtW + armR * 0.85 + 0.006), 0.482 * H, 0.03);
    // The sleeve rises into the shoulder, under the coat's own curve.
    const upper = curve(new THREE.Vector3(side * (armX - 0.035), 0.796 * H, 0), shoulder.clone().lerp(elbow, 0.5).add(new THREE.Vector3(side * 0.006, 0, 0)), elbow, [armR * 0.95, armR, armR * 0.86], 8);
    const fore = curve(elbow, elbow.clone().lerp(wrist, 0.5), wrist, [armR * 0.86, armR * 0.82, armR * 0.76], 8);
    const sleeve = tube([...upper, ...fore.slice(1)], 20, 0.35, (t, a) => {
      // Bunching inside the elbow.
      const e = Math.exp(-((t - 0.5) ** 2) / 0.004);
      return e * 0.004 * Math.sin(a * 3 + side) + 0.0012 * Math.sin(a * 7 + t * 30);
    });
    mesh(toTorso(sleeve), coat, torso, `sleeve${side}`);
    // A turned-back cuff.
    const dir = wrist.clone().sub(elbow).normalize();
    const cuff = tube(
      [
        { p: wrist.clone().addScaledVector(dir, -0.07), r: armR * 0.84 },
        { p: wrist.clone().addScaledVector(dir, -0.012), r: armR * 0.84 },
        { p: wrist.clone().addScaledVector(dir, 0.002), r: armR * 0.8 },
      ],
      20,
      0.35,
    );
    mesh(toTorso(cuff), p.coat === 'greatcoat' ? coat : lining, torso, `cuff${side}`);
    // The hand, hanging from the wrist.
    const hand = buildHand(s * (male ? 1.06 : 0.95), side, rng);
    hand.translate(wrist.x - side * 0.004, wrist.y + 0.012, wrist.z + 0.002);
    remapUv(hand, 0.03, 0.2, 0.03);
    hands.push(mesh(toTorso(merge([hand], true)), skin, torso, `hand${side}`));
  }

  // Belt and buckle at the waist.
  const beltRing = ringAt(rings, waistY);
  const belt = loft(
    [
      { ...beltRing, y: waistY + 0.022, w: beltRing.w + 0.005, d: beltRing.d + 0.005 },
      { ...beltRing, y: waistY - 0.022, w: beltRing.w + 0.006, d: beltRing.d + 0.006 },
    ],
    48,
    1,
    0.2,
  );
  mesh(toTorso(belt), leather, torso, 'belt');
  const front = (y: number, th = Math.PI / 2) => ringPoint(ringAt(rings, y), th, new THREE.Vector3());
  const buckleAt = front(waistY);
  const buckle = new THREE.BoxGeometry(0.055, 0.05, 0.008);
  buckle.translate(0, waistY, buckleAt.z + 0.011);
  const trimParts: THREE.BufferGeometry[] = [buckle];

  // Buttons down the front.
  const button = (x: number, y: number, r: number) => {
    const th = Math.PI / 2 - x / Math.max(0.05, ringAt(rings, y).w);
    const at = front(y, th);
    const b = new THREE.CylinderGeometry(r, r * 0.9, 0.006, 12);
    b.rotateX(Math.PI / 2);
    b.translate(at.x, y, at.z + 0.004);
    trimParts.push(b);
  };
  if (p.coat === 'greatcoat') {
    for (const y of [0.772, 0.728, 0.684, 0.642]) for (const x of [-0.062, 0.062]) button(x, y * H, 0.0105);
  } else if (p.coat === 'workcoat') {
    for (const y of [0.78, 0.735, 0.69, 0.645]) button(0.004, y * H, 0.009);
  } else if (p.coat === 'fieldcoat') {
    for (const y of [0.775, 0.73, 0.685, 0.64]) button(0.01, y * H, 0.0085);
  }

  // Pockets: patch pockets with flaps on the hips (and chest on the field
  // coat), laid over the coat's own curve so they sit on the cloth.
  const onCoat = (x0: number, y0: number, w: number, h: number, lift: (v: number) => number) => {
    const g = new THREE.PlaneGeometry(w, h, 6, 6);
    const pos = g.getAttribute('position');
    const at = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      const x = x0 + pos.getX(i);
      const y = y0 + pos.getY(i);
      const r = ringAt(rings, y);
      const q = Math.max(-1, Math.min(1, x / r.w));
      ringPoint(r, Math.acos(Math.sign(q) * Math.pow(Math.abs(q), (r.n ?? 2.2) / 2)), at);
      const dz = at.z - (r.z ?? 0);
      const len = Math.hypot(at.x, dz) || 1;
      const l = lift((pos.getY(i) + h / 2) / h);
      pos.setXYZ(i, at.x + (at.x / len) * l, y, at.z + (dz / len) * l);
    }
    g.computeVertexNormals();
    return g;
  };
  const pocket = (x: number, y: number, w: number, h: number) => [
    onCoat(x, y - h * 0.1, w, h, () => 0.004),
    // The flap stands off a little more at its hem.
    onCoat(x, y + h * 0.42, w * 1.06, h * 0.32, (v) => 0.006 + 0.004 * (1 - v)),
  ];
  const pocketParts: THREE.BufferGeometry[] = [];
  if (p.coat === 'workcoat' || p.coat === 'fieldcoat') {
    for (const side of [1, -1]) pocketParts.push(...pocket(side * 0.1, 0.515 * H, 0.15, 0.16));
  }
  if (p.coat === 'fieldcoat') {
    for (const side of [1, -1]) pocketParts.push(...pocket(side * 0.075, 0.735 * H, 0.1, 0.11));
  }
  if (pocketParts.length) mesh(toTorso(merge(pocketParts)), coat, torso, 'pockets');

  // Collar.
  if (p.coat === 'greatcoat') {
    // A tall stand collar, open at the throat, piped in brass.
    const collar = loft(
      [
        { y: 0.878 * H, w: neckR + 0.018, d: neckR + 0.014, n: 2 },
        { y: 0.838 * H, w: neckR + 0.012, d: neckR + 0.01, n: 2 },
      ],
      40,
      3,
      0.35,
      undefined,
      [Math.PI / 2 + 0.28, Math.PI * 2 + Math.PI / 2 - 0.28],
    );
    mesh(toTorso(merge([collar, inside(collar, 0.005)])), coat, torso, 'collar');
    // Shoulder boards.
    for (const side of [1, -1]) {
      const board = new THREE.BoxGeometry(0.11, 0.012, 0.06);
      board.rotateZ(-side * 0.22);
      board.translate(side * sw * 0.72, 0.826 * H, 0);
      mesh(toTorso(board), coat, torso, `board${side}`);
      const edge = new THREE.BoxGeometry(0.02, 0.014, 0.062);
      edge.rotateZ(-side * 0.22);
      edge.translate(side * (sw * 0.72 + 0.05), 0.815 * H, 0);
      trimParts.push(edge);
    }
  } else if (p.coat !== 'robe') {
    // A turned-down collar lying over the shoulders, lining showing.
    const collar = loft(
      [
        { y: 0.858 * H, w: neckR + 0.014, d: neckR + 0.012, n: 2 },
        { y: 0.838 * H, w: neckR + 0.04, d: neckR + 0.036, n: 2 },
        { y: 0.824 * H, w: neckR + 0.075, d: neckR + 0.062, n: 2.2 },
      ],
      40,
      2,
      0.35,
      undefined,
      [Math.PI / 2 + 0.34, Math.PI * 2 + Math.PI / 2 - 0.34],
    );
    mesh(toTorso(collar), coat, torso, 'collar');
    mesh(toTorso(inside(collar, 0.004)), lining, torso, 'collar-lining');
  }

  // What each carries.
  const leatherParts: THREE.BufferGeometry[] = [];
  if (p.coat === 'workcoat') {
    // A tool belt low on the hips, with pouches and a hammer.
    const low = ringAt(rings, 0.53 * H);
    leatherParts.push(
      loft(
        [
          { ...low, y: 0.545 * H, w: low.w + 0.008, d: low.d + 0.008 },
          { ...low, y: 0.515 * H, w: low.w + 0.009, d: low.d + 0.009 },
        ],
        48,
        1,
        0.2,
      ),
    );
    for (const [x, zz, w] of [
      [0.13, 0.06, 0.08],
      [-0.12, 0.07, 0.07],
      [0.17, -0.04, 0.06],
    ]) {
      const pouch = new THREE.BoxGeometry(w, 0.09, 0.045);
      pouch.rotateY(Math.atan2(x, zz) * 0.8);
      pouch.translate(x * (1 + build * 0.3), 0.49 * H, zz + Math.sign(zz) * low.d * 0.8);
      leatherParts.push(pouch);
    }
    const handle = new THREE.CylinderGeometry(0.012, 0.014, 0.28, 8);
    handle.translate(-0.19 - 0.04 * build, 0.45 * H, 0.02);
    leatherParts.push(handle);
    const hammer = new THREE.BoxGeometry(0.03, 0.03, 0.1);
    hammer.translate(-0.19 - 0.04 * build, 0.45 * H + 0.14, 0.02);
    trimParts.push(hammer);
  }
  if (p.coat === 'fieldcoat') {
    // A satchel on the right hip, its strap across the chest from the left shoulder.
    const bag = new THREE.BoxGeometry(0.26, 0.2, 0.075);
    bag.rotateY(-0.5);
    bag.translate(hw + 0.06, 0.5 * H, 0.03);
    leatherParts.push(bag);
    const flapB = new THREE.BoxGeometry(0.27, 0.12, 0.08);
    flapB.rotateY(-0.5);
    flapB.translate(hw + 0.062, 0.54 * H, 0.032);
    leatherParts.push(flapB);
    // From the far shoulder (theta near π, -x) across the chest (π/2) to
    // the bag's hip (+x): a smooth curve laid just over the coat.
    const on = (y: number, th: number) => {
      const r = ringAt(rings, y * H);
      return ringPoint({ ...r, w: r.w + 0.008, d: r.d + 0.008 }, th, new THREE.Vector3());
    };
    const path = new THREE.CatmullRomCurve3([on(0.8, Math.PI - 0.5), on(0.755, Math.PI / 2 + 0.55), on(0.68, Math.PI / 2 - 0.05), on(0.6, 0.55), on(0.545, 0.3)]);
    leatherParts.push(strap(path.getPoints(40), 0.04, 0.008));
  }
  if (leatherParts.length) mesh(toTorso(merge(leatherParts)), leather, torso, 'kit');
  mesh(toTorso(merge(trimParts)), metal, torso, 'trim');

  // Legs and boots (below the coat; static).
  const legR = (male ? 0.082 : 0.078) * s + 0.02 * build;
  const tallBoots = p.coat === 'greatcoat';
  // Tall riding boots take the trousers inside them.
  const bootTop = tallBoots ? 0.27 * H : 0.13 * H;
  for (const side of [1, -1]) {
    const hipP = new THREE.Vector3(side * hw * 0.5, 0.5 * H, 0);
    const knee = new THREE.Vector3(side * hw * 0.48, 0.285 * H, 0.012);
    const ankle = new THREE.Vector3(side * hw * 0.44, 0.06 * H, -0.012);
    const leg = tube(
      [
        { p: hipP, r: legR },
        { p: hipP.clone().lerp(knee, 0.5), r: legR * 0.85 },
        { p: knee, r: legR * 0.66 },
        { p: knee.clone().lerp(ankle, 0.45), r: legR * (tallBoots ? 0.56 : 0.68) },
        { p: ankle, r: legR * (tallBoots ? 0.44 : 0.56) },
      ],
      18,
      0.35,
      (t, a) => 0.0025 * Math.sin(a * 4 + t * 20) * smooth(0.4, 0.7, t),
    );
    mesh(leg, trousers, legs, `leg${side}`);
    const boot = buildBoot(s, bootTop, male ? 1.08 : 0.95);
    for (const g2 of [boot.upper, boot.sole]) {
      g2.rotateY(side * 0.08);
      g2.translate(ankle.x, 0, ankle.z - 0.01);
    }
    mesh(boot.upper, leather, legs, `boot${side}`);
    mesh(boot.sole, sole, legs, `sole${side}`);
  }

  // Hats and headwear (head space, before the head's scale).
  if (look.hat === 'captain') {
    const cap = buildCaptainCap();
    mesh(cap.crown, coat, head, 'cap');
    mesh(cap.visor, leather, head, 'visor');
    mesh(cap.badge, metal, head, 'badge');
  } else if (look.hat === 'goggles') {
    const gg = buildGoggles();
    mesh(gg.strap, leather, head, 'strap');
    mesh(gg.rims, metal, head, 'rims');
    mesh(gg.lenses, glass, head, 'lenses');
  } else if (look.hat === 'hood') {
    const hood = buildHood();
    mesh(hood, coat, head, 'hood');
  }

  // An echo is all light: every part in the one glowing, see-through material.
  if (echo) {
    echo.side = THREE.DoubleSide;
    for (const m of meshes) {
      m.material = echo;
      m.castShadow = false;
    }
    for (const e of eyes) (e.children[0] as THREE.Mesh).material = echo;
    materials.length = 0;
  }

  // Life -------------------------------------------------------------------
  const lids = meshes.find((m) => m.name === 'figure:lids') as THREE.Mesh;
  const lidPos = lids.geometry.getAttribute('position') as THREE.BufferAttribute;
  const lidNrm = lids.geometry.getAttribute('normal') as THREE.BufferAttribute;
  let blinkAt = 1 + rng() * 3;
  let blinkT = -1;
  let lastBlink = 0;
  const seedPhase = rng() * 10;
  const target = new THREE.Vector3();
  const local = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let eyeYaw = 0;
  let eyePitch = 0;
  const setBlink = (b: number) => {
    if (Math.abs(b - lastBlink) < 0.02) return;
    lastBlink = b;
    const g2 = buildEyelids(hp.eyes, b);
    lidPos.copyArray(g2.getAttribute('position').array as Float32Array);
    lidNrm.copyArray(g2.getAttribute('normal').array as Float32Array);
    lidPos.needsUpdate = true;
    lidNrm.needsUpdate = true;
    g2.dispose();
  };

  const update = (dt: number, time: number, lookAt: THREE.Vector3 | null) => {
    // Breathing in the chest, and a slow shift of weight from foot to foot.
    const breath = Math.sin(time * 1.55 + seedPhase);
    torso.scale.set(1 + breath * 0.004, 1 + breath * 0.003, 1 + breath * 0.009);
    const shift = Math.sin(time * 0.37 + seedPhase);
    torso.rotation.z = shift * 0.012;
    legs.rotation.z = -shift * 0.004;
    // Head and eyes turn to whoever is near, within what a neck can do.
    let wantYaw = Math.sin(time * 0.21 + seedPhase) * 0.12;
    let wantPitch = Math.sin(time * 0.17 + seedPhase * 2) * 0.04 - 0.03;
    if (lookAt) {
      group.updateMatrixWorld(true);
      local.copy(lookAt);
      neck.worldToLocal(local);
      wantYaw = Math.atan2(local.x, local.z);
      wantPitch = Math.atan2(local.y - (headY - 0.84 * H), Math.hypot(local.x, local.z));
    }
    const clampedYaw = Math.max(-1.1, Math.min(1.1, wantYaw));
    const clampedPitch = Math.max(-0.4, Math.min(0.35, wantPitch));
    const k = Math.min(1, dt * 3);
    yaw += (clampedYaw - yaw) * k;
    pitch += (clampedPitch - pitch) * k;
    neck.rotation.y = yaw * 0.35;
    neck.rotation.x = -pitch * 0.3;
    head.rotation.y = yaw * 0.65;
    head.rotation.x = -pitch * 0.7;
    // The eyes lead the head and take up what it cannot turn.
    const ey = Math.max(-0.35, Math.min(0.35, wantYaw - yaw + (lookAt ? 0 : Math.sin(time * 0.9) * 0.05)));
    const ep = Math.max(-0.25, Math.min(0.25, wantPitch - pitch));
    const ke = Math.min(1, dt * 14);
    eyeYaw += (ey - eyeYaw) * ke;
    eyePitch += (ep - eyePitch) * ke;
    for (const e of eyes) {
      e.rotation.y = eyeYaw;
      e.rotation.x = -eyePitch;
    }
    // Blinks every few seconds, a sixth of a second each.
    if (blinkT < 0 && time > blinkAt) blinkT = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      const b = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.1);
      setBlink(b);
      if (blinkT > 0.17) {
        blinkT = -1;
        setBlink(0);
        blinkAt = time + 2 + rng() * 4.5;
      }
    }
    void target;
    void hands;
  };

  return { group, body, head, materials, update };
}

/** Point a part's UVs at a small plain patch of the head's skin texture. */
function remapUv(g: THREE.BufferGeometry, u0: number, v0: number, size: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, u0 + (Math.abs(uv.getX(i) * 7.3) % 1) * size, v0 + (Math.abs(uv.getY(i) * 5.1) % 1) * size);
}

/** A flat strap laid along points on the body, facing out from its axis. */
function strap(points: THREE.Vector3[], width: number, thick: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];
    const prev = points[Math.max(0, i - 1)];
    const t = next.clone().sub(prev).normalize();
    const out = new THREE.Vector3(p.x, 0, p.z).normalize();
    const side = new THREE.Vector3().crossVectors(t, out).normalize();
    const base = p.clone().addScaledVector(out, 0.004);
    for (const [a, b] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ]) {
      const q = base.clone().addScaledVector(side, (a * width) / 2).addScaledVector(out, b * thick);
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 4;
    const b = a + 4;
    for (let k = 0; k < 4; k += 1) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An officer's peaked cap: a stiff crown with a raised front, a leather visor, a brass badge. */
function buildCaptainCap(): { crown: THREE.BufferGeometry; visor: THREE.BufferGeometry; badge: THREE.BufferGeometry } {
  const y0 = 0.05;
  const crownRings: Ring[] = [
    { y: y0 + 0.075, w: 0.1, d: 0.118, z: -0.004, n: 2.1 },
    { y: y0 + 0.058, w: 0.098, d: 0.114, z: -0.004, n: 2.1 },
    { y: y0 + 0.036, w: 0.083, d: 0.1, z: -0.002, n: 2 },
    { y: y0, w: 0.081, d: 0.098, n: 2 },
  ];
  // The front rises into a saddle.
  const saddle = (th: number, y: number) => (y > y0 + 0.05 ? 0.008 * Math.max(0, Math.sin(th)) : 0);
  const side = loft(crownRings, 48, 2, 0.35, saddle);
  const top = new THREE.CircleGeometry(1, 48);
  top.rotateX(-Math.PI / 2);
  top.scale(0.1, 1, 0.118);
  top.translate(0, y0 + 0.075 + 0.004, -0.004);
  const crown = merge([side, top]);
  crown.rotateX(0.06);
  // Visor: a curved leather shelf from the front of the band, angled down.
  const vpos: number[] = [];
  const vidx: number[] = [];
  const segs = 20;
  for (let i = 0; i <= segs; i += 1) {
    const th = Math.PI / 2 - 1.05 + (2.1 * i) / segs;
    const ix = Math.cos(th) * 0.081;
    const iz = Math.sin(th) * 0.098;
    const reach = 0.055 * Math.pow(Math.sin(th), 1.5);
    const ox = Math.cos(th) * (0.081 + reach * 0.7);
    const oz = Math.sin(th) * (0.098 + reach);
    for (const [x, z, y] of [
      [ix, iz, y0 + 0.002],
      [ox, oz, y0 - 0.022 * Math.pow(Math.sin(th), 1.2)],
    ]) vpos.push(x, y, z);
  }
  for (let i = 0; i < segs; i += 1) {
    const a = i * 2;
    vidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const visor = new THREE.BufferGeometry();
  visor.setAttribute('position', new THREE.Float32BufferAttribute(vpos, 3));
  visor.setIndex(vidx);
  visor.computeVertexNormals();
  visor.rotateX(0.06);
  const disc = new THREE.CylinderGeometry(0.014, 0.014, 0.004, 8);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, y0 + 0.05, 0.109);
  const cord = new THREE.TorusGeometry(0.098, 0.0022, 6, 40, 1.9);
  cord.rotateX(Math.PI / 2);
  cord.rotateY(-Math.PI / 2 + 0.95);
  cord.scale(0.83, 1, 1);
  cord.translate(0, y0 + 0.006, 0);
  const badge = merge([disc, cord]);
  badge.rotateX(0.06);
  return { crown, visor, badge };
}

/** Brass-rimmed goggles pushed up on the forehead, on a leather strap. */
function buildGoggles(): { strap: THREE.BufferGeometry; rims: THREE.BufferGeometry; lenses: THREE.BufferGeometry } {
  const band = new THREE.TorusGeometry(1, 0.1, 6, 48);
  band.rotateX(Math.PI / 2);
  band.scale(0.079, 0.14, 0.102);
  band.rotateX(-0.35);
  band.translate(0, 0.062, -0.006);
  const rims: THREE.BufferGeometry[] = [];
  const lenses: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.023, 0.026, 0.022, 20, 1, true);
    cup.rotateX(Math.PI / 2 - 0.55);
    cup.translate(side * 0.033, 0.074, 0.084);
    rims.push(cup);
    const ring = new THREE.TorusGeometry(0.023, 0.0035, 6, 24);
    ring.rotateX(-0.55);
    ring.translate(side * 0.033, 0.08, 0.094);
    rims.push(ring);
    const lens = new THREE.CircleGeometry(0.022, 24);
    lens.rotateX(-0.55);
    lens.translate(side * 0.033, 0.08, 0.093);
    lenses.push(lens);
  }
  const bridge = new THREE.BoxGeometry(0.02, 0.006, 0.006);
  bridge.translate(0, 0.077, 0.09);
  rims.push(bridge);
  return { strap: band, rims: merge(rims), lenses: merge(lenses) };
}

/** A deep hood, open at the face, falling to the shoulders. */
function buildHood(): THREE.BufferGeometry {
  const shell = new THREE.SphereGeometry(0.13, 36, 24, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72);
  shell.scale(1, 1.15, 1.1);
  shell.translate(0, 0.01, -0.012);
  return shell;
}
