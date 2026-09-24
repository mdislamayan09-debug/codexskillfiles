import { describe, expect, it } from 'vitest';
import { isSolved, solveSunwell, SUNWELL_LAYOUTS, traceBeam, turn, type Dir } from '../../src/story/sunwellLogic';

const starts = (i: number) => SUNWELL_LAYOUTS[i].prisms.map((p) => p.start) as Dir[];

describe('sunwell beams', () => {
  it('turn a quarter clockwise and come round again', () => {
    expect(turn(0)).toBe(1);
    expect(turn(3)).toBe(0);
    let d: Dir = 2;
    for (let i = 0; i < 4; i += 1) d = turn(d);
    expect(d).toBe(2);
  });

  it('start at the lens and pass straight on through open cells', () => {
    const layout = SUNWELL_LAYOUTS[0];
    const t = traceBeam(layout, starts(0));
    const [lx, lz] = t.points[0];
    expect(lx).toBe(layout.emitter.cell[0] - 1);
    expect(lz).toBe(layout.emitter.cell[1]);
  });

  it('are held by a prism turned back toward the light', () => {
    const t = traceBeam(SUNWELL_LAYOUTS[0], starts(0));
    expect(t.end).toBe('held');
    expect(t.lit).toEqual([0]);
  });

  it('stop at pillars and the parapet', () => {
    const layout = SUNWELL_LAYOUTS[0];
    // Straight on east from the first prism runs into the pillar at (4, 3).
    expect(traceBeam(layout, [1, 2]).end).toBe('pillar');
    // Turned south, it leaves the court away from the door.
    expect(traceBeam(layout, [2, 2]).end).toBe('wall');
  });
});

describe('the three sunwells', () => {
  it('are all unsolved when found', () => {
    for (let i = 0; i < SUNWELL_LAYOUTS.length; i += 1) expect(isSolved(SUNWELL_LAYOUTS[i], starts(i)), SUNWELL_LAYOUTS[i].id).toBe(false);
  });

  it('can all be solved, each harder than the last', () => {
    let last = 0;
    for (const layout of SUNWELL_LAYOUTS) {
      const s = solveSunwell(layout);
      expect(s, layout.id).not.toBeNull();
      expect(isSolved(layout, s!.facings)).toBe(true);
      expect(s!.turns).toBeGreaterThan(last);
      last = s!.turns;
    }
    expect(last).toBeGreaterThanOrEqual(10);
  });

  it('have one true path, so the answer is not luck', () => {
    for (const layout of SUNWELL_LAYOUTS) {
      const n = layout.prisms.length;
      const paths = new Set<string>();
      for (let k = 0; k < 4 ** n; k += 1) {
        const f = Array.from({ length: n }, (_, i) => (Math.floor(k / 4 ** i) % 4) as Dir);
        const t = traceBeam(layout, f);
        if (t.end === 'receptor') paths.add(JSON.stringify(t.points));
      }
      expect(paths.size, layout.id).toBe(1);
    }
  });

  it('keep prisms, pillars, lens and door on distinct cells inside the court', () => {
    for (const layout of SUNWELL_LAYOUTS) {
      const cells = [...layout.prisms.map((p) => p.cell), ...layout.pillars].map(([c, r]) => `${c},${r}`);
      expect(new Set(cells).size, layout.id).toBe(cells.length);
      for (const key of cells) {
        const [c, r] = key.split(',').map(Number);
        expect(c >= 0 && r >= 0 && c < layout.size && r < layout.size, `${layout.id} ${key}`).toBe(true);
      }
      expect(cells.includes(layout.emitter.cell.join(',')) && layout.pillars.some(([c, r]) => c === layout.emitter.cell[0] && r === layout.emitter.cell[1])).toBe(false);
    }
  });
});
