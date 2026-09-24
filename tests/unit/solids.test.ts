import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SolidField } from '../../src/world/SolidField';
import { stairs, wallWithOpenings } from '../../src/story/landmarkKit';

const field = (...geos: THREE.BufferGeometry[]) => {
  const f = new SolidField();
  for (const g of geos) f.add(g);
  f.finish();
  return f;
};

describe('solid set pieces', () => {
  it('turn a block into a wall with a top to stand on', () => {
    const f = field(new THREE.BoxGeometry(2, 3, 2).translate(0, 1.5, 0));
    expect(f.blocked(0.3, 0.3, 0.5, 1.7)).toBe(true);
    expect(f.blocked(1.3, 0, 0.5, 1.7)).toBe(false);
    // From the ground the top is out of reach; standing on it, it is floor.
    expect(f.surfaceAt(0, 0, 0)).toBe(-Infinity);
    expect(f.surfaceAt(0, 0, 3)).toBeCloseTo(3, 3);
    expect(f.normalAt(0, 0, 3, new THREE.Vector3()).y).toBeCloseTo(1, 3);
  });

  it('can be climbed as stairs, a step at a time', () => {
    const f = field(stairs(2, 5, 0.2, 0.4));
    let y = 0;
    for (let z = 0.2; z < 2; z += 0.4) {
      const top = f.surfaceAt(0, z, y, 0.45);
      expect(top).toBeGreaterThan(y);
      y = top;
    }
    expect(y).toBeCloseTo(1, 3);
  });

  it('let the body through a doorway but not the wall beside it', () => {
    const wall = wallWithOpenings(4, 3, 0.4, [{ x: 0, y: 0, w: 1.2, h: 2.2 }]);
    const f = field(wall);
    expect(f.blocked(0, 0, 0.45, 1.75)).toBe(false);
    expect(f.blocked(1.4, 0, 0.45, 1.75)).toBe(true);
    // The lintel over the door is still there.
    expect(f.blocked(0, 0, 2.3, 2.9)).toBe(true);
  });

  it('catch plank walls thinner than a column', () => {
    const f = field(new THREE.BoxGeometry(3, 2.4, 0.12).rotateY(0.63).translate(0.37, 1.2, 0.21));
    let solid = 0;
    for (let t = -1.2; t <= 1.2; t += 0.05) {
      const x = 0.37 + Math.cos(0.63) * t;
      const z = 0.21 - Math.sin(0.63) * t;
      // Somewhere across the plank's thickness a column is solid.
      let any = false;
      for (let s = -0.1; s <= 0.1; s += 0.02) any ||= f.blocked(x + Math.sin(0.63) * s, z + Math.cos(0.63) * s, 0.5, 1.7);
      if (any) solid += 1;
    }
    expect(solid).toBeGreaterThan(40);
  });

  it('know a steep face from a gentle one', () => {
    // A wedge rising 45° along +x.
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2, 0), new THREE.Vector2(2, 2)]);
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false }).translate(0, 0, -1);
    const f = field(wedge);
    const n = f.normalAt(1, 0, 1.1, new THREE.Vector3());
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 2);
    expect(n.x).toBeLessThan(0);
  });

  it('push a body back out of a wall, sliding along it', () => {
    const f = field(new THREE.BoxGeometry(4, 3, 0.5).translate(0, 1.5, 0));
    const p = new THREE.Vector3(0.3, 0, 0.4);
    const v = new THREE.Vector3(1, 0, -2);
    f.confine(p, v, 0.32, 0.45, 1.75);
    expect(p.z).toBeGreaterThanOrEqual(0.25 + 0.32 - 1e-3);
    expect(p.x).toBeCloseTo(0.3, 3);
    expect(v.z).toBeCloseTo(0, 5);
    expect(v.x).toBeCloseTo(1, 5);
  });

  it('stop an arrow at the first solid', () => {
    const f = field(new THREE.BoxGeometry(1, 2, 1).translate(5, 1, 0));
    const hit = f.raycast(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), 10);
    expect(hit?.t).toBeGreaterThan(4.4);
    expect(hit?.t).toBeLessThan(4.6);
    expect(f.raycast(new THREE.Vector3(0, 3, 0), new THREE.Vector3(1, 0, 0), 10)).toBeNull();
  });
});
