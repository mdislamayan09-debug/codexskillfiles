import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHand, GRIP_R, tube } from '../../src/player/hand';

describe('first-person hand', () => {
  it('winds tubes so their normals face out', () => {
    const g = tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 1, 0)], () => 0.1, () => new THREE.Vector3(1, 0, 0));
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i += 7) expect(pos.getX(i) * nor.getX(i) + pos.getZ(i) * nor.getZ(i)).toBeGreaterThan(0);
  });

  it('closes the fist round the grip without swallowing it', () => {
    const { glove, sleeve } = buildHand();
    for (const g of [glove, sleeve]) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i += 13) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    }
    // Something wraps every side of the grip at the index finger's height,
    // and nothing sits deep inside the handle.
    const pos = glove.getAttribute('position');
    const sides = new Set<number>();
    let inside = 0;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (Math.abs(pos.getY(i) - 0.03) < 0.01 && r < 0.05) sides.add(Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 8);
      if (Math.abs(pos.getY(i)) < 0.04 && r < GRIP_R * 0.5) inside += 1;
    }
    expect(sides.size).toBe(8);
    expect(inside).toBe(0);
  });
});
