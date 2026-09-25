import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, hashString } from '../core/rng';
import { CAVE_SPHERES, sharedUniforms } from '../render/materials/MaterialPatches';
import { getRockTexture } from '../render/props/rockTexture';
import { applyTriplanar } from '../render/props/stoneTextures';
import type { WorldData } from './WorldData';
import { LANDMARKS, type LandmarkDef } from './WorldLayout';

// Caves you can walk into. Each cave landmark sits on a mound; a tunnel
// opens on its flank, slopes down under the rock and ends in a chamber.
// The tunnel is a swept, noise-displaced tube seen from inside; the chamber
// a flattened, displaced dome with its wall opened where the tunnel enters.
//
// The same run of spheres along the tunnel does three jobs: the terrain
// discards fragments inside them (opening the mouth in the hillside), every
// lit material dims sun and sky light inside them (so caves are dark and a
// torch matters), and the player walks on the cave floor while within them.

export type CaveLook = 'whisper' | 'crystal' | 'lava' | 'ice';

export interface CaveNode {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Walkable floor height. */
  floor: number;
  /** 0 at the mouth (daylight) .. 1 deep inside. */
  depth: number;
}

export interface Cave {
  id: string;
  name: string;
  look: CaveLook;
  nodes: CaveNode[];
  chamber: CaveNode;
  /** Chamber floor disk radius. */
  chamberFloor: number;
  mouth: THREE.Vector3;
  /** Heading into the cave (unit xz). */
  dir: THREE.Vector2;
  /** Bounding circle (xz) for quick rejection. */
  bx: number;
  bz: number;
  br: number;
}

export const CAVE_LOOKS: Record<string, CaveLook> = {
  whispering_cave: 'whisper',
  crystal_grotto: 'crystal',
  lava_tubes: 'lava',
  ice_caves: 'ice',
};

const STEP = 2.4;
const TUNNEL_NODES = 16;

/** A small hashed 3D value noise for wall displacement. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const h = (i: number, j: number, k: number) => {
    let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx);
  const v = s(fy);
  const w = s(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

const fbm = (x: number, y: number, z: number) => noise3(x, y, z) * 0.6 + noise3(x * 2.1 + 7, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3 + 3, z * 4.3) * 0.1;

const plans = new WeakMap<WorldData, Cave[]>();

/** Every cave on the island (planned once per world). */
export function plannedCaves(world: WorldData): Cave[] {
  let list = plans.get(world);
  if (!list) {
    list = LANDMARKS.filter((lm) => CAVE_LOOKS[lm.id]).map((lm) => planCave(world, lm, CAVE_LOOKS[lm.id]));
    plans.set(world, list);
  }
  return list;
}

