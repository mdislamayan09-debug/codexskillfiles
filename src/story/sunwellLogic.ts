// The rules of the Veyr Sunwells, kept apart from the rendering so tests can
// check every layout. A lens at the edge of a paved court throws a beam of
// sunlight across a grid of cells. A prism takes the beam in from any side
// and sends it out of the side it faces, so turning a prism turns the beam;
// a prism turned back toward the light just holds it. Pillars stop the beam,
// and a beam that leaves the court through the vault door's sun disc opens
// the vault.

/** Compass facings: north (-z), east (+x), south (+z), west (-x). */
export type Dir = 0 | 1 | 2 | 3;
export const DX: readonly number[] = [0, 1, 0, -1];
export const DZ: readonly number[] = [-1, 0, 1, 0];
export const DIR_NAMES = ['north', 'east', 'south', 'west'] as const;

export type Cell = readonly [number, number];

/** Metres between cell centres. */
export const SUNWELL_CELL = 3.2;
/** The parapet runs round the court this many cells out from its centre. */
export const SUNWELL_PARAPET = 3.5;

export interface SunwellLayout {
  /** The landmark this court stands at. */
  id: string;
  /** Cells per side of the square court. */
  size: number;
  /** The beam enters `cell` travelling `dir`; the lens stands one cell back. */
  emitter: { cell: Cell; dir: Dir };
  /** Solved when the beam leaves the court from `cell` travelling `dir`. */
  receptor: { cell: Cell; dir: Dir };
  /** Turnable prisms and the way each faces when the court is found. */
  prisms: { cell: Cell; start: Dir }[];
  /** Standing pillars that stop the beam. */
  pillars: Cell[];
}

export type BeamEnd = 'receptor' | 'wall' | 'pillar' | 'held' | 'loop';

export interface BeamTrace {
  /** Where the beam turns, in cell coordinates: the lens, each turning prism, the end. */
  points: [number, number][];
  /** Prisms the beam reaches, in order. */
  lit: number[];
  end: BeamEnd;
}

/** Turn a facing a quarter clockwise, seen from above. */
export function turn(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}

/** Follow the beam across the court for the given prism facings. */
export function traceBeam(layout: SunwellLayout, facings: readonly Dir[]): BeamTrace {
  const { size, emitter, receptor } = layout;
  const prismAt = new Map<number, number>();
  layout.prisms.forEach((p, i) => prismAt.set(p.cell[1] * size + p.cell[0], i));
  const pillars = new Set(layout.pillars.map(([c, r]) => r * size + c));
  let c = emitter.cell[0];
  let r = emitter.cell[1];
  let d = emitter.dir;
  const points: [number, number][] = [[c - DX[d], r - DZ[d]]];
  const lit: number[] = [];
  const seen = new Set<number>();
  for (let guard = 0; guard < size * size * 4 + 4; guard += 1) {
    if (c < 0 || r < 0 || c >= size || r >= size) {
      // Left the court: through the door's disc, or into the parapet.
      const lc = c - DX[d];
      const lr = r - DZ[d];
      const out = lc === receptor.cell[0] && lr === receptor.cell[1] && d === receptor.dir;
      points.push([lc + DX[d] * (out ? 0.9 : 0.62), lr + DZ[d] * (out ? 0.9 : 0.62)]);
      return { points, lit, end: out ? 'receptor' : 'wall' };
    }
    const key = r * size + c;
    if (pillars.has(key)) {
      points.push([c - DX[d] * 0.32, r - DZ[d] * 0.32]);
      return { points, lit, end: 'pillar' };
    }
    const state = key * 4 + d;
    if (seen.has(state)) {
      points.push([c, r]);
      return { points, lit, end: 'loop' };
    }
    seen.add(state);
    const p = prismAt.get(key);
    if (p !== undefined) {
      lit.push(p);
      const f = facings[p];
      if (f === (d + 2) % 4) {
        points.push([c, r]);
        return { points, lit, end: 'held' };
      }
      if (f !== d) points.push([c, r]);
      d = f;
    }
    c += DX[d];
    r += DZ[d];
  }
  points.push([c, r]);
  return { points, lit, end: 'loop' };
}

