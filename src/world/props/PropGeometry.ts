import * as THREE from 'three';
import { createRng } from '../../core/rng';

// Small procedural props (vertex-coloured): fallen sticks, driftwood, fibre
// plants, mushroom clusters, herbs, shells, clay deposits and berry clusters.

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vertex(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A tube along a polyline with per-ring radius and colour. */
function tube(b: MeshBuilder, points: THREE.Vector3[], radii: number[], colors: THREE.Color[], sides: number, cap = true): void {
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const bnorm = new THREE.Vector3();
  const rings: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    t.subVectors(next, prev).normalize();
    n.crossVectors(t, Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    bnorm.crossVectors(t, n).normalize();
    rings.push(b.pos.length / 3);
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      const dir = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(bnorm, Math.sin(a));
      b.vertex(points[i].clone().addScaledVector(dir, radii[i]), dir, colors[i]);
    }
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = rings[i] + s;
      const c = rings[i] + ((s + 1) % sides);
      const d = rings[i + 1] + s;
      const e = rings[i + 1] + ((s + 1) % sides);
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
  }
  if (cap) {
    for (const [ring, sign] of [
      [0, -1],
      [points.length - 1, 1],
    ] as const) {
      const center = points[ring];
      const dir = points[ring === 0 ? 1 : ring - 1].clone().sub(center).normalize().multiplyScalar(-1);
      const cutColor = new THREE.Color(0.62, 0.5, 0.34);
      const c0 = b.vertex(center, dir, cutColor);
      const start = b.pos.length / 3;
      for (let s = 0; s < sides; s += 1) {
        const p = new THREE.Vector3(b.pos[(rings[ring] + s) * 3], b.pos[(rings[ring] + s) * 3 + 1], b.pos[(rings[ring] + s) * 3 + 2]);
        b.vertex(p, dir, cutColor.clone().multiplyScalar(0.85));
      }
      for (let s = 0; s < sides; s += 1) {
        const a = start + s;
        const c = start + ((s + 1) % sides);
        if (sign > 0) b.tri(c0, a, c);
        else b.tri(c0, c, a);
      }
    }
  }
}

function curvedPath(rng: () => number, length: number, segments: number, bend: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const phase = rng() * Math.PI;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    pts.push(new THREE.Vector3(-length / 2 + t * length, Math.sin(t * Math.PI) * bend * 0.3, Math.sin(t * Math.PI * 1.3 + phase) * bend));
  }
  return pts;
}

/** A fallen branch lying on the ground (length ~0.8–1.2 m). */
export function stickGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const length = 0.8 + rng() * 0.45;
  const pts = curvedPath(rng, length, 6, 0.05 + rng() * 0.05);
  const bark = new THREE.Color().setHSL(0.07 + rng() * 0.03, 0.32, 0.2 + rng() * 0.06);
  const radii = pts.map((_, i) => 0.024 - 0.008 * (i / (pts.length - 1)));
  for (const p of pts) p.y += 0.022;
  tube(b, pts, radii, pts.map((_, i) => bark.clone().multiplyScalar(0.9 + 0.2 * Math.sin(i * 2.1))), 6);
  // A twig.
  const at = pts[2];
  const dir = new THREE.Vector3(0.3, 0.1, rng() < 0.5 ? 0.9 : -0.9).normalize();
  const twig = [at.clone(), at.clone().addScaledVector(dir, 0.14), at.clone().addScaledVector(dir, 0.26).add(new THREE.Vector3(0, 0.02, 0))];
  tube(b, twig, [0.011, 0.008, 0.005], twig.map(() => bark), 4, false);
  return b.build();
}

/** Sea-bleached driftwood log (~1.6–2.4 m). */
export function driftwoodGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const length = 1.6 + rng() * 0.8;
  const pts = curvedPath(rng, length, 8, 0.12);
  const base = new THREE.Color(0.62, 0.58, 0.52);
  const radii = pts.map((_, i) => 0.085 * (1 - 0.45 * (i / (pts.length - 1))) * (0.9 + 0.2 * rng()));
  for (let i = 0; i < pts.length; i += 1) pts[i].y += radii[i] * 0.8;
  tube(b, pts, radii, pts.map(() => base.clone().multiplyScalar(0.85 + 0.25 * rng())), 7);
  for (let k = 0; k < 2; k += 1) {
    const at = pts[2 + k * 3];
    const dir = new THREE.Vector3(0.2, 0.35, rng() < 0.5 ? 1 : -1).normalize();
    const stub = [at.clone(), at.clone().addScaledVector(dir, 0.22), at.clone().addScaledVector(dir, 0.38)];
    tube(b, stub, [0.035, 0.022, 0.01], stub.map(() => base), 5, false);
  }
  return b.build();
}