/** Lay out one cave: a mouth on the mound's flank, a descending tunnel, a chamber. */
export function planCave(world: WorldData, lm: LandmarkDef, look: CaveLook): Cave {
  const rng = createRng(hashString(`cave:${lm.id}`));
  const R = lm.mound?.radius ?? 55;
  // Open onto the lowest, driest side, so the mouth faces out over the land.
  let bestA = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 24; k += 1) {
    const a = (k / 24) * Math.PI * 2;
    const ox = lm.x + Math.cos(a) * R * 1.15;
    const oz = lm.z + Math.sin(a) * R * 1.15;
    const mx = lm.x + Math.cos(a) * R * 0.6;
    const mz = lm.z + Math.sin(a) * R * 0.6;
    const wet = world.waterDepthAt(ox, oz) > 0 || world.waterDepthAt(mx, mz) > -0.5 ? 100 : 0;
    const score = world.heightAt(ox, oz) + wet + world.slopeAt(mx, mz) * 8;
    if (score < bestScore) {
      bestScore = score;
      bestA = a;
    }
  }
  const mouth = new THREE.Vector3(lm.x + Math.cos(bestA) * R * 0.6, 0, lm.z + Math.sin(bestA) * R * 0.6);
  mouth.y = world.heightAt(mouth.x, mouth.z);
  let heading = bestA + Math.PI;
  const nodes: CaveNode[] = [];
  let x = mouth.x;
  let z = mouth.z;
  let floor = mouth.y - 0.2;
  for (let i = 0; i < TUNNEL_NODES; i += 1) {
    const r = 2.5 + 0.35 * Math.sin(i * 0.8) + rng() * 0.3;
    if (i > 0) {
      heading += (rng() - 0.5) * 0.36;
      x += Math.cos(heading) * STEP;
      z += Math.sin(heading) * STEP;
      floor -= i < 6 ? 0.55 : 0.16;
    }
    // Keep solid rock over the tunnel once past the mouth.
    const top = world.heightAt(x, z);
    if (i >= 3 && top < floor + r * 1.75 + 1.6) floor = top - r * 1.75 - 1.6;
    nodes.push({ x, y: floor + r * 0.75, z, r, floor, depth: Math.min(1, i / 5) });
  }
  const last = nodes[nodes.length - 1];
  const Rc = look === 'crystal' ? 11 : look === 'whisper' ? 9 : 10;
  const cx = last.x + Math.cos(heading) * Rc * 0.7;
  const cz = last.z + Math.sin(heading) * Rc * 0.7;
  let cFloor = last.floor - 0.6;
  // Plenty of rock over the dome (the hilltop must stay whole and lit).
  let cTop = Infinity;
  for (let k = 0; k < 9; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    const rr = k === 8 ? 0 : Rc * 0.8;
    cTop = Math.min(cTop, world.heightAt(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr));
  }
  if (cTop < cFloor + Rc * 1.7 + 3) cFloor = cTop - Rc * 1.7 - 3;
  // Ramp the last stretch of tunnel down to the chamber floor.
  const drop = last.floor - 0.6 - cFloor;
  if (drop > 0) {
    const n = Math.min(6, nodes.length - 3);
    for (let k = 1; k <= n; k += 1) {
      const node = nodes[nodes.length - 1 - n + k];
      node.floor -= (drop * k) / n;
      node.y = node.floor + node.r * 0.75;
    }
  }
  const chamber: CaveNode = { x: cx, y: cFloor + Rc * 0.62 * 0.65, z: cz, r: Rc, floor: cFloor, depth: 1 };
  const all = [...nodes, chamber];
  let bx = 0;
  let bz = 0;
  for (const n of all) {
    bx += n.x / all.length;
    bz += n.z / all.length;
  }
  let br = 0;
  for (const n of all) br = Math.max(br, Math.hypot(n.x - bx, n.z - bz) + n.r + 2);
  return {
    id: lm.id,
    name: lm.name,
    look,
    nodes,
    chamber,
    chamberFloor: Rc * Math.sqrt(1 - 0.65 * 0.65) * 0.92,
    mouth,
    dir: new THREE.Vector2(Math.cos(bestA + Math.PI), Math.sin(bestA + Math.PI)),
    bx,
    bz,
    br,
  };
}

// -----------------------------------------------------------------------------
// Meshes

