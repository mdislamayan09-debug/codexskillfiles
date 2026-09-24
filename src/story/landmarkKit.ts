import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';

// Shapes for the island's set pieces, in local metres (y up). Everything
// here is plain geometry: the landmark builder places it in the world and
// merges it per material. Stone is textured in world space, so these carry
// UVs only where a texture must follow the surface (roof shingles, hull
// planks).

/** Keep position, normal and uv so parts merge cleanly. */
export function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(clean), false) ?? new THREE.BufferGeometry();
}

/**
 * A round arch of dressed voussoirs: `span` wide at the springing line
 * (y = 0), a ring `ring` deep, `depth` through (along z). The keystone
 * stands a little proud.
 */
export function voussoirArch(span: number, ring: number, depth: number, count = 13): THREE.BufferGeometry {
  const r0 = span / 2;
  const parts: THREE.BufferGeometry[] = [];
  const gap = 0.012 / r0;
  for (let i = 0; i < count; i += 1) {
    const a0 = (Math.PI * i) / count + gap;
    const a1 = (Math.PI * (i + 1)) / count - gap;
    const key = i === Math.floor(count / 2);
    const r1 = r0 + ring * (key ? 1.18 : 1);
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    shape.lineTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
    shape.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
    shape.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
    shape.closePath();
    const d = depth * (key ? 1.06 : 1);
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -d / 2);
    parts.push(g);
  }
  return merge(parts);
}

export interface Opening {
  /** Centre of the opening along the wall, and its sill height. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Round-headed (the top is a half circle). */
  arched?: boolean;
}

/** A wall `width` × `height`, `thickness` deep, with openings cut through. Base at y = 0, centred on x, faces ±z. */
export function wallWithOpenings(width: number, height: number, thickness: number, openings: Opening[]): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  for (const o of openings) {
    const hole = new THREE.Path();
    const x0 = o.x - o.w / 2;
    const x1 = o.x + o.w / 2;
    if (o.arched) {
      const spring = o.y + o.h - o.w / 2;
      hole.moveTo(x0, o.y);
      hole.lineTo(x0, spring);
      hole.absarc(o.x, spring, o.w / 2, Math.PI, 0, true);
      hole.lineTo(x1, o.y);
      hole.closePath();
    } else {
      hole.moveTo(x0, o.y);
      hole.lineTo(x0, o.y + o.h);
      hole.lineTo(x1, o.y + o.h);
      hole.lineTo(x1, o.y);
      hole.closePath();
    }
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -thickness / 2);
  return g;
}

/**
 * A pitched roof over a `width` (x) × `depth` (z) footprint: two sloped
 * slabs meeting at a ridge along x, `rise` high, overhanging by `eave`.
 * UVs are in metres / `tile` so a shingle texture tiles at true size.
 */
export function gableRoof(width: number, depth: number, rise: number, eave = 0.4, thick = 0.14, tile = 1.2): THREE.BufferGeometry {
  const half = depth / 2 + eave;
  const slope = Math.hypot(half, rise + eave * (rise / (depth / 2)));
  const angle = Math.atan2(rise, depth / 2);
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(width + eave * 2, thick, slope);
    // Shingles run across the slope: u along the ridge, v down the slope.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
    g.rotateX(side * angle);
    g.translate(0, rise / 2 - (eave * Math.tan(angle)) / 2, (side * (slope * Math.cos(angle))) / 2);
    parts.push(g);
  }
  return merge(parts);
}

/** The gable-end triangles closing a pitched roof (for masonry or boards). */
export function gableEnds(width: number, depth: number, rise: number, thickness: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-depth / 2, 0);
    shape.lineTo(depth / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    g.translate(0, 0, -thickness / 2);
    g.rotateY(Math.PI / 2);
    g.translate((side * width) / 2, 0, 0);
    parts.push(g);
  }
  return merge(parts);
}

/** A flight of `steps` stone steps rising along +z. */
export function stairs(width: number, steps: number, rise: number, run: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i += 1) {
    const g = new THREE.BoxGeometry(width, rise * (i + 1), run);
    g.translate(0, (rise * (i + 1)) / 2, run * i + run / 2);
    parts.push(g);
  }
  return merge(parts);
}

/** A crenellated parapet ring (merlons) on a round tower. */
export function merlonRing(radius: number, count: number, h: number, w: number, t: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const g = new THREE.BoxGeometry(w, h, t);
    g.rotateY(-a);
    g.translate(Math.cos(a) * radius, h / 2, Math.sin(a) * radius);
    parts.push(g);
  }
  return merge(parts);
}

/**
 * A ship's hull lofted from U-shaped sections: `length` along x (bow at +x),
 * `beam` wide, `depth` from keel to gunwale. UVs run planks along the
 * length. `breach` cuts a hole in the starboard side between two stations
 * (0..1 along the length), for a wreck.
 */
