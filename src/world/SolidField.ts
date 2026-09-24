import * as THREE from 'three';

// Solid set pieces for the player: the same triangles the scene draws, laid
// into columns on a fine grid. Each column keeps the heights where solid
// begins and ends (its spans) and which way the top of each span faces.
// A span that rises past the knees is a wall; one whose top is within a
// step is floor, so stairs, decks and terraces can be walked, arches walked
// under and the tops of boulders stood on. Built once at boot.
//
// Each shape is rasterised on its own: going up a column, a face turned
// down enters solid and a face turned up leaves it. Open shells (a dome, a
// hull, a sail) have faces that pair with nothing; those become thin slabs.

/** Metres between column centres: fine enough for plank walls 12 cm thick. */
const CELL = 0.1;
/** Columns per side of a storage tile. */
const TILE = 64;
/** Floats per span: bottom, top, and the top face's normal x and z. */
const STRIDE = 4;
/** Thickness given to a face that bounds no volume. */
const THIN = 0.12;

interface Tile {
  offsets: Uint32Array;
  data: Float32Array;
}

const colKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
const tileKey = (ti: number, tj: number) => (ti + 1024) * 2048 + (tj + 1024);

export interface SolidHit {
  t: number;
  point: THREE.Vector3;
}

export class SolidField {
  /** Columns while building: key → spans [y0, y1, nx, nz]*, sorted and disjoint. */
  private pending: Map<number, number[]> | null = new Map();
  private readonly tiles = new Map<number, Tile>();
  /** Everything added, for quick rejection far from any set piece. */
  private readonly bounds: THREE.Box3[] = [];
  private readonly scratch: number[] = [];