export function isSolved(layout: SunwellLayout, facings: readonly Dir[]): boolean {
  return traceBeam(layout, facings).end === 'receptor';
}

/**
 * The fewest quarter turns that solve the court from its starting facings,
 * and the facings they reach (breadth-first over every arrangement).
 */
export function solveSunwell(layout: SunwellLayout, from?: readonly Dir[]): { turns: number; facings: Dir[] } | null {
  const n = layout.prisms.length;
  const start = (from ?? layout.prisms.map((p) => p.start)).slice() as Dir[];
  const encode = (f: readonly Dir[]) => f.reduce<number>((acc, d, i) => acc + d * 4 ** i, 0);
  const seen = new Map<number, number>([[encode(start), 0]]);
  let frontier: Dir[][] = [start];
  for (let depth = 0; frontier.length > 0 && depth <= n * 3; depth += 1) {
    const next: Dir[][] = [];
    for (const f of frontier) {
      if (isSolved(layout, f)) return { turns: depth, facings: f };
      for (let i = 0; i < n; i += 1) {
        const g = f.slice() as Dir[];
        g[i] = turn(g[i]);
        const k = encode(g);
        if (seen.has(k)) continue;
        seen.set(k, depth + 1);
        next.push(g);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The three wells, easiest first. Cells are [column, row]: columns run west
 * to east, rows north to south.
 */
export const SUNWELL_LAYOUTS: readonly SunwellLayout[] = [
  // The Dawnwell: two prisms, one turn of the beam each.
  {
    id: 'dawnwell',
    size: 5,
    emitter: { cell: [0, 3], dir: 1 },
    receptor: { cell: [4, 1], dir: 1 },
    prisms: [
      { cell: [2, 3], start: 3 },
      { cell: [2, 1], start: 2 },
    ],
    pillars: [[4, 3], [2, 0]],
  },
  // The Noonwell: a prism that must pass the beam straight on, and pillars
  // that punish the obvious turns.
  {
    id: 'noonwell',
    size: 5,
    emitter: { cell: [0, 0], dir: 2 },
    receptor: { cell: [4, 4], dir: 1 },
    prisms: [
      { cell: [0, 2], start: 3 },
      { cell: [1, 2], start: 2 },
      { cell: [3, 2], start: 3 },
      { cell: [3, 4], start: 0 },
      { cell: [1, 4], start: 1 },
    ],
    pillars: [[0, 3], [4, 2], [3, 0], [2, 4]],
  },
  // The Duskwell: the beam winds up, across, down and up again; the short
  // ways round are walled off, and one prism leads nowhere.
  {
    id: 'duskwell',
    size: 5,
    emitter: { cell: [4, 4], dir: 3 },
    receptor: { cell: [0, 0], dir: 0 },
    prisms: [
      { cell: [3, 4], start: 2 },
      { cell: [3, 2], start: 0 },
      { cell: [1, 2], start: 1 },
      { cell: [1, 4], start: 1 },
      { cell: [0, 4], start: 1 },
      { cell: [0, 0], start: 3 },
      { cell: [3, 0], start: 2 },
    ],
    pillars: [[2, 4], [2, 0], [1, 1]],
  },
];

/**
 * The vault door, set in the parapet where the beam must leave, in metres
 * from the court's centre; `beyond` walks on through it into the vault.
 */
export function doorSpot(layout: SunwellLayout, beyond = 0): [number, number] {
  const { cell, dir } = layout.receptor;
  const half = (layout.size - 1) / 2;
  const along = ((dir === 0 || dir === 2 ? cell[0] : cell[1]) - half) * SUNWELL_CELL;
  const out = SUNWELL_PARAPET * SUNWELL_CELL + beyond;
  return dir === 0 || dir === 2 ? [along, DZ[dir] * out] : [DX[dir] * out, along];
}

/** Where the cache waits inside the vault. */
export function vaultSpot(layout: SunwellLayout): [number, number] {
  return doorSpot(layout, 2.6);
}

export function sunwellLayout(id: string): SunwellLayout {
  const found = SUNWELL_LAYOUTS.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown sunwell: ${id}`);
  return found;
}