export function hull(length: number, beam: number, depth: number, breach: [number, number] | null = null, tile = 1.6): { shell: THREE.BufferGeometry; ribs: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const nx = 28;
  const nr = 10;
  const section = (s: number) => {
    // s runs stern (0) to bow (1): a broad transom, full amidships, a fine bow.
    const aft = Math.min(1, 0.72 + (s / 0.3) * 0.28);
    const fore = s > 0.6 ? Math.pow(Math.cos(((s - 0.6) / 0.4) * Math.PI * 0.5), 0.75) : 1;
    const w = (beam / 2) * aft * fore;
    // The sheer: the gunwale rises toward bow and stern.
    const d = depth * (1 + 0.22 * Math.pow(Math.abs(s - 0.45) * 2, 2));
    return { w: Math.max(0.04, w), d };
  };
  const pos: number[] = [];
  const uv: number[] = [];
  const point = (i: number, j: number, side: number): [number, number, number, number] => {
    const s = i / nx;
    const { w, d } = section(s);
    const th = (j / nr) * Math.PI * 0.5;
    const x = (s - 0.5) * length;
    // Keel to gunwale: a rounded bilge.
    const y = -d * Math.pow(Math.cos(th), 1.4) + d;
    const z = side * w * Math.pow(Math.sin(th), 0.8);
    // Girth for the plank UV.
    const girth = (j / nr) * (d + w) * 0.9;
    return [x, y, z, girth];
  };
  const breached = (i: number, j: number) => breach !== null && i / nx >= breach[0] && i / nx < breach[1] && j >= 3 && j <= 7;
  for (const side of [-1, 1]) {
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nr; j += 1) {
        if (side > 0 && breached(i, j)) continue;
        const a = point(i, j, side);
        const b = point(i + 1, j, side);
        const c = point(i + 1, j + 1, side);
        const d = point(i, j + 1, side);
        const quad = side > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
        for (const q of quad) {
          pos.push(q[0], q[1], q[2]);
          uv.push(q[3] / tile, q[0] / tile);
        }
      }
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shell.computeVertexNormals();
  // Ribs: frames following the section every few stations.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 2; i < nx; i += 3) {
    const pts: THREE.Vector3[] = [];
    for (let j = nr; j >= 0; j -= 1) {
      const p = point(i, j, -1);
      pts.push(new THREE.Vector3(p[0], p[1], p[2] * 0.96));
    }
    for (let j = 1; j <= nr; j += 1) {
      const p = point(i, j, 1);
      pts.push(new THREE.Vector3(p[0], p[1], p[2] * 0.96));
    }
    ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.09, 5, false));
  }
  // A deck broken off partway.
  const deckLen = length * 0.55;
  const deck = new THREE.BoxGeometry(deckLen, 0.12, beam * 0.86);
  deck.translate(-length * 0.12, depth * 0.92, 0);
  return { shell, ribs: merge(ribs), deck };
}

/**
 * A colossal face gazing up, carved from one stone: a displaced dome with
 * brow, sockets, nose, lips and chin. Local +y is up (the face looks
 * skyward), +z toward the chin.
 */
export function colossalFace(size: number, seed = 7): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rng = createRng(seed);
  const bump = (u: number, v: number, cu: number, cv: number, ru: number, rv: number) => Math.exp(-((u - cu) ** 2) / (ru * ru) - ((v - cv) ** 2) / (rv * rv));
  const n = new THREE.Vector3();
  const jitter = Array.from({ length: 8 }, () => rng() * Math.PI * 2);
  for (let i = 0; i < pos.count; i += 1) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    // Face coordinates on the upward hemisphere: u across, v from brow to chin.
    const u = n.x;
    const v = n.z;
    const front = Math.max(0, n.y);
    let r = 1;
    // Head shape: longer than wide.
    r += 0.06 * front;
    // Brow ridge and forehead.
    r += 0.07 * bump(u, v, 0, -0.3, 0.55, 0.08) * front;
    // Eye sockets.
    r -= 0.11 * (bump(u, v, -0.28, -0.16, 0.13, 0.08) + bump(u, v, 0.28, -0.16, 0.13, 0.08)) * front;
    // Cheekbones.
    r += 0.05 * (bump(u, v, -0.36, 0.02, 0.12, 0.1) + bump(u, v, 0.36, 0.02, 0.12, 0.1)) * front;
    // Nose: a ridge down the middle, fuller at the tip.
    r += (0.08 * bump(u, v, 0, -0.08, 0.06, 0.14) + 0.12 * bump(u, v, 0, 0.1, 0.09, 0.06)) * front;
    // Lips, parted.
    r += 0.06 * (bump(u, v, 0, 0.28, 0.2, 0.035) + bump(u, v, 0, 0.36, 0.17, 0.035)) * front;
    r -= 0.04 * bump(u, v, 0, 0.32, 0.18, 0.012) * front;
    // Chin.
    r += 0.05 * bump(u, v, 0, 0.5, 0.14, 0.07) * front;
    // Weathering.
    r += 0.012 * Math.sin(n.x * 23 + jitter[0]) * Math.sin(n.z * 19 + jitter[1]) + 0.008 * Math.sin(n.y * 41 + jitter[2]);
    pos.setXYZ(i, n.x * r * size * 0.82, n.y * r * size * 0.62, n.z * r * size);
  }
  g.computeVertexNormals();
  return g;
}
