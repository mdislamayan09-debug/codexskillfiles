import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Combat, DODGE, PARRY_WINDOW } from '../../src/game/Combat';

const purse = (amount: number) => ({
  amount,
  spend(n: number) {
    if (this.amount < n) return false;
    this.amount -= n;
    return true;
  },
});

// Facing -z (yaw 0): a blow from z = -2 comes from the front.
const FRONT = { fromX: 0, fromZ: -2 };
const BEHIND = { fromX: 0, fromZ: 2 };

describe('combat', () => {
  it('a dodge costs stamina and makes you briefly untouchable', () => {
    const c = new Combat();
    const s = purse(100);
    expect(c.dodge(1, 0, s)).toBe(true);
    expect(s.amount).toBe(100 - DODGE.stamina);
    expect(c.incoming(30, FRONT.fromX, FRONT.fromZ, 0, 0, 0, s)).toEqual({ damage: 0, result: 'dodged' });
    c.update(DODGE.iframes + 0.01, false);
    expect(c.incoming(30, FRONT.fromX, FRONT.fromZ, 0, 0, 0, s).result).toBe('hit');
  });

  it('cannot dodge again straight away, or when spent', () => {
    const c = new Combat();
    expect(c.dodge(0, 1, purse(100))).toBe(true);
    expect(c.dodge(0, 1, purse(100))).toBe(false);
    c.update(DODGE.cooldown + 0.01, false);
    expect(c.dodge(0, 1, purse(5))).toBe(false);
  });

  it('a guard raised just in time parries; held, it blocks', () => {
    const c = new Combat();
    const s = purse(100);
    c.update(0.05, true);
    expect(c.incoming(20, FRONT.fromX, FRONT.fromZ, 0, 0, 0, s).result).toBe('parried');
    c.update(PARRY_WINDOW + 0.1, true);
    const blocked = c.incoming(20, FRONT.fromX, FRONT.fromZ, 0, 0, 0, s);
    expect(blocked.result).toBe('blocked');
    expect(blocked.damage).toBeCloseTo(5);
    expect(s.amount).toBeCloseTo(100 - 22);
  });

  it('a guard does nothing against a blow from behind', () => {
    const c = new Combat();
    c.update(0.5, true);
    c.update(0.5, true);
    expect(c.incoming(20, BEHIND.fromX, BEHIND.fromZ, 0, 0, 0, purse(100))).toEqual({ damage: 20, result: 'hit' });
  });

  it('breaks when there is no stamina to hold it', () => {
    const c = new Combat();
    c.update(0.5, true);
    c.update(0.5, true);
    const r = c.incoming(40, FRONT.fromX, FRONT.fromZ, 0, 0, 0, purse(10));
    expect(r.result).toBe('guardBreak');
    expect(c.blocking).toBe(false);
    c.update(0.5, true);
    expect(c.blocking).toBe(false);
  });

  it('locks on to what is nearest the crosshair', () => {
    const c = new Combat();
    const eye = new THREE.Vector3(0, 1.7, 0);
    const fwd = new THREE.Vector3(0, 0, -1);
    const pick = c.acquire(
      [
        { kind: 'creature', id: 'far-left', x: -6, y: 1, z: -10 },
        { kind: 'creature', id: 'ahead', x: 0.5, y: 1.2, z: -12 },
        { kind: 'creature', id: 'behind', x: 0, y: 1, z: 5 },
        { kind: 'warden', id: 'too-far', x: 0, y: 3, z: -80 },
      ],
      eye,
      fwd,
    );
    expect(pick?.id).toBe('ahead');
    const aim = Combat.aimAt(eye, 0, 1.7, -10);
    expect(aim.yaw).toBeCloseTo(0);
    expect(aim.pitch).toBeCloseTo(0);
  });
});
