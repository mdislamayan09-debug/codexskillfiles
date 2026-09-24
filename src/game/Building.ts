import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import { addPatch, replaceOnce } from '../render/materials/MaterialPatches';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { createWoodTextures } from '../render/props/woodTextures';
import type { WorldData } from '../world/WorldData';

// Timber building on a snapping grid. A first foundation starts a grid (its
// own origin and heading); every later piece snaps to it: foundations and
// floors fill 3 m cells, walls and doorways sit on cell edges, roofs and
// stairs point one of four ways. Floors and stairs are walkable surfaces,
// walls are solid, and anything under a roof or floor is sheltered from
// rain and wind. Pieces render as one instanced draw per part.

export type PieceType = 'wood_foundation' | 'wood_wall' | 'wood_doorway' | 'wood_floor' | 'wood_roof' | 'wood_stairs';
export const PIECE_TYPES: readonly PieceType[] = ['wood_foundation', 'wood_wall', 'wood_doorway', 'wood_floor', 'wood_roof', 'wood_stairs'];

export function isPieceType(type: string | undefined): type is PieceType {
  return Boolean(type) && (PIECE_TYPES as readonly string[]).includes(type as string);
}

const CELL = 3;
const HALF = CELL / 2;
const STOREY = 3;
const MAX_LEVEL = 5;
const REACH = 8;
/** Foundations reach this far down to the ground at most. */
const MAX_DEPTH = 5;

const NAMES: Record<PieceType, string> = {
  wood_foundation: 'Wood Foundation',
  wood_wall: 'Wood Wall',
  wood_doorway: 'Wood Doorway',
  wood_floor: 'Wood Floor',
  wood_roof: 'Wood Roof',
  wood_stairs: 'Wood Stairs',
};

/** Wood handed back when a piece is dismantled (about half). */
const REFUND: Record<PieceType, number> = {
  wood_foundation: 4,
  wood_wall: 3,
  wood_doorway: 3,
  wood_floor: 3,
  wood_roof: 3,
  wood_stairs: 4,
};

interface Grid {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  cos: number;
  sin: number;
  /** Farthest piece centre from the origin (for quick rejection). */
  radius: number;
}

interface Circle {
  x: number;
  z: number;
  radius: number;
  height: number;
  baseY: number;
}

export interface Piece {
  id: number;
  grid: number;
  type: PieceType;
  i: number;
  j: number;
  level: number;
  /** Walls: 0 = north edge, 3 = west edge. Roofs/stairs: rising direction 0..3. */
  dir: number;
  /** Foundations: how far the posts reach down. */
  depth: number;
  colliders: Circle[];
}

interface Target {
  grid: Grid | null;
  /** A new grid when none is near. */
  fresh: { x: number; y: number; z: number; yaw: number } | null;
  i: number;
  j: number;
  level: number;
  dir: number;
  depth: number;
  valid: boolean;
  reason: string;
}

interface PartDef {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Scaled vertically by the foundation depth. */
  depthScaled?: boolean;
}