/** Flax-like fibre plant: long blades and seed stalks (~0.7–1 m). */
export function fiberPlantGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const blades = 14;
  for (let k = 0; k < blades; k += 1) {
    const yaw = (k / blades) * Math.PI * 2 + rng() * 0.5;
    const lean = 0.15 + rng() * 0.35;
    const height = 0.55 + rng() * 0.45;
    const width = 0.018 + rng() * 0.012;
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const base = dir.clone().multiplyScalar(0.03 + rng() * 0.05);
    let prevL = -1;
    let prevR = -1;
    const segs = 4;
    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs;
      const p = base.clone().addScaledVector(dir, lean * height * t * t).add(new THREE.Vector3(0, height * t, 0));
      const w = width * (1 - t * 0.85);
      const n = new THREE.Vector3(dir.x, 0.4, dir.z).normalize();
      const col = new THREE.Color().setHSL(0.2 + rng() * 0.04 - t * 0.02, 0.45, 0.2 + t * 0.14);
      const l = b.vertex(p.clone().addScaledVector(side, -w), n, col);
      const r = b.vertex(p.clone().addScaledVector(side, w), n, col);
      if (prevL >= 0) {
        b.tri(prevL, l, prevR);
        b.tri(prevR, l, r);
      }
      prevL = l;
      prevR = r;
    }
  }
  // Seed stalks with pale heads.
  for (let k = 0; k < 4; k += 1) {
    const yaw = rng() * Math.PI * 2;
    const h = 0.8 + rng() * 0.3;
    const top = new THREE.Vector3(Math.cos(yaw) * 0.12, h, Math.sin(yaw) * 0.12);
    const stalk = [new THREE.Vector3(0, 0, 0), top.clone().multiplyScalar(0.5), top];
    tube(b, stalk, [0.005, 0.004, 0.003], stalk.map(() => new THREE.Color(0.35, 0.36, 0.18)), 3, false);
    const headColor = new THREE.Color(0.72, 0.64, 0.4);
    const head = [top.clone(), top.clone().add(new THREE.Vector3(0, 0.07, 0))];
    tube(b, head, [0.012, 0.004], head.map(() => headColor), 4, false);
  }
  return b.build();
}

function lathe(b: MeshBuilder, profile: [number, number][], sides: number, color: (t: number) => THREE.Color, offset: THREE.Vector3, tilt: THREE.Quaternion): void {
  const start = b.pos.length / 3;
  for (let i = 0; i < profile.length; i += 1) {
    const [r, y] = profile[i];
    const prev = profile[Math.max(0, i - 1)];
    const next = profile[Math.min(profile.length - 1, i + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).applyQuaternion(tilt).add(offset);
      const n = new THREE.Vector3(Math.cos(a) * dy, -dr, Math.sin(a) * dy).normalize().applyQuaternion(tilt);
      b.vertex(p, n, color(i / (profile.length - 1)));
    }
  }
  for (let i = 0; i < profile.length - 1; i += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = start + i * sides + s;
      const c = start + i * sides + ((s + 1) % sides);
      const d = a + sides;
      const e = c + sides;
      b.tri(a, c, d);
      b.tri(c, e, d);
    }
  }
}

/** Two to four capped mushrooms. */
export function mushroomGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const count = 2 + Math.floor(rng() * 3);
  const capHue = 0.07 + rng() * 0.04;
  for (let k = 0; k < count; k += 1) {
    const scale = 0.6 + rng() * 0.6;
    const offset = new THREE.Vector3((rng() - 0.5) * 0.18, 0, (rng() - 0.5) * 0.18);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
    const h = 0.07 * scale;
    const stem: [number, number][] = [
      [0.012 * scale, 0],
      [0.011 * scale, h * 0.5],
      [0.009 * scale, h],
    ];
    lathe(b, stem, 6, () => new THREE.Color(0.78, 0.74, 0.64), offset, tilt);
    const r = 0.045 * scale;
    const cap: [number, number][] = [
      [0.006 * scale, h * 0.92],
      [r * 0.95, h * 0.95],
      [r, h * 1.05],
      [r * 0.8, h * 1.3],
      [r * 0.45, h * 1.48],
      [0.001, h * 1.53],
    ];
    const capColor = new THREE.Color().setHSL(capHue, 0.5, 0.26 + rng() * 0.08);
    lathe(b, cap, 9, (t) => (t < 0.25 ? new THREE.Color(0.7, 0.62, 0.5) : capColor.clone().multiplyScalar(0.85 + t * 0.3)), offset, tilt);
  }
  return b.build();
}