  /**
   * Lay one closed shape (world-space triangles) into the columns. Faces
   * that bound no volume are kept as thin slabs.
   */
  add(geometry: THREE.BufferGeometry): void {
    const pending = this.pending;
    if (!pending) throw new Error('SolidField is finished');
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    geometry.computeBoundingBox();
    this.bounds.push((geometry.boundingBox as THREE.Box3).clone());
    // This shape's face crossings per column: y, facing (+1 up, -1 down), normal x, z.
    const crossings = new Map<number, number[]>();
    const at = (k: number) => (index ? index.getX(k) : k);
    for (let k = 0; k + 2 < count; k += 3) {
      const a = at(k);
      const b = at(k + 1);
      const c = at(k + 2);
      const ax = pos.getX(a);
      const ay = pos.getY(a);
      const az = pos.getZ(a);
      const bx = pos.getX(b);
      const by = pos.getY(b);
      const bz = pos.getZ(b);
      const cx = pos.getX(c);
      const cy = pos.getY(c);
      const cz = pos.getZ(c);
      // Face normal (front faces wind anticlockwise).
      const e1x = bx - ax;
      const e1y = by - ay;
      const e1z = bz - az;
      const e2x = cx - ax;
      const e2y = cy - ay;
      const e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz);
      // Upright faces cross no column.
      if (nl < 1e-12 || Math.abs(ny) < nl * 1e-4) continue;
      const facing = ny > 0 ? 1 : -1;
      const unx = nx / nl;
      const unz = nz / nl;
      // Column centres inside the face's footprint.
      const i0 = Math.ceil(Math.min(ax, bx, cx) / CELL - 0.5);
      const i1 = Math.floor(Math.max(ax, bx, cx) / CELL - 0.5);
      const j0 = Math.ceil(Math.min(az, bz, cz) / CELL - 0.5);
      const j1 = Math.floor(Math.max(az, bz, cz) / CELL - 0.5);
      // Footprint barycentrics: area of (b - a) × (c - a) in xz.
      const area = e1z * e2x - e1x * e2z;
      for (let i = i0; i <= i1; i += 1) {
        const px = (i + 0.5) * CELL;
        for (let j = j0; j <= j1; j += 1) {
          const pz = (j + 0.5) * CELL;
          const wb = ((pz - az) * e2x - (px - ax) * e2z) / area;
          const wc = ((px - ax) * e1z - (pz - az) * e1x) / area;
          const wa = 1 - wb - wc;
          if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
          const key = colKey(i, j);
          let list = crossings.get(key);
          if (!list) {
            list = [];
            crossings.set(key, list);
          }
          list.push(wa * ay + wb * by + wc * cy, facing, unx, unz);
        }
      }
    }
    // Pair crossings bottom-up into spans and merge them into the columns.
    const order: number[] = [];
    for (const [key, list] of crossings) {
      const n = list.length / 4;
      // The usual case: one face below, one above (a block's bottom and top).
      if (n === 2) {
        const lo = list[0] <= list[4] ? 0 : 4;
        const hi = 4 - lo;
        if (list[lo + 1] < 0 && list[hi + 1] > 0) {
          this.merge(pending, key, list[lo], list[hi], list[hi + 2], list[hi + 3]);
          continue;
        }
      }
      order.length = n;
      for (let q = 0; q < n; q += 1) order[q] = q;
      order.sort((p, q) => list[p * 4] - list[q * 4]);
      const spans = this.scratch;
      spans.length = 0;
      let depth = 0;
      let start = 0;
      let lastY = -Infinity;
      let lastFacing = 0;
      for (const q of order) {
        const y = list[q * 4];
        const facing = list[q * 4 + 1];
        // Two triangles of one face both covering the centre.
        if (facing === lastFacing && y - lastY < 0.02) continue;
        lastY = y;
        lastFacing = facing;
        if (facing < 0) {
          if (depth === 0) start = y;
          depth += 1;
        } else if (depth > 0) {
          depth -= 1;
          if (depth === 0) spans.push(start, y, list[q * 4 + 2], list[q * 4 + 3]);
        } else spans.push(y - THIN, y, list[q * 4 + 2], list[q * 4 + 3]);
      }
      if (depth > 0) spans.push(start, start + THIN, 0, 0);
      for (let s = 0; s < spans.length; s += STRIDE) this.merge(pending, key, spans[s], spans[s + 1], spans[s + 2], spans[s + 3]);
    }
  }

  /**
   * Lay every mesh under `root` into the columns, in world space. Subtrees
   * marked `userData.moving` (people, doors that open) and meshes too small
   * to trip over are left out.
   */
  addObject(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const visit = (o: THREE.Object3D) => {
      if (o.userData.moving) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        g.computeBoundingBox();
        const b = g.boundingBox as THREE.Box3;
        if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) >= 0.3 || b.max.y - b.min.y >= 0.6) this.add(g);
        g.dispose();
      }
      for (const child of o.children) visit(child);
    };
    visit(root);
  }

  /** Union one span into a column, keeping the higher top's normal. */
  private merge(pending: Map<number, number[]>, key: number, y0: number, y1: number, nx: number, nz: number): void {
    const col = pending.get(key);
    if (!col) {
      pending.set(key, [y0, y1, nx, nz]);
      return;
    }
    // Most shapes stack: clear above everything so far, just add it.
    if (y0 > col[col.length - 3] + 1e-3) {
      col.push(y0, y1, nx, nz);
      return;
    }
    const kept: number[][] = [];
    for (let s = 0; s < col.length; s += STRIDE) {
      const a0 = col[s];
      const a1 = col[s + 1];
      if (a1 < y0 - 1e-3 || a0 > y1 + 1e-3) {
        kept.push([a0, a1, col[s + 2], col[s + 3]]);
        continue;
      }
      // Overlap: grow the incoming span to cover this one.
      if (a1 > y1) {
        y1 = a1;
        nx = col[s + 2];
        nz = col[s + 3];
      }
      y0 = Math.min(y0, a0);
    }
    kept.push([y0, y1, nx, nz]);
    kept.sort((p, q) => p[0] - q[0]);
    pending.set(key, kept.flat());
  }

  /** Pack the columns into tiles; no more shapes can be added after this. */
  finish(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const byTile = new Map<number, [number, number[]][]>();
    for (const [key, spans] of pending) {
      const i = Math.floor(key / 65536) - 32768;
      const j = (key % 65536) - 32768;
      const tk = tileKey(Math.floor(i / TILE), Math.floor(j / TILE));
      const local = (j - Math.floor(j / TILE) * TILE) * TILE + (i - Math.floor(i / TILE) * TILE);
      let list = byTile.get(tk);
      if (!list) {
        list = [];
        byTile.set(tk, list);
      }
      list.push([local, spans]);
    }
    for (const [tk, list] of byTile) {
      const counts = new Uint32Array(TILE * TILE);
      let total = 0;
      for (const [local, spans] of list) {
        counts[local] = spans.length;
        total += spans.length;
      }
      const offsets = new Uint32Array(TILE * TILE + 1);
      for (let q = 0; q < TILE * TILE; q += 1) offsets[q + 1] = offsets[q] + counts[q];
      const data = new Float32Array(total);
      for (const [local, spans] of list) data.set(spans, offsets[local]);
      this.tiles.set(tk, { offsets, data });
    }
  }

  get size(): number {
    let n = 0;
    for (const t of this.tiles.values()) n += t.data.length / STRIDE;
    return n;
  }

  /** The spans of the column at (x, z): [data, first, end) in floats, or null. */
  private column(x: number, z: number): [Float32Array, number, number] | null {
    const i = Math.floor(x / CELL);
    const j = Math.floor(z / CELL);
    const ti = Math.floor(i / TILE);
    const tj = Math.floor(j / TILE);
    const tile = this.tiles.get(tileKey(ti, tj));
    if (!tile) return null;
    const local = (j - tj * TILE) * TILE + (i - ti * TILE);
    const a = tile.offsets[local];
    const b = tile.offsets[local + 1];
    return a === b ? null : [tile.data, a, b];
  }

  /** Near any set piece at all (cheap test before the column work). */
  near(x: number, z: number, margin: number): boolean {
    for (const b of this.bounds) if (x > b.min.x - margin && x < b.max.x + margin && z > b.min.z - margin && z < b.max.z + margin) return true;
    return false;
  }

  /** Highest top at (x, z) no higher than y + step (-Infinity if none). */
  surfaceAt(x: number, z: number, y: number, step = 0.5): number {
    const col = this.column(x, z);
    if (!col) return -Infinity;
    const [data, a, b] = col;
    let best = -Infinity;
    for (let s = a; s < b; s += STRIDE) {
      const top = data[s + 1];
      if (top <= y + step && top > best) best = top;
    }
    return best;
  }

  /** Which way the top found by `surfaceAt` faces (up when there is none). */
  normalAt(x: number, z: number, y: number, out: THREE.Vector3, step = 0.5): THREE.Vector3 {
    out.set(0, 1, 0);
    const col = this.column(x, z);
    if (!col) return out;
    const [data, a, b] = col;
    let best = -Infinity;
    for (let s = a; s < b; s += STRIDE) {
      const top = data[s + 1];
      if (top <= y + step && top > best) {
        best = top;
        const nx = data[s + 2];
        const nz = data[s + 3];
        out.set(nx, Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)), nz);
      }
    }
    return out;
  }

  /** Is there solid at (x, z) between heights `from` and `to`? */
  blocked(x: number, z: number, from: number, to: number): boolean {
    const col = this.column(x, z);
    if (!col) return false;
    const [data, a, b] = col;
    for (let s = a; s < b; s += STRIDE) if (data[s + 1] > from && data[s] < to) return true;
    return false;
  }

  /** The top of the highest span at (x, z), for standing someone on a set piece. */
  topAt(x: number, z: number): number {
    const col = this.column(x, z);
    return col ? col[0][col[2] - STRIDE + 1] : -Infinity;
  }

  /**
   * Keep a body (a circle of `radius` at the feet `p`, `height` tall) out of
   * solid that rises more than `step` above its feet. Walls push it back
   * along their face; a ceiling met on the way up stops the rise.
   */
  confine(p: THREE.Vector3, v: THREE.Vector3, radius: number, step: number, height: number): void {
    if (this.tiles.size === 0 || !this.near(p.x, p.z, radius + 0.5)) return;
    for (let pass = 0; pass < 4; pass += 1) {
      let deepest = 0;
      let pushX = 0;
      let pushZ = 0;
      const i0 = Math.floor((p.x - radius) / CELL);
      const i1 = Math.floor((p.x + radius) / CELL);
      const j0 = Math.floor((p.z - radius) / CELL);
      const j1 = Math.floor((p.z + radius) / CELL);
      for (let i = i0; i <= i1; i += 1) {
        for (let j = j0; j <= j1; j += 1) {
          const x0 = i * CELL;
          const z0 = j * CELL;
          const col = this.column(x0 + CELL * 0.5, z0 + CELL * 0.5);
          if (!col) continue;
          const [data, a, b] = col;
          let solid = false;
          for (let s = a; s < b; s += STRIDE) {
            const y0 = data[s];
            const y1 = data[s + 1];
            if (y1 <= p.y + step || y0 >= p.y + height) continue;
            // Overhead on the way up: a ceiling, not a wall.
            if (v.y > 0 && y0 > p.y + height - 0.5) {
              p.y = y0 - height;
              v.y = 0;
              continue;
            }
            solid = true;
            break;
          }
          if (!solid) continue;
          // Circle against the column's square.
          const qx = Math.max(x0, Math.min(p.x, x0 + CELL));
          const qz = Math.max(z0, Math.min(p.z, z0 + CELL));
          let dx = p.x - qx;
          let dz = p.z - qz;
          let d = Math.hypot(dx, dz);
          if (d < 1e-6) {
            // The centre is inside: out the way it came in.
            dx = p.x - (x0 + CELL * 0.5);
            dz = p.z - (z0 + CELL * 0.5);
            d = Math.hypot(dx, dz) || 1;
            const depth = radius + CELL * 0.5;
            if (depth > deepest) {
              deepest = depth;
              pushX = dx / d;
              pushZ = dz / d;
            }
            continue;
          }
          const depth = radius - d;
          if (depth > deepest) {
            deepest = depth;
            pushX = dx / d;
            pushZ = dz / d;
          }
        }
      }
      if (deepest <= 1e-4) return;
      p.x += pushX * deepest;
      p.z += pushZ * deepest;
      const into = v.x * pushX + v.z * pushZ;
      if (into < 0) {
        v.x -= pushX * into;
        v.z -= pushZ * into;
      }
    }
  }

  /** First solid along a ray (an arrow's flight), marching the columns. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, out = new THREE.Vector3()): SolidHit | null {
    if (this.tiles.size === 0) return null;
    const ex = origin.x + dir.x * max;
    const ez = origin.z + dir.z * max;
    let hit = false;
    for (const b of this.bounds) {
      if (Math.max(origin.x, ex) < b.min.x || Math.min(origin.x, ex) > b.max.x || Math.max(origin.z, ez) < b.min.z || Math.min(origin.z, ez) > b.max.z) continue;
      hit = true;
      break;
    }
    if (!hit) return null;
    const stepLen = CELL * 0.5;
    for (let t = 0; t <= max; t += stepLen) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const col = this.column(x, z);
      if (!col) continue;
      const [data, a, b] = col;
      for (let s = a; s < b; s += STRIDE) {
        if (y >= data[s] && y <= data[s + 1]) return { t, point: out.set(x, y, z) };
      }
    }
    return null;
  }
}
