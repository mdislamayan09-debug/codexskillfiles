import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, damp, smoothstep } from '../../src/core/math';
import { createRng, hashString } from '../../src/core/rng';
import { EventBus } from '../../src/core/Events';

describe('math', () => {
  it('clamps and smooths', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
  });

  it('turns the short way round', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1))).toBeCloseTo(0.2);
  });

  it('damps toward a target independent of frame rate', () => {
    let a = 0;
    for (let i = 0; i < 60; i += 1) a = damp(a, 1, 3, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i += 1) b = damp(b, 1, 3, 1 / 30);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i += 1) expect(a()).toBe(b());
    const c = createRng(43);
    expect(c()).not.toBe(createRng(42)());
  });

  it('hashes strings stably', () => {
    expect(hashString('mossback')).toBe(hashString('mossback'));
    expect(hashString('mossback')).not.toBe(hashString('tidemother'));
  });
});

describe('event bus', () => {
  it('keeps delivering when one listener throws', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('notify', () => {
      throw new Error('listener failure');
    });
    bus.on('notify', ({ text }) => seen.push(text));
    const quiet = console.error;
    console.error = () => undefined;
    bus.emit('notify', { text: 'hello' });
    console.error = quiet;
    expect(seen).toEqual(['hello']);
  });
});