/** The tunnel: rings swept along a smooth path, walls roughened, floor flattened, clipped to the hillside at the mouth. */
function tunnelGeometry(world: WorldData, cave: Cave, seed: number): THREE.BufferGeometry {
  const pts = cave.nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const length = curve.getLength();
  const rings = Math.max(8, Math.round(length / 0.8));
  const M = 22;
  const pos: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const right = new THREE.Vector3();
  const ringUp = new THREE.Vector3();
  const c = new THREE.Vector3();
  const o = (seed % 97) * 1.37;
  for (let i = 0; i <= rings; i += 1) {
    const u = i / rings;
    curve.getPointAt(u, c);
    curve.getTangentAt(u, t);
    right.crossVectors(t, up).normalize();
    ringUp.crossVectors(right, t).normalize();
    // Interpolate radius and floor between the nearest nodes.
    const f = u * (cave.nodes.length - 1);
    const a = cave.nodes[Math.floor(f)];
    const b = cave.nodes[Math.min(cave.nodes.length - 1, Math.floor(f) + 1)];
    const k = f - Math.floor(f);
    const r = a.r + (b.r - a.r) * k;
    const floor = a.floor + (b.floor - a.floor) * k;
    for (let j = 0; j < M; j += 1) {
      const phi = (j / M) * Math.PI * 2;
      const dx = right.x * Math.cos(phi) + ringUp.x * Math.sin(phi);
      const dy = right.y * Math.cos(phi) + ringUp.y * Math.sin(phi);
      const dz = right.z * Math.cos(phi) + ringUp.z * Math.sin(phi);
      const px = c.x + dx * r;
      const py = c.y + dy * r;
      const pz = c.z + dz * r;
      const settle = Math.min(1, (u * length) / 7);
      const rough = 1 + ((fbm(px * 0.32 + o, py * 0.32, pz * 0.32) - 0.5) * 0.5 + (noise3(px * 1.3, py * 1.3 + o, pz * 1.3) - 0.5) * 0.12) * settle;
      const x = c.x + dx * r * rough;
      const z = c.z + dz * r * rough;
      let y = c.y + dy * r * rough * 0.85;
      if (y < floor) y = floor + (noise3(x * 0.8, 0, z * 0.8) - 0.5) * 0.08;
      // At the mouth, nothing stands above the hillside.
      const ground = world.heightAt(x, z);
      if (y > ground - 0.08) y = ground - 0.08;
      pos.push(x, y, z);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < M; j += 1) {
      const a = i * M + j;
      const b = (i + 1) * M + j;
      const c2 = (i + 1) * M + ((j + 1) % M);
      const d = i * M + ((j + 1) % M);
      // Wound to face inward.
      index.push(a, c2, b, a, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The chamber: a flattened, displaced dome with its wall opened toward the tunnel. */
function chamberGeometry(cave: Cave, seed: number): THREE.BufferGeometry {
  const ch = cave.chamber;
  const g = new THREE.IcosahedronGeometry(1, 5);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const o = (seed % 89) * 2.1;
  const floor = ch.floor;
  for (let i = 0; i < p.count; i += 1) {
    const nx = p.getX(i);
    const ny = p.getY(i);
    const nz = p.getZ(i);
    const n = fbm(nx * 2.2 + o, ny * 2.2, nz * 2.2);
    const rr = ch.r * (0.9 + n * 0.28);
    let y = ch.y + ny * ch.r * 0.62 * (0.92 + n * 0.2);
    if (y < floor) y = floor + (noise3(nx * 9, 0, nz * 9) - 0.5) * 0.1;
    p.setXYZ(i, ch.x + nx * rr, y, ch.z + nz * rr);
  }
  // Turn it inside out, and drop the faces where the tunnel comes in.
  const last = cave.nodes[cave.nodes.length - 1];
  const inDir = new THREE.Vector3(ch.x - last.x, 0, ch.z - last.z).normalize();
  const src = g.toNonIndexed();
  const sp = src.getAttribute('position') as THREE.BufferAttribute;
  const out: number[] = [];
  const cen = new THREE.Vector3();
  const rel = new THREE.Vector3();
  for (let f = 0; f < sp.count; f += 3) {
    cen.set(0, 0, 0);
    for (let k = 0; k < 3; k += 1) cen.add(new THREE.Vector3(sp.getX(f + k), sp.getY(f + k), sp.getZ(f + k)));
    cen.multiplyScalar(1 / 3);
    rel.set(cen.x - last.x, cen.y - last.y, cen.z - last.z);
    const along = rel.dot(inDir);
    const off = rel.clone().addScaledVector(inDir, -along).length();
    const facing = (cen.x - ch.x) * -inDir.x + (cen.z - ch.z) * -inDir.z > 0;
    if (facing && off < last.r * 1.15) continue;
    for (const k of [0, 2, 1]) out.push(sp.getX(f + k), sp.getY(f + k), sp.getZ(f + k));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Decor {
  parts: Map<string, THREE.BufferGeometry[]>;
}

function add(d: Decor, m: string, g: THREE.BufferGeometry): void {
  const list = d.parts.get(m) ?? [];
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  list.push(geo);
  d.parts.set(m, list);
}

/** Crystals, icicles, lava, stalactites: what makes each cave itself. */
function decorate(cave: Cave, d: Decor, rng: () => number): void {
  const ch = cave.chamber;
  const floorAt = (x: number, z: number) => {
    const inChamber = Math.hypot(x - ch.x, z - ch.z) < ch.r;
    return inChamber ? ch.floor : caveFloorAt(cave, x, z, Infinity) ?? ch.floor;
  };
  const ring = (count: number, rmin: number, rmax: number, fn: (x: number, z: number, i: number) => void) => {
    for (let i = 0; i < count; i += 1) {
      const a = rng() * Math.PI * 2;
      const r = rmin + rng() * (rmax - rmin);
      fn(ch.x + Math.cos(a) * r, ch.z + Math.sin(a) * r, i);
    }
  };
  const ceilingAt = (x: number, z: number) => {
    const dr = Math.hypot(x - ch.x, z - ch.z) / (ch.r * 0.95);
    return ch.y + ch.r * 0.62 * Math.sqrt(Math.max(0, 1 - dr * dr)) * 0.9;
  };
  switch (cave.look) {
    case 'crystal': {
      // Clusters of glowing prisms on the floor and walls.
      ring(26, 1.5, ch.r * 0.82, (x, z) => {
        const n = 3 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k += 1) {
          const h = 0.6 + rng() * 2.6;
          const w = 0.12 + rng() * 0.22;
          const prism = new THREE.CylinderGeometry(0, w, h * 0.25, 6).translate(0, h * 0.5 + h * 0.125, 0);
          const body = new THREE.CylinderGeometry(w, w, h, 6).translate(0, h / 2, 0);
          const g = mergeGeometries([body.toNonIndexed(), prism.toNonIndexed()]) as THREE.BufferGeometry;
          g.rotateZ((rng() - 0.5) * 0.9);
          g.rotateX((rng() - 0.5) * 0.9);
          g.translate(x + (rng() - 0.5) * 0.8, floorAt(x, z) - 0.1, z + (rng() - 0.5) * 0.8);
          add(d, rng() < 0.3 ? 'crystalB' : 'crystal', g);
        }
      });
      // Along the tunnel too, sparser.
      for (const n of cave.nodes.slice(4)) {
        if (rng() < 0.4) continue;
        const a = rng() * Math.PI * 2;
        const h = 0.4 + rng() * 1.2;
        const g = new THREE.CylinderGeometry(0.08, 0.14, h, 6).translate(0, h / 2, 0);
        g.rotateZ((rng() - 0.5) * 1.2);
        g.translate(n.x + Math.cos(a) * n.r * 0.6, n.floor, n.z + Math.sin(a) * n.r * 0.6);
        add(d, 'crystal', g);
      }
      break;
    }
    case 'ice': {
      // Icicles from the ceiling, columns where they have met the floor.
      ring(70, 0.5, ch.r * 0.9, (x, z, i) => {
        const top = ceilingAt(x, z);
        const h = 0.5 + rng() * 2.2;
        const g = new THREE.ConeGeometry(0.08 + rng() * 0.18, h, 6);
        g.rotateX(Math.PI);
        g.translate(x, top - h / 2, z);
        add(d, 'ice', g);
        if (i % 9 === 0) {
          const f = floorAt(x, z);
          const col = new THREE.CylinderGeometry(0.25, 0.45, top - f, 8).translate(x, f + (top - f) / 2, z);
          add(d, 'ice', col);
        }
      });
      for (const n of cave.nodes.slice(3)) {
        for (let k = 0; k < 4; k += 1) {
          const a = rng() * Math.PI * 2;
          const h = 0.3 + rng() * 0.9;
          const g = new THREE.ConeGeometry(0.06 + rng() * 0.08, h, 5);
          g.rotateX(Math.PI);
          g.translate(n.x + Math.cos(a) * n.r * 0.45, n.floor + n.r * 1.6 - h / 2, n.z + Math.sin(a) * n.r * 0.45);
          add(d, 'ice', g);
        }
      }
      break;
    }
    case 'lava': {
      // A glowing channel down the tunnel floor into a pool in the chamber.
      for (let i = 2; i < cave.nodes.length - 1; i += 1) {
        const a = cave.nodes[i];
        const b = cave.nodes[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const g = new THREE.BoxGeometry(0.7 + rng() * 0.3, 0.06, len + 0.3);
        g.rotateY(Math.atan2(b.x - a.x, b.z - a.z));
        const side = (i % 2 ? 1 : -1) * a.r * 0.45;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        g.translate((a.x + b.x) / 2 + nx * side, (a.floor + b.floor) / 2 + 0.02, (a.z + b.z) / 2 + nz * side);
        add(d, 'lava', g);
      }
      const pool = new THREE.CircleGeometry(ch.r * 0.32, 24);
      pool.rotateX(-Math.PI / 2);
      pool.translate(ch.x + ch.r * 0.25, ch.floor + 0.04, ch.z);
      add(d, 'lava', pool);
      // Basalt columns around the pool.
      ring(20, ch.r * 0.45, ch.r * 0.85, (x, z) => {
        const h = 0.8 + rng() * 3;
        const g = new THREE.CylinderGeometry(0.4, 0.45, h, 6).translate(x, floorAt(x, z) + h / 2 - 0.2, z);
        add(d, 'basalt', g);
      });
      break;
    }
    case 'whisper': {
      // Stalactites and stalagmites; a still pool; roots through the roof.
      ring(40, 0.8, ch.r * 0.88, (x, z, i) => {
        const top = ceilingAt(x, z);
        const h = 0.6 + rng() * 2.4;
        const g = new THREE.ConeGeometry(0.1 + rng() * 0.25, h, 7);
        g.rotateX(Math.PI);
        g.translate(x, top - h / 2, z);
        add(d, 'drip', g);
        if (i % 3 === 0) {
          const s = 0.3 + rng() * 1.6;
          const m = new THREE.ConeGeometry(0.2 + rng() * 0.3, s, 7).translate(x + 0.6, floorAt(x, z) + s / 2 - 0.05, z - 0.4);
          add(d, 'drip', m);
        }
      });
      const pool = new THREE.CircleGeometry(ch.r * 0.3, 24);
      pool.rotateX(-Math.PI / 2);
      pool.translate(ch.x - ch.r * 0.3, ch.floor + 0.05, ch.z + ch.r * 0.15);
      add(d, 'pool', pool);
      for (let i = 0; i < 12; i += 1) {
        const x = ch.x + (rng() - 0.5) * ch.r;
        const z = ch.z + (rng() - 0.5) * ch.r;
        const top = ceilingAt(x, z);
        const len = 1.5 + rng() * 3;
        const root = new THREE.CylinderGeometry(0.02, 0.06, len, 4).translate(x, top - len / 2, z);
        root.rotateZ(0);
        add(d, 'root', root);
      }
      break;
    }
  }
}

/** Floor under (x, z) if it lies inside the cave's tunnel or chamber (and `y` is plausibly in it). */
export function caveFloorAt(cave: Cave, x: number, z: number, y: number): number | null {
  if (Math.hypot(x - cave.bx, z - cave.bz) > cave.br) return null;
  const ch = cave.chamber;
  const dc = Math.hypot(x - ch.x, z - ch.z);
  if (dc < ch.r * 0.95 && (y === Infinity || (y > ch.floor - 2 && y < ch.floor + ch.r * 1.1))) return ch.floor;
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < cave.nodes.length - 1; i += 1) {
    const a = cave.nodes[i];
    const b = cave.nodes[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    const r = a.r + (b.r - a.r) * t;
    const f = a.floor + (b.floor - a.floor) * t;
    if (d < r * 0.95 && d < bestD && (y === Infinity || (y > f - 2 && y < f + r * 1.9))) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export class Caves {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly caves: Cave[] = [];
  /** Each cave's meshes: hidden when far (they are under the hill). */
  private readonly meshes = new Map<Cave, THREE.Mesh[]>();
  /** Shared with every lit material (see MaterialPatches). */
  readonly uniforms = {
    uCaveSpheres: sharedUniforms.uCaveSpheres as THREE.IUniform<THREE.Vector4[]>,
    uCaveWeights: sharedUniforms.uCaveWeights as THREE.IUniform<number[]>,
    uCaveCount: sharedUniforms.uCaveCount as THREE.IUniform<number>,
  };
  private active: Cave | null = null;
  private readonly glow: THREE.MeshStandardMaterial[] = [];
  private time = 0;

  constructor(private readonly world: WorldData) {
    this.group.name = 'caves';
    const rock = getRockTexture();
    const mat = (color: number, roughness = 0.92, emissive = 0, ei = 1, metal = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: ei, metalness: metal });
      this.materials.push(m);
      return m;
    };
    const walls: Record<CaveLook, THREE.MeshStandardMaterial> = {
      whisper: mat(0xa89886),
      crystal: mat(0x8c8fa6),
      lava: mat(0x4a4440, 0.85),
      ice: mat(0xb8d8ec, 0.35),
    };
    for (const m of Object.values(walls)) applyTriplanar(m, rock, 3.2, 1.3);
    const decorMats: Record<string, THREE.MeshStandardMaterial> = {
      crystal: mat(0x2a40a8, 0.12, 0x3a5cff, 0.14),
      crystalB: mat(0x6a38b0, 0.12, 0x8a48ff, 0.12),
      ice: mat(0xd8f0ff, 0.06, 0x3a7aa8, 0.05),
      lava: mat(0x2a0800, 0.6, 0xff4a0a, 0.45),
      basalt: mat(0x2c2826, 0.8),
      drip: mat(0xb0a088, 0.6),
      pool: mat(0x0a1418, 0.04, 0, 1, 0.3),
      root: mat(0x3a2a1c, 0.9),
    };
    applyTriplanar(decorMats.basalt, rock, 1.6, 1.2);
    applyTriplanar(decorMats.drip, rock, 1.2, 0.8);
    this.glow.push(decorMats.crystal, decorMats.crystalB, decorMats.lava);
    for (const cave of plannedCaves(world)) {
      const look = cave.look;
      this.caves.push(cave);
      const seed = hashString(cave.id);
      const own: THREE.Mesh[] = [];
      this.meshes.set(cave, own);
      const shell = mergeGeometries([tunnelGeometry(world, cave, seed).toNonIndexed(), chamberGeometry(cave, seed)], false);
      if (shell) {
        const mesh = new THREE.Mesh(shell, walls[look]);
        mesh.name = `cave:${cave.id}`;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        own.push(mesh);
      }
      const decor: Decor = { parts: new Map() };
      decorate(cave, decor, createRng(seed ^ 0x5eed));
      for (const [m, list] of decor.parts) {
        const g = mergeGeometries(list, false);
        if (!g) continue;
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, decorMats[m]);
        mesh.name = `cave:${cave.id}:${m}`;
        mesh.castShadow = m !== 'lava' && m !== 'pool';
        mesh.receiveShadow = true;
        this.group.add(mesh);
        own.push(mesh);
      }
    }
  }

  byId(id: string): Cave | undefined {
    return this.caves.find((c) => c.id === id);
  }

  /** Inside the open volume near the mouth, where the hillside is cut away. */
  opened(x: number, y: number, z: number): boolean {
    const u = this.uniforms;
    for (let i = 0; i < u.uCaveCount.value; i += 1) {
      const s = u.uCaveSpheres.value[i];
      if (Math.hypot(x - s.x, (y - s.y) / 0.75, z - s.z) < s.w * 1.02 && y > s.y - s.w * 0.8) return true;
    }
    return false;
  }

  /** Walkable floor if (x, z, y) is inside a cave, else null. */
  floorAt(x: number, z: number, y: number): number | null {
    for (const c of this.caves) {
      const f = caveFloorAt(c, x, z, y);
      if (f !== null) return f;
    }
    return null;
  }

  /** How far inside a cave a point is: 0 outside or at the mouth .. 1 deep. */
  inside(x: number, y: number, z: number): number {
    let best = 0;
    for (const c of this.caves) {
      if (Math.hypot(x - c.bx, z - c.bz) > c.br) continue;
      for (const n of [...c.nodes, c.chamber]) {
        const d = Math.hypot(x - n.x, (y - n.y) / 0.75, z - n.z);
        if (d < n.r * 1.35) best = Math.max(best, n.depth);
      }
    }
    return best;
  }

  /**
   * Keep someone underground inside the cave: walls are rock. Called after
   * movement with the position and velocity; only acts beneath the hill.
   */
  confine(p: THREE.Vector3, v: THREE.Vector3, radius: number): void {
    for (const c of this.caves) {
      if (Math.hypot(p.x - c.bx, p.z - c.bz) > c.br + 4) continue;
      // Only where there is rock overhead.
      if (this.world.heightAt(p.x, p.z) < p.y + 2.2) continue;
      if (caveFloorAt(c, p.x, p.z, p.y) !== null) {
        this.clampToShapes(c, p, v, radius);
        continue;
      }
      // Slipped outside every shape: back to the nearest.
      this.clampToShapes(c, p, v, radius);
    }
  }

  private clampToShapes(c: Cave, p: THREE.Vector3, v: THREE.Vector3, radius: number): void {
    let best = { excess: Infinity, px: 0, pz: 0, lim: 0 };
    const ch = c.chamber;
    const consider = (px: number, pz: number, lim: number) => {
      const d = Math.hypot(p.x - px, p.z - pz);
      const excess = d - lim;
      if (excess < best.excess) best = { excess, px, pz, lim };
    };
    consider(ch.x, ch.z, c.chamberFloor - radius);
    for (let i = 0; i < c.nodes.length - 1; i += 1) {
      const a = c.nodes[i];
      const b = c.nodes[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2));
      consider(a.x + abx * t, a.z + abz * t, (a.r + (b.r - a.r) * t) * 0.72 - radius);
    }
    if (best.excess <= 0) return;
    const dx = p.x - best.px;
    const dz = p.z - best.pz;
    const d = Math.hypot(dx, dz) || 1;
    p.x -= (dx / d) * best.excess;
    p.z -= (dz / d) * best.excess;
    const out = (v.x * dx + v.z * dz) / d;
    if (out > 0) {
      v.x -= (dx / d) * out;
      v.z -= (dz / d) * out;
    }
  }

  /** Load the nearest cave's spheres for the shaders, and pulse the glow. */
  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    let near: Cave | null = null;
    let nd = Infinity;
    for (const c of this.caves) {
      const d = Math.hypot(camera.x - c.bx, camera.z - c.bz) - c.br;
      if (d < nd) {
        nd = d;
        near = c;
      }
    }
    // From further than this a cave is a dark mouth in a hillside: its
    // tunnel and chamber cannot be seen, only drawn.
    for (const [c, list] of this.meshes) {
      const show = Math.hypot(camera.x - c.bx, camera.z - c.bz) - c.br < 150;
      for (const m of list) m.visible = show;
    }
    const want = near && nd < 220 ? near : null;
    if (want !== this.active) {
      this.active = want;
      const u = this.uniforms;
      let n = 0;
      if (want) {
        for (const node of [...want.nodes, want.chamber]) {
          if (n >= CAVE_SPHERES) break;
          u.uCaveSpheres.value[n].set(node.x, node.y, node.z, node.r);
          u.uCaveWeights.value[n] = node.depth;
          n += 1;
        }
      }
      u.uCaveCount.value = n;
    }
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 0.9);
    for (const m of this.glow) m.emissiveIntensity = (m.userData.base ??= m.emissiveIntensity) * pulse;
  }

  /** Where each chamber's cache sits: against the far wall, on the floor. */
  cacheSpots(): { id: string; name: string; x: number; y: number; z: number }[] {
    return this.caves.map((c) => {
      const last = c.nodes[c.nodes.length - 1];
      const dx = c.chamber.x - last.x;
      const dz = c.chamber.z - last.z;
      const d = Math.hypot(dx, dz) || 1;
      const x = c.chamber.x + (dx / d) * c.chamberFloor * 0.7;
      const z = c.chamber.z + (dz / d) * c.chamberFloor * 0.7;
      return { id: c.id, name: c.name, x, y: c.chamber.floor, z };
    });
  }

  debugCaves(): { id: string; mouth: number[]; dir: number[]; chamber: number[]; floor: number; nodes: number }[] {
    return this.caves.map((c) => ({
      id: c.id,
      mouth: [c.mouth.x, c.mouth.y, c.mouth.z],
      dir: [c.dir.x, c.dir.y],
      chamber: [c.chamber.x, c.chamber.y, c.chamber.z],
      floor: c.chamber.floor,
      nodes: c.nodes.length,
    }));
  }
}
