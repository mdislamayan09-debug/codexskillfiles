import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BIRD_SPECIES, Birds } from '../../src/creatures/Birds';
import { BIOME_COUNT } from '../../src/world/WorldConfig';
import type { WorldData } from '../../src/world/WorldData';

// A flat meadow at y = 10, all Greensward, no water.
const flatWorld = {
  heightAt: () => 10,
  groundAt: () => 10,
  waterLevelAt: () => -Infinity,
  waterDepthAt: () => -20,
  slopeAt: () => 0,
  biomeWeights: (_x: number, _z: number, out: Float32Array) => {
    out.fill(0);
    out[0] = 1;
    return out;
  },
} as unknown as WorldData;
void BIOME_COUNT;

function flock(player = { x: 0, y: 10, z: 60, crouching: false, sprinting: false }) {
  const birds = new Birds(flatWorld, { player: () => player, isNight: () => false, sound: () => {} });
  birds.cap = 0; // no ambient spawns
  const id = birds.debugSpawn('rook', 0, 0, 5, false);
  return { birds, id, player };
}

describe('birds', () => {
  it('forage quietly while nothing comes near', () => {
    const { birds } = flock();
    for (let i = 0; i < 30; i += 1) birds.update(1 / 30, i / 30);
    expect(birds.debugBirds().every((b) => b.state === 'ground')).toBe(true);
  });

  it('flush when someone walks up', () => {
    const { birds, player } = flock();
    player.z = 6;
    birds.update(1 / 30, 0);
    for (let i = 0; i < 30; i += 1) birds.update(1 / 30, i / 30);
    const all = birds.debugBirds();
    expect(all.every((b) => b.state === 'fly')).toBe(true);
    expect(Math.max(...all.map((b) => b.y))).toBeGreaterThan(10.5);
  });

  it('fall to an arrow, and give feathers and the arrow back', () => {
    const { birds } = flock();
    const target = birds.debugBirds()[0];
    const from = new THREE.Vector3(target.x, target.y + 0.1, target.z + 20);
    const dir = new THREE.Vector3(0, 0, -1);
    const hit = birds.pick(from, dir, 25);
    expect(hit?.id).toBe(target.id);
    expect(hit?.species).toBe('rook');
    expect(birds.shoot(target.id, dir, 'flint_arrow')).toBe(true);
    for (let i = 0; i < 20; i += 1) birds.update(1 / 30, i / 30);
    const down = birds.debugBirds().find((b) => b.id === target.id);
    expect(down?.state).toBe('dead');
    const got = birds.collect(target.id);
    expect(got?.arrows).toEqual(['flint_arrow']);
    expect(got?.loot.some(([item, n]) => item === 'feather' && n > 0)).toBe(true);
    // Only once.
    expect(birds.collect(target.id)).toBeNull();
  });

  it('every species drops something', () => {
    for (const s of BIRD_SPECIES) expect(s.loot.some(([, , max]) => max > 0), s.id).toBe(true);
  });
});