/** A box with world-scaled UVs, so the plank texture tiles at a constant size. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, tile = 2, grain: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    // Planks run along V; `grain` picks which world axis that is.
    let u: number;
    let v: number;
    if (ay > 0.5) {
      u = grain === 'x' ? pz : px;
      v = grain === 'x' ? px : pz;
    } else if (ax > 0.5) {
      u = grain === 'y' ? pz : py;
      v = grain === 'y' ? py : pz;
    } else {
      u = grain === 'y' ? px : py;
      v = grain === 'y' ? py : px;
    }
    uv.setXY(i, u / tile, v / tile);
  }
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (all parts are non-indexed boxes after toNonIndexed).
  const list = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let count = 0;
  for (const p of list) count += p.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = list[0].getAttribute(name).itemSize;
    const array = new Float32Array(count * size);
    let offset = 0;
    for (const p of list) {
      const a = p.getAttribute(name).array as Float32Array;
      array.set(a, offset);
      offset += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  out.computeBoundingSphere();
  return out;
}

export class Building {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly grids: Grid[] = [];
  private readonly pieces: Piece[] = [];
  private readonly byCell = new Map<string, Piece[]>();
  private readonly parts = new Map<PieceType, PartDef[]>();
  private readonly instanced = new Map<string, THREE.InstancedMesh>();
  private readonly ghost = new THREE.Group();
  private readonly ghostMaterial: THREE.MeshStandardMaterial;
  private ghostType: PieceType | null = null;
  private ghostTarget: Target | null = null;
  private ghostRotation = 0;
  private nextGrid = 1;
  private nextPiece = 1;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  ghostValid = false;
  ghostReason = '';

  constructor(
    private readonly world: WorldData,
    private readonly events: EventBus,
  ) {
    const tex = createWoodTextures(512);
    const plank = new THREE.MeshStandardMaterial({ map: tex.planks.map, normalMap: tex.planks.normalMap, roughness: 0.84, metalness: 0 });
    plank.normalScale.set(0.9, 0.9);
    const beam = new THREE.MeshStandardMaterial({ map: tex.planks.map, normalMap: tex.planks.normalMap, color: 0x8a7663, roughness: 0.88, metalness: 0 });
    const roof = new THREE.MeshStandardMaterial({ map: tex.shingles.map, normalMap: tex.shingles.normalMap, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.materials.push(plank, beam, roof);
    this.definePieces(plank, beam, roof);
    this.ghostMaterial = new THREE.MeshStandardMaterial({ color: 0x9fe8c8, transparent: true, opacity: 0.42, roughness: 0.6, depthWrite: false });
    addPatch(this.ghostMaterial, {
      key: 'build-ghost',
      apply(shader) {
        shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb += diffuse * 0.35;', 'build-ghost-glow');
      },
    });
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  // ---------------------------------------------------------------------------
  // Geometry

  private definePieces(plank: THREE.Material, beam: THREE.Material, roof: THREE.Material): void {
    // Foundation: a plank deck on a timber frame, posts reaching to the ground.
    const deck = merge([box(CELL, 0.18, CELL, 0, -0.09, 0, 2, 'z')]);
    const frame = merge([
      box(CELL, 0.26, 0.22, 0, -0.31, -HALF + 0.11, 2, 'x'),
      box(CELL, 0.26, 0.22, 0, -0.31, HALF - 0.11, 2, 'x'),
      box(0.22, 0.26, CELL - 0.44, -HALF + 0.11, -0.31, 0, 2, 'z'),
      box(0.22, 0.26, CELL - 0.44, HALF - 0.11, -0.31, 0, 2, 'z'),
    ]);
    // Posts are unit length downward and scaled by the depth per instance.
    const posts = merge(
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, 0],
      ].map(([sx, sz]) => box(0.26, 1, 0.26, sx * (HALF - 0.16), -0.5, sz * (HALF - 0.16), 2, 'y')),
    );
    this.parts.set('wood_foundation', [
      { geometry: deck, material: plank },
      { geometry: frame, material: beam },
      { geometry: posts, material: beam, depthScaled: true },
    ]);
    // Wall: horizontal planks between two posts, a sill and a top beam.
    const wallBoards = merge([box(CELL - 0.24, STOREY - 0.3, 0.12, 0, STOREY / 2 - 0.02, 0, 2, 'x')]);
    const wallFrame = merge([
      box(0.2, STOREY, 0.2, -HALF + 0.1, STOREY / 2, 0),
      box(0.2, STOREY, 0.2, HALF - 0.1, STOREY / 2, 0),
      box(CELL, 0.18, 0.2, 0, STOREY - 0.09, 0, 2, 'x'),
      box(CELL, 0.14, 0.18, 0, 0.07, 0, 2, 'x'),
    ]);
    this.parts.set('wood_wall', [
      { geometry: wallBoards, material: plank },
      { geometry: wallFrame, material: beam },
    ]);
    // Doorway: boards either side and above a 1.2 m × 2.3 m opening.
    const doorBoards = merge([
      box(0.8, STOREY - 0.3, 0.12, -1.0, STOREY / 2 - 0.02, 0, 2, 'x'),
      box(0.8, STOREY - 0.3, 0.12, 1.0, STOREY / 2 - 0.02, 0, 2, 'x'),
      box(1.24, 0.55, 0.12, 0, 2.6, 0, 2, 'x'),
    ]);
    const doorFrame = merge([
      box(0.2, STOREY, 0.2, -HALF + 0.1, STOREY / 2, 0),
      box(0.2, STOREY, 0.2, HALF - 0.1, STOREY / 2, 0),
      box(CELL, 0.18, 0.2, 0, STOREY - 0.09, 0, 2, 'x'),
      box(0.16, 2.35, 0.2, -0.68, 1.18, 0),
      box(0.16, 2.35, 0.2, 0.68, 1.18, 0),
      box(1.52, 0.16, 0.22, 0, 2.35, 0, 2, 'x'),
    ]);
    this.parts.set('wood_doorway', [
      { geometry: doorBoards, material: plank },
      { geometry: doorFrame, material: beam },
    ]);
    // Floor: a plank deck on joists, top flush with the level.
    const floorDeck = merge([box(CELL, 0.14, CELL, 0, -0.07, 0, 2, 'z')]);
    const joists = merge([-1, 0, 1].map((k) => box(0.16, 0.2, CELL - 0.1, k * 1.1, -0.24, 0, 2, 'z')));
    this.parts.set('wood_floor', [
      { geometry: floorDeck, material: plank },
      { geometry: joists, material: beam },
    ]);
    // Roof: a shingled slope rising 1.5 m toward -Z, with overhang and rafters.
    const rise = 1.5;
    const slopeLen = Math.hypot(CELL + 0.6, rise);
    const angle = Math.atan2(rise, CELL + 0.6);
    const shingle = box(CELL + 0.3, 0.1, slopeLen, 0, 0, 0, 2, 'z');
    shingle.rotateX(angle);
    shingle.translate(0, rise / 2 + 0.08, 0);
    const rafters = merge(
      [-1.35, 0, 1.35].map((x) => {
        const r = box(0.14, 0.18, slopeLen, x, 0, 0, 2, 'z');
        r.rotateX(angle);
        r.translate(0, rise / 2 - 0.07, 0);
        return r;
      }),
    );
    this.parts.set('wood_roof', [
      { geometry: merge([shingle]), material: roof },
      { geometry: rafters, material: beam },
    ]);
    // Stairs: twelve treads climbing one storey toward -Z, on two stringers.
    const treads: THREE.BufferGeometry[] = [];
    const steps = 12;
    for (let k = 0; k < steps; k += 1) {
      const t = (k + 0.5) / steps;
      treads.push(box(CELL - 0.5, 0.08, CELL / steps + 0.04, 0, (k + 1) * (STOREY / steps) - 0.04, HALF - t * CELL, 2, 'x'));
    }
    const stringerLen = Math.hypot(CELL, STOREY);
    const stringers = [-1, 1].map((sx) => {
      const s = box(0.14, 0.3, stringerLen, sx * (HALF - 0.2), 0, 0, 2, 'z');
      s.rotateX(Math.atan2(STOREY, CELL));
      s.translate(0, STOREY / 2 - 0.1, 0);
      return s;
    });
    this.parts.set('wood_stairs', [
      { geometry: merge(treads), material: plank },
      { geometry: merge(stringers), material: beam },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Grid maths

  private toLocal(g: Grid, x: number, z: number): { u: number; v: number } {
    const dx = x - g.x;
    const dz = z - g.z;
    return { u: dx * g.cos - dz * g.sin, v: dx * g.sin + dz * g.cos };
  }

  private toWorld(g: Grid, u: number, v: number): { x: number; z: number } {
    return { x: g.x + u * g.cos + v * g.sin, z: g.z - u * g.sin + v * g.cos };
  }

  private key(grid: number, i: number, j: number): string {
    return `${grid}:${i}:${j}`;
  }

  private at(grid: number, i: number, j: number, level: number, types: PieceType[], dir = -1): Piece | undefined {
    return this.byCell.get(this.key(grid, i, j))?.find((p) => p.level === level && types.includes(p.type) && (dir < 0 || p.dir === dir));
  }

  /** Edge id: walls live on a cell's north (0) or west (3) edge. */
  private canonicalEdge(i: number, j: number, dir: number): { i: number; j: number; dir: number } {
    if (dir === 2) return { i, j: j + 1, dir: 0 };
    if (dir === 1) return { i: i + 1, j, dir: 3 };
    return { i, j, dir };
  }

  private wallAt(grid: number, i: number, j: number, level: number, dir: number): Piece | undefined {
    const e = this.canonicalEdge(i, j, dir);
    return this.at(grid, e.i, e.j, level, ['wood_wall', 'wood_doorway'], e.dir);
  }

  private hasDeck(grid: number, i: number, j: number, level: number): boolean {
    return Boolean(this.at(grid, i, j, level, level === 0 ? ['wood_foundation', 'wood_floor'] : ['wood_floor']));
  }

  /** Transform of a piece (position, yaw) in the world. */
  private transform(g: Grid, p: { type: PieceType; i: number; j: number; level: number; dir: number }): { x: number; y: number; z: number; yaw: number } {
    let u = p.i * CELL;
    let v = p.j * CELL;
    let yaw = g.yaw;
    if (p.type === 'wood_wall' || p.type === 'wood_doorway') {
      if (p.dir === 0) v -= HALF;
      else {
        u -= HALF;
        yaw += Math.PI / 2;
      }
    } else if (p.type === 'wood_roof' || p.type === 'wood_stairs') yaw -= (p.dir * Math.PI) / 2;
    const w = this.toWorld(g, u, v);
    return { x: w.x, y: g.y + p.level * STOREY, z: w.z, yaw };
  }

  // ---------------------------------------------------------------------------
  // Queries used by the player and the world

  /** Highest walkable building surface at (x, z) no higher than y + step. */
  surfaceAt(x: number, z: number, y: number, step = 0.6): number {
    let best = -Infinity;
    for (const g of this.grids) {
      if ((x - g.x) ** 2 + (z - g.z) ** 2 > (g.radius + CELL) ** 2) continue;
      const { u, v } = this.toLocal(g, x, z);
      const i = Math.round(u / CELL);
      const j = Math.round(v / CELL);
      const list = this.byCell.get(this.key(g.id, i, j));
      if (!list) continue;
      const du = u - i * CELL;
      const dv = v - j * CELL;
      for (const p of list) {
        const base = g.y + p.level * STOREY;
        let top = -Infinity;
        if (p.type === 'wood_foundation' || p.type === 'wood_floor') top = base;
        else if (p.type === 'wood_stairs') top = base + this.rampT(p.dir, du, dv) * STOREY;
        else if (p.type === 'wood_roof') top = base + 0.2 + this.rampT(p.dir, du, dv) * 1.5;
        if (top <= y + step && top > best) best = top;
      }
    }
    return best;
  }

  /** 0 at a ramp's low edge, 1 at its high edge (rising toward `dir`). */
  private rampT(dir: number, du: number, dv: number): number {
    const t = dir === 0 ? (HALF - dv) / CELL : dir === 1 ? (du + HALF) / CELL : dir === 2 ? (dv + HALF) / CELL : (HALF - du) / CELL;
    return Math.min(1, Math.max(0, t));
  }

  /** Is (x, y, z) under a roof or floor (rain, wind and cold kept off)? */
  sheltered(x: number, y: number, z: number): boolean {
    for (const g of this.grids) {
      if ((x - g.x) ** 2 + (z - g.z) ** 2 > (g.radius + CELL) ** 2) continue;
      const { u, v } = this.toLocal(g, x, z);
      const list = this.byCell.get(this.key(g.id, Math.round(u / CELL), Math.round(v / CELL)));
      if (!list) continue;
      for (const p of list) {
        if (p.type !== 'wood_roof' && p.type !== 'wood_floor') continue;
        const h = g.y + p.level * STOREY;
        if (h > y + 1.2 && h < y + 9) return true;
      }
    }
    return false;
  }

  /** Solid parts near a point: walls, doorway sides and foundation blocks. */
  collidersNear(x: number, z: number, r: number, out: { x: number; z: number; radius: number; height: number; baseY?: number }[]): void {
    for (const g of this.grids) {
      if ((x - g.x) ** 2 + (z - g.z) ** 2 > (g.radius + CELL + r) ** 2) continue;
      for (const p of this.pieces) {
        if (p.grid !== g.id) continue;
        for (const c of p.colliders) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (r + c.radius) ** 2) out.push(c);
      }
    }
  }

  /** Nearest piece along a ray: distance, the piece, hit point and face normal (world). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number): { t: number; piece: Piece; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    let best: { t: number; piece: Piece; point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
    for (const p of this.pieces) {
      const g = this.grids.find((gg) => gg.id === p.grid) as Grid;
      const tr = this.transform(g, p);
      // Ray into the piece's frame.
      const c = Math.cos(-tr.yaw);
      const s = Math.sin(-tr.yaw);
      const ox = origin.x - tr.x;
      const oz = origin.z - tr.z;
      const lo = new THREE.Vector3(ox * c + oz * s, origin.y - tr.y, -ox * s + oz * c);
      const ld = new THREE.Vector3(dir.x * c + dir.z * s, dir.y, -dir.x * s + dir.z * c);
      const [min, maxB] = this.bounds(p);
      let t0 = 0;
      let t1 = max;
      let axis = -1;
      let sign = 1;
      const o = [lo.x, lo.y, lo.z];
      const d = [ld.x, ld.y, ld.z];
      let hit = true;
      for (let a = 0; a < 3; a += 1) {
        if (Math.abs(d[a]) < 1e-8) {
          if (o[a] < min[a] || o[a] > maxB[a]) {
            hit = false;
            break;
          }
          continue;
        }
        let ta = (min[a] - o[a]) / d[a];
        let tb = (maxB[a] - o[a]) / d[a];
        let sa = -1;
        if (ta > tb) {
          [ta, tb] = [tb, ta];
          sa = 1;
        }
        if (ta > t0) {
          t0 = ta;
          axis = a;
          sign = sa;
        }
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (!hit || axis < 0 || (best && t0 >= best.t)) continue;
      const nl = [0, 0, 0];
      nl[axis] = sign;
      // Back to world.
      const cw = Math.cos(tr.yaw);
      const sw = Math.sin(tr.yaw);
      const normal = new THREE.Vector3(nl[0] * cw + nl[2] * sw, nl[1], -nl[0] * sw + nl[2] * cw);
      best = { t: t0, piece: p, point: origin.clone().addScaledVector(dir, t0), normal };
    }
    return best;
  }

  private bounds(p: Piece): [number[], number[]] {
    switch (p.type) {
      case 'wood_foundation':
        return [
          [-HALF, -Math.max(0.45, p.depth), -HALF],
          [HALF, 0, HALF],
        ];
      case 'wood_floor':
        return [
          [-HALF, -0.34, -HALF],
          [HALF, 0, HALF],
        ];
      case 'wood_wall':
      case 'wood_doorway':
        return [
          [-HALF, 0, -0.12],
          [HALF, STOREY, 0.12],
        ];
      case 'wood_roof':
        return [
          [-HALF - 0.15, 0, -HALF - 0.3],
          [HALF + 0.15, 1.75, HALF + 0.3],
        ];
      case 'wood_stairs':
        return [
          [-HALF, 0, -HALF],
          [HALF, STOREY, HALF],
        ];
    }
  }

  // ---------------------------------------------------------------------------
  // Placement

  /** Update the placement ghost; returns the prompt, or null when not building. */
  updateGhost(type: PieceType | null, camera: THREE.Camera, rotate: boolean, terrainHit: (origin: THREE.Vector3, dir: THREE.Vector3, max: number, out: THREE.Vector3) => number): string | null {
    if (!type) {
      this.ghost.visible = false;
      this.ghostType = null;
      this.ghostTarget = null;
      return null;
    }
    if (rotate) this.ghostRotation = (this.ghostRotation + 1) % 4;
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const target = this.findTarget(type, origin, dir, terrainHit);
    this.ghostTarget = target;
    this.ghostValid = Boolean(target?.valid);
    this.ghostReason = target ? target.reason : 'nothing to build on';
    if (type !== this.ghostType) {
      this.ghost.clear();
      for (const part of this.parts.get(type) ?? []) {
        const mesh = new THREE.Mesh(part.geometry, this.ghostMaterial);
        mesh.userData.depthScaled = Boolean(part.depthScaled);
        mesh.layers.set(LAYER_TRANSPARENT);
        this.ghost.add(mesh);
      }
      this.ghostType = type;
    }
    if (!target) {
      this.ghost.visible = false;
      return `${NAMES[type]} · ${this.ghostReason}`;
    }
    const tr = this.targetTransform(type, target);
    this.ghost.visible = true;
    this.ghost.position.set(tr.x, tr.y, tr.z);
    this.ghost.rotation.set(0, tr.yaw, 0);
    for (const child of this.ghost.children) child.scale.y = child.userData.depthScaled ? Math.max(0.3, target.depth) : 1;
    this.ghostMaterial.color.set(this.ghostValid ? 0x9fe8c8 : 0xff7a6a);
    return this.ghostValid ? `Place ${NAMES[type]}` : `${NAMES[type]} · ${target.reason}`;
  }

  private targetTransform(type: PieceType, t: Target): { x: number; y: number; z: number; yaw: number } {
    const g: Grid = t.grid ?? this.gridFrom(0, t.fresh as { x: number; y: number; z: number; yaw: number });
    return this.transform(g, { type, i: t.i, j: t.j, level: t.level, dir: t.dir });
  }

  private gridFrom(id: number, f: { x: number; y: number; z: number; yaw: number }): Grid {
    return { id, x: f.x, y: f.y, z: f.z, yaw: f.yaw, cos: Math.cos(f.yaw), sin: Math.sin(f.yaw), radius: 0 };
  }

  private findTarget(type: PieceType, origin: THREE.Vector3, dir: THREE.Vector3, terrainHit: (o: THREE.Vector3, d: THREE.Vector3, max: number, out: THREE.Vector3) => number): Target | null {
    const pieceHit = this.raycast(origin, dir, REACH);
    const ground = new THREE.Vector3();
    const tg = terrainHit(origin, dir, REACH, ground);
    const onPiece = pieceHit && (tg < 0 || pieceHit.t <= tg) ? pieceHit : null;
    const point = onPiece ? onPiece.point : tg >= 0 ? ground : null;
    if (!point) return null;
    let grid = onPiece ? (this.grids.find((g) => g.id === onPiece.piece.grid) as Grid) : this.nearestGrid(point.x, point.z, 5);
    const make = (partial: Partial<Target>): Target => ({ grid, fresh: null, i: 0, j: 0, level: 0, dir: 0, depth: 0, valid: false, reason: '', ...partial });
    // Facing (for stairs and roofs): rising away from the viewer, plus R turns.
    const facing = (g: Grid) => {
      const { u, v } = { u: dir.x * g.cos - dir.z * g.sin, v: dir.x * g.sin + dir.z * g.cos };
      const base = Math.abs(u) > Math.abs(v) ? (u > 0 ? 1 : 3) : v > 0 ? 2 : 0;
      return (base + this.ghostRotation) % 4;
    };

    if (type === 'wood_foundation') {
      if (grid) {
        const local = this.toLocal(grid, point.x, point.z);
        let i = Math.round(local.u / CELL);
        let j = Math.round(local.v / CELL);
        if (onPiece && onPiece.piece.type === 'wood_foundation') {
          const n = onPiece.normal;
          const nl = this.toLocal(grid, grid.x + n.x, grid.z + n.z);
          if (Math.abs(n.y) < 0.5) {
            i = onPiece.piece.i + Math.round(nl.u);
            j = onPiece.piece.j + Math.round(nl.v);
          } else {
            const ahead = this.toLocal(grid, point.x + dir.x * 1.4, point.z + dir.z * 1.4);
            i = Math.round(ahead.u / CELL);
            j = Math.round(ahead.v / CELL);
          }
        }
        const occupied = this.hasDeck(grid.id, i, j, 0);
        const adjacent = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([a, b]) => this.hasDeck(grid!.id, i + a, j + b, 0));
        if (!occupied && adjacent) {
          const depth = this.depthUnder(grid, i, j, grid.y);
          const t = make({ i, j, level: 0, depth });
          return this.validateFoundation(t, grid, i, j);
        }
        if (occupied) return make({ i, j, reason: 'occupied' });
        // Far from the rest of the grid: start a new building instead.
        if (Math.hypot(local.u - i * CELL, local.v - j * CELL) > 0 && !adjacent && this.nearestGrid(point.x, point.z, 1.6)) return make({ i, j, reason: 'too close to another building' });
        grid = null;
      }
      // A new grid, aligned to the view and turned in 15° steps by R.
      const yaw = Math.round(Math.atan2(-dir.x, -dir.z) / (Math.PI / 12)) * (Math.PI / 12) + this.ghostRotation * (Math.PI / 12);
      const top = this.freshTop(point.x, point.z, yaw);
      const fresh = { x: point.x, y: top.y, z: point.z, yaw };
      const t: Target = { grid: null, fresh, i: 0, j: 0, level: 0, dir: 0, depth: top.depth, valid: true, reason: '' };
      if (this.world.waterDepthAt(point.x, point.z) > 0.4) return { ...t, valid: false, reason: 'in deep water' };
      if (top.depth > MAX_DEPTH) return { ...t, valid: false, reason: 'ground too uneven' };
      if (Math.hypot(point.x - origin.x, point.z - origin.z) > 7) return { ...t, valid: false, reason: 'too far' };
      return t;
    }

    if (!grid) return make({ reason: 'needs a foundation' });
    const g = grid;
    const local = this.toLocal(g, point.x, point.z);
    const levelAt = (y: number) => Math.max(0, Math.min(MAX_LEVEL, Math.round((y - g.y) / STOREY)));

    if (type === 'wood_wall' || type === 'wood_doorway') {
      let level: number;
      let i: number;
      let j: number;
      let edge: number;
      if (onPiece && (onPiece.piece.type === 'wood_wall' || onPiece.piece.type === 'wood_doorway')) {
        // Aiming at a wall: stack another on top of it.
        const p = onPiece.piece;
        level = p.level + 1;
        i = p.i;
        j = p.j;
        edge = p.dir;
      } else {
        level = onPiece ? onPiece.piece.level + (onPiece.piece.type === 'wood_roof' ? 0 : 0) : 0;
        if (onPiece && onPiece.piece.type === 'wood_stairs') level = onPiece.piece.level;
        i = Math.round(local.u / CELL);
        j = Math.round(local.v / CELL);
        const du = local.u - i * CELL;
        const dv = local.v - j * CELL;
        const d = [dv + HALF, HALF - du, HALF - dv, du + HALF];
        edge = d.indexOf(Math.min(...d));
        const e = this.canonicalEdge(i, j, edge);
        i = e.i;
        j = e.j;
        edge = e.dir;
      }
      const t = make({ i, j, level, dir: edge });
      if (level > MAX_LEVEL) return { ...t, reason: 'too high' };
      if (this.wallAt(g.id, i, j, level, edge)) return { ...t, reason: 'occupied' };
      // Support: a deck on either side of the edge, or a wall below.
      const other = edge === 0 ? [i, j - 1] : [i - 1, j];
      const supported = this.hasDeck(g.id, i, j, level) || this.hasDeck(g.id, other[0], other[1], level) || (level > 0 && Boolean(this.wallAt(g.id, i, j, level - 1, edge)));
      return supported ? { ...t, valid: true } : { ...t, reason: 'needs a floor or wall below' };
    }

    if (type === 'wood_floor' || type === 'wood_roof') {
      let level: number;
      let i: number;
      let j: number;
      if (onPiece && (onPiece.piece.type === 'wood_wall' || onPiece.piece.type === 'wood_doorway')) {
        // Over the room on the viewer's side of the wall.
        const p = onPiece.piece;
        level = p.level + 1;
        const cands = p.dir === 0 ? [[p.i, p.j], [p.i, p.j - 1]] : [[p.i, p.j], [p.i - 1, p.j]];
        const cam = this.toLocal(g, origin.x, origin.z);
        const dist = (c: number[]) => (c[0] * CELL - cam.u) ** 2 + (c[1] * CELL - cam.v) ** 2;
        const pick = dist(cands[0]) <= dist(cands[1]) ? cands[0] : cands[1];
        i = pick[0];
        j = pick[1];
      } else {
        level = onPiece ? (onPiece.piece.type === 'wood_foundation' ? 1 : onPiece.piece.level) : levelAt(point.y);
        const ahead = this.toLocal(g, point.x + dir.x * 1.2, point.z + dir.z * 1.2);
        i = Math.round((onPiece && onPiece.piece.type === 'wood_foundation' ? local.u : ahead.u) / CELL);
        j = Math.round((onPiece && onPiece.piece.type === 'wood_foundation' ? local.v : ahead.v) / CELL);
        if (onPiece && (onPiece.piece.type === 'wood_floor' || onPiece.piece.type === 'wood_roof') && Math.abs(onPiece.normal.y) > 0.5 && i === onPiece.piece.i && j === onPiece.piece.j) {
          // Looking down at an existing deck: extend it forward.
          const a2 = this.toLocal(g, point.x + dir.x * 3, point.z + dir.z * 3);
          i = Math.round(a2.u / CELL);
          j = Math.round(a2.v / CELL);
        }
      }
      if (level < 1) level = 1;
      const t = make({ i, j, level, dir: type === 'wood_roof' ? facing(g) : 0 });
      if (level > MAX_LEVEL) return { ...t, reason: 'too high' };
      if (this.at(g.id, i, j, level, ['wood_floor', 'wood_roof'])) return { ...t, reason: 'occupied' };
      const wallBelow = [0, 1, 2, 3].some((e) => this.wallAt(g.id, i, j, level - 1, e));
      const neighbour = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([a, b]) => Boolean(this.at(g.id, i + a, j + b, level, ['wood_floor', 'wood_roof'])));
      return wallBelow || neighbour ? { ...t, valid: true } : { ...t, reason: 'needs walls below' };
    }

    // Stairs: on a deck, rising away from the viewer.
    const deckLevel = onPiece ? onPiece.piece.level : 0;
    const i = Math.round(local.u / CELL);
    const j = Math.round(local.v / CELL);
    const t = make({ i, j, level: deckLevel, dir: facing(g) });
    if (!this.hasDeck(g.id, i, j, deckLevel)) return { ...t, reason: 'needs a foundation or floor' };
    if (this.at(g.id, i, j, deckLevel, ['wood_stairs'])) return { ...t, reason: 'occupied' };
    return { ...t, valid: true };
  }

  private validateFoundation(t: Target, g: Grid, i: number, j: number): Target {
    if (t.depth > MAX_DEPTH) return { ...t, reason: 'ground falls away' };
    const c = this.toWorld(g, i * CELL, j * CELL);
    // Terrain poking through the deck.
    const corners = this.cellHeights(g, i, j);
    if (Math.max(...corners) > g.y + 0.35) return { ...t, reason: 'ground in the way' };
    if (this.world.waterDepthAt(c.x, c.z) > 1.5) return { ...t, reason: 'in deep water' };
    return { ...t, valid: true };
  }

  private cellHeights(g: Grid, i: number, j: number): number[] {
    const out: number[] = [];
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
    ]) {
      const w = this.toWorld(g, i * CELL + a * (HALF - 0.1), j * CELL + b * (HALF - 0.1));
      out.push(this.world.heightAt(w.x, w.z));
    }
    return out;
  }

  private depthUnder(g: Grid, i: number, j: number, top: number): number {
    return top - Math.min(...this.cellHeights(g, i, j)) + 0.1;
  }

  /** Deck height for a new building: just above the highest ground under it. */
  private freshTop(x: number, z: number, yaw: number): { y: number; depth: number } {
    const g = this.gridFrom(0, { x, y: 0, z, yaw });
    const h = this.cellHeights(g, 0, 0);
    const top = Math.max(...h) + 0.3;
    return { y: top, depth: top - Math.min(...h) + 0.1 };
  }

  private nearestGrid(x: number, z: number, margin: number): Grid | null {
    let best: Grid | null = null;
    let bestD = Infinity;
    for (const g of this.grids) {
      const d = Math.hypot(x - g.x, z - g.z) - g.radius;
      if (d < HALF + margin && d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  }

  /** Place the ghosted piece; returns it (or null if invalid). */
  placeGhost(): Piece | null {
    const t = this.ghostTarget;
    const type = this.ghostType;
    if (!t || !type || !t.valid) return null;
    let grid = t.grid;
    if (!grid) {
      const f = t.fresh as { x: number; y: number; z: number; yaw: number };
      grid = this.gridFrom(this.nextGrid++, f);
      this.grids.push(grid);
    }
    const piece = this.add({ grid: grid.id, type, i: t.i, j: t.j, level: t.level, dir: t.dir, depth: t.depth });
    this.events.emit('notify', { text: `${NAMES[type]} placed`, icon: 'build', tone: 'good' });
    this.events.emit('crafted', { recipe: 'place', item: type, count: 1 });
    return piece;
  }

  private add(d: { grid: number; type: PieceType; i: number; j: number; level: number; dir: number; depth: number; id?: number }): Piece {
    const g = this.grids.find((gg) => gg.id === d.grid) as Grid;
    const piece: Piece = { id: d.id ?? this.nextPiece++, grid: d.grid, type: d.type, i: d.i, j: d.j, level: d.level, dir: d.dir, depth: d.depth, colliders: [] };
    this.nextPiece = Math.max(this.nextPiece, piece.id + 1);
    piece.colliders = this.makeColliders(g, piece);
    this.pieces.push(piece);
    const k = this.key(d.grid, d.i, d.j);
    const list = this.byCell.get(k) ?? [];
    list.push(piece);
    this.byCell.set(k, list);
    g.radius = Math.max(g.radius, Math.hypot(d.i * CELL, d.j * CELL) + HALF);
    this.rebuild();
    return piece;
  }

  private makeColliders(g: Grid, p: Piece): Circle[] {
    const tr = this.transform(g, p);
    const out: Circle[] = [];
    const along = (offsets: number[], radius: number, baseY: number, height: number) => {
      const ax = Math.cos(tr.yaw);
      const az = -Math.sin(tr.yaw);
      for (const o of offsets) out.push({ x: tr.x + ax * o, z: tr.z + az * o, radius, height, baseY });
    };
    if (p.type === 'wood_wall') along([-1.15, -0.38, 0.38, 1.15], 0.4, tr.y, STOREY);
    else if (p.type === 'wood_doorway') {
      along([-1.2, -0.95, 0.95, 1.2], 0.3, tr.y, STOREY);
      // The lintel above the opening.
      along([-0.3, 0.3], 0.35, tr.y + 2.3, STOREY - 2.3);
    } else if (p.type === 'wood_foundation') {
      const bottom = tr.y - p.depth;
      for (const [a, b] of [
        [-0.75, -0.75],
        [0.75, -0.75],
        [-0.75, 0.75],
        [0.75, 0.75],
      ]) {
        const w = this.toWorld(g, p.i * CELL + a, p.j * CELL + b);
        out.push({ x: w.x, z: w.z, radius: 1.02, height: tr.y - bottom - 0.02, baseY: bottom });
      }
    }
    return out;
  }

  /** The piece under the aim (for dismantling). */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Piece | null {
    return this.raycast(origin, dir, reach)?.piece ?? null;
  }

  /** Can this piece come down without leaving anything floating? */
  canRemove(p: Piece): boolean {
    const g = p.grid;
    if (p.type === 'wood_foundation' || p.type === 'wood_floor') {
      // Walls or stairs standing on this deck with no other support.
      for (const other of this.pieces) {
        if (other === p || other.grid !== g || other.level !== p.level) continue;
        if (other.type === 'wood_stairs' && other.i === p.i && other.j === p.j) return false;
        if (other.type === 'wood_wall' || other.type === 'wood_doorway') {
          const cells = other.dir === 0 ? [[other.i, other.j], [other.i, other.j - 1]] : [[other.i, other.j], [other.i - 1, other.j]];
          const touches = cells.some(([a, b]) => a === p.i && b === p.j);
          if (!touches) continue;
          const others = cells.some(([a, b]) => !(a === p.i && b === p.j) && this.hasDeck(g, a, b, p.level));
          const below = p.level > 0 && this.wallAt(g, other.i, other.j, p.level - 1, other.dir);
          if (!others && !below) return false;
        }
      }
    }
    if (p.type === 'wood_wall' || p.type === 'wood_doorway') {
      if (this.wallAt(g, p.i, p.j, p.level + 1, p.dir)) return false;
      // The only wall holding up a floor or roof above.
      const cells = p.dir === 0 ? [[p.i, p.j], [p.i, p.j - 1]] : [[p.i, p.j], [p.i - 1, p.j]];
      for (const [a, b] of cells) {
        if (!this.at(g, a, b, p.level + 1, ['wood_floor', 'wood_roof'])) continue;
        const otherWall = [0, 1, 2, 3].some((e) => {
          const w = this.wallAt(g, a, b, p.level, e);
          return w !== undefined && w !== p;
        });
        if (!otherWall) return false;
      }
    }
    return true;
  }

  remove(p: Piece): number {
    const i = this.pieces.indexOf(p);
    if (i < 0) return 0;
    this.pieces.splice(i, 1);
    const k = this.key(p.grid, p.i, p.j);
    const list = this.byCell.get(k);
    if (list) {
      list.splice(list.indexOf(p), 1);
      if (list.length === 0) this.byCell.delete(k);
    }
    // An empty grid disappears.
    if (!this.pieces.some((q) => q.grid === p.grid)) this.grids.splice(this.grids.findIndex((g) => g.id === p.grid), 1);
    this.rebuild();
    return REFUND[p.type];
  }

  /** World transforms of every piece (tests, debugging). */
  debugPieces(): { id: number; type: PieceType; x: number; y: number; z: number; yaw: number; level: number; i: number; j: number; dir: number }[] {
    return this.pieces.map((p) => {
      const g = this.grids.find((gg) => gg.id === p.grid) as Grid;
      const tr = this.transform(g, p);
      return { id: p.id, type: p.type, x: tr.x, y: tr.y, z: tr.z, yaw: tr.yaw, level: p.level, i: p.i, j: p.j, dir: p.dir };
    });
  }

  static label(type: PieceType): string {
    return NAMES[type];
  }

  get count(): number {
    return this.pieces.length;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  private rebuild(): void {
    for (const type of PIECE_TYPES) {
      const parts = this.parts.get(type) ?? [];
      const list = this.pieces.filter((p) => p.type === type);
      parts.forEach((part, k) => {
        const key = `${type}:${k}`;
        let mesh = this.instanced.get(key);
        if (!mesh || mesh.instanceMatrix.count < list.length) {
          if (mesh) {
            this.group.remove(mesh);
            mesh.dispose();
          }
          const capacity = Math.max(16, Math.ceil(list.length * 1.5));
          mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          this.instanced.set(key, mesh);
          this.group.add(mesh);
        }
        list.forEach((p, n) => {
          const g = this.grids.find((gg) => gg.id === p.grid) as Grid;
          const tr = this.transform(g, p);
          this.tmpPos.set(tr.x, tr.y, tr.z);
          this.tmpQuat.setFromAxisAngle(this.up, tr.yaw);
          this.tmpScale.set(1, part.depthScaled ? Math.max(0.3, p.depth) : 1, 1);
          this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
          (mesh as THREE.InstancedMesh).setMatrixAt(n, this.tmpMatrix);
        });
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Save

  serialize(): { grids: { id: number; x: number; y: number; z: number; yaw: number }[]; pieces: { id: number; grid: number; type: PieceType; i: number; j: number; level: number; dir: number; depth: number }[] } {
    return {
      grids: this.grids.map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z, yaw: g.yaw })),
      pieces: this.pieces.map((p) => ({ id: p.id, grid: p.grid, type: p.type, i: p.i, j: p.j, level: p.level, dir: p.dir, depth: p.depth })),
    };
  }

  load(data: ReturnType<Building['serialize']> | null): void {
    this.grids.length = 0;
    this.pieces.length = 0;
    this.byCell.clear();
    this.nextGrid = 1;
    this.nextPiece = 1;
    for (const g of data?.grids ?? []) {
      this.grids.push(this.gridFrom(g.id, g));
      this.nextGrid = Math.max(this.nextGrid, g.id + 1);
    }
    for (const p of data?.pieces ?? []) if (this.grids.some((g) => g.id === p.grid) && isPieceType(p.type)) this.add(p);
    this.rebuild();
  }
}