/** Low rosette of broad herb leaves (~0.3 m). */
export function herbGeometry(seed: number, hue = 0.28): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const leaves = 7 + Math.floor(rng() * 4);
  for (let k = 0; k < leaves; k += 1) {
    const yaw = (k / leaves) * Math.PI * 2 + rng() * 0.4;
    const len = 0.14 + rng() * 0.12;
    const lift = 0.25 + rng() * 0.5;
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const col = new THREE.Color().setHSL(hue + rng() * 0.04, 0.5, 0.22 + rng() * 0.08);
    const pts: number[][] = [];
    const segs = 4;
    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs;
      const w = Math.sin(t * Math.PI) * 0.035 * (0.8 + rng() * 0.4) + 0.002;
      const p = dir.clone().multiplyScalar(len * t).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 0.8) * lift * len + 0.01, 0));
      const n = new THREE.Vector3(-dir.x * 0.3, 1, -dir.z * 0.3).normalize();
      const l = b.vertex(p.clone().addScaledVector(side, -w), n, col.clone().multiplyScalar(0.9 + t * 0.2));
      const r = b.vertex(p.clone().addScaledVector(side, w), n, col.clone().multiplyScalar(0.9 + t * 0.2));
      pts.push([l, r]);
    }
    for (let s = 0; s < segs; s += 1) {
      b.tri(pts[s][0], pts[s + 1][0], pts[s][1]);
      b.tri(pts[s][1], pts[s + 1][0], pts[s + 1][1]);
    }
  }
  return b.build();
}

/** A ribbed scallop shell (~8 cm). */
export function shellGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const ribs = 9;
  const radius = 0.05 + rng() * 0.03;
  const base = new THREE.Color().setHSL(0.06 + rng() * 0.05, 0.35, 0.72);
  const center = b.vertex(new THREE.Vector3(0, 0.012, -radius * 0.45), new THREE.Vector3(0, 1, 0), base.clone().multiplyScalar(0.8));
  const ring: number[] = [];
  for (let k = 0; k <= ribs * 2; k += 1) {
    const a = -1.1 + (k / (ribs * 2)) * 2.2;
    const r = radius * (k % 2 === 0 ? 1 : 0.94);
    const p = new THREE.Vector3(Math.sin(a) * r, 0.004 + (k % 2) * 0.004, -radius * 0.45 + Math.cos(a) * r);
    ring.push(b.vertex(p, new THREE.Vector3(0, 1, 0), base.clone().multiplyScalar(k % 2 ? 0.9 : 1.05)));
  }
  for (let k = 0; k < ring.length - 1; k += 1) b.tri(center, ring[k + 1], ring[k]);
  return b.build();
}

/** Grey riverbank clay: a low irregular slick mound (~1.4 m). */
export function clayGeometry(seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const sides = 14;
  const rings = 3;
  const radius = 0.6 + rng() * 0.3;
  const lobes = Array.from({ length: sides }, () => 0.75 + rng() * 0.45);
  const center = b.vertex(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 1, 0), new THREE.Color(0.42, 0.38, 0.33));
  let prev: number[] = [];
  for (let r = 1; r <= rings; r += 1) {
    const t = r / rings;
    const ring: number[] = [];
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      const rr = radius * t * lobes[s];
      const y = 0.1 * (1 - t * t) - 0.02 * t;
      const n = new THREE.Vector3(Math.cos(a) * t * 0.4, 1, Math.sin(a) * t * 0.4).normalize();
      ring.push(b.vertex(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), n, new THREE.Color(0.44, 0.4, 0.35).multiplyScalar(0.85 + rng() * 0.25)));
    }
    for (let s = 0; s < sides; s += 1) {
      const s2 = (s + 1) % sides;
      if (r === 1) b.tri(center, ring[s2], ring[s]);
      else {
        b.tri(prev[s], ring[s2], ring[s]);
        b.tri(prev[s], prev[s2], ring[s2]);
      }
    }
    prev = ring;
  }
  return b.build();
}

/** Berry clusters scattered over a bush canopy (positions sampled from its leaves). */
export function berryGeometry(seed: number, anchors: THREE.Vector3[], color: THREE.Color): THREE.BufferGeometry {
  const rng = createRng(seed);
  const b = new MeshBuilder();
  const base = new THREE.IcosahedronGeometry(1, 0);
  const pos = base.getAttribute('position');
  for (const anchor of anchors) {
    const cluster = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < cluster; k += 1) {
      const r = 0.014 + rng() * 0.008;
      const off = new THREE.Vector3((rng() - 0.5) * 0.06, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.06).add(anchor);
      const c = color.clone().multiplyScalar(0.75 + rng() * 0.4);
      const start = b.pos.length / 3;
      for (let i = 0; i < pos.count; i += 1) {
        const n = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        b.vertex(n.clone().multiplyScalar(r).add(off), n, c);
      }
      for (let i = 0; i < pos.count; i += 3) b.tri(start + i, start + i + 1, start + i + 2);
    }
  }
  base.dispose();
  return b.build();
}
