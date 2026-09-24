import { describe, expect, it } from 'vitest';
import { eclipseAt, eclipseOnDay, showerOnNight } from '../../src/world/SkyEvents';

describe('sky events', () => {
  it('bring showers on some nights, never the first', () => {
    expect(showerOnNight(1)).toBe(false);
    const nights = Array.from({ length: 200 }, (_, i) => i + 2).filter(showerOnNight).length;
    expect(nights).toBeGreaterThan(20);
    expect(nights).toBeLessThan(70);
  });

  it('are the same every time for the same day', () => {
    for (let d = 2; d < 40; d += 1) expect(showerOnNight(d)).toBe(showerOnNight(d));
  });

  it('eclipse rarely, around the early afternoon', () => {
    const days = Array.from({ length: 300 }, (_, i) => i + 3).filter(eclipseOnDay);
    expect(days.length).toBeGreaterThan(5);
    expect(days.length).toBeLessThan(45);
    const d = days[0];
    expect(eclipseAt(d, 10)).toBe(0);
    expect(eclipseAt(d, 13.9)).toBeGreaterThan(0.9);
    expect(eclipseAt(d, 15)).toBe(0);
    expect(eclipseAt(1, 13.9)).toBe(0);
    expect(eclipseAt(1, 13.9, true)).toBeGreaterThan(0.9);
  });
});
