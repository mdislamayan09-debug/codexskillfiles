// Small, allocation-free math helpers shared by gameplay, rendering and the
// world generator. Keep this file dependency-free: it runs inside the worker.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * inverseLerp(inMin, inMax, value);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Frame-rate independent exponential approach: `damp(current, target, 8, dt)`. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(target, current, Math.exp(-lambda * dt));
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function length2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distanceSq2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Terraces a value into `steps` bands with a soft riser. */
export function terrace(value: number, steps: number, sharpness = 0.8): number {
  const scaled = value * steps;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  const riser = smoothstep(0.5 - sharpness * 0.5, 0.5 + sharpness * 0.5, frac);
  return (base + riser) / steps;
}

/** Distance from point to segment in 2D; writes param t (0..1) to out[0]. */
export function pointSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out?: Float32Array | number[],
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (out) out[0] = t;
  const cx = ax + abx * t - px;
  const cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

export function formatClock(hours: number): string {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
