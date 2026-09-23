// Particle-based hydraulic erosion (droplet model, after Hans Theobald Beyer's
// thesis and Sebastian Lague's implementation). Operates on a square grid of
// heights expressed in "erosion units" (meters / heightScale) so parameters
// stay in the well-behaved range of the reference implementation.

import { createRng } from '../../core/rng';

export interface ErosionOptions {
  size: number;
  droplets: number;
  seed: number;
  /** Meters per erosion unit. Larger = gentler erosion. */
  heightScale: number;
  inertia?: number;
  capacity?: number;
  minCapacity?: number;
  erodeSpeed?: number;
  depositSpeed?: number;
  evaporateSpeed?: number;
  gravity?: number;
  lifetime?: number;
  radius?: number;
  /** Droplets that start below this height (meters) are skipped. */
  minStartHeight?: number;
  /** Optional per-cell multiplier (0..1) for how erodible the ground is. */
  hardness?: Float32Array;
  onProgress?: (fraction: number) => void;
}

interface Brush {
  offsets: Int32Array;
  weights: Float32Array;
  dx: Int8Array;
  dy: Int8Array;
}

function buildBrush(radius: number, size: number): Brush {
  const offsets: number[] = [];
  const weights: number[] = [];
  const dxs: number[] = [];
  const dys: number[] = [];
  let sum = 0;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= radius) {
        const w = 1 - d / radius;
        offsets.push(y * size + x);
        weights.push(w);
        dxs.push(x);
        dys.push(y);
        sum += w;
      }
    }
  }
  return {
    offsets: Int32Array.from(offsets),
    weights: Float32Array.from(weights.map((w) => w / sum)),
    dx: Int8Array.from(dxs),
    dy: Int8Array.from(dys),
  };
}

/**
 * Erodes `heights` (meters) in place. Returns the number of simulated steps.
 */
export function erode(heights: Float32Array, options: ErosionOptions): number {
  const size = options.size;
  const scale = options.heightScale;
  const inertia = options.inertia ?? 0.05;
  const capacityFactor = options.capacity ?? 4;
  const minCapacity = options.minCapacity ?? 0.01;
  const erodeSpeed = options.erodeSpeed ?? 0.3;
  const depositSpeed = options.depositSpeed ?? 0.3;
  const evaporate = options.evaporateSpeed ?? 0.012;
  const gravity = options.gravity ?? 4;
  const lifetime = options.lifetime ?? 40;
  const radius = options.radius ?? 2;
  const minStart = (options.minStartHeight ?? 1) / scale;
  const hardness = options.hardness;
  const rng = createRng(options.seed);
  const brush = buildBrush(radius, size);

  // Work in erosion units.
  const map = new Float32Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) map[i] = heights[i] / scale;

  let steps = 0;
  const reportEvery = Math.max(1, Math.floor(options.droplets / 20));

  for (let drop = 0; drop < options.droplets; drop += 1) {
    if (options.onProgress && drop % reportEvery === 0) options.onProgress(drop / options.droplets);
    let posX = rng() * (size - 2) + 0.5;
    let posY = rng() * (size - 2) + 0.5;
    {
      const ix = posX | 0;
      const iy = posY | 0;
      if (map[iy * size + ix] < minStart) continue;
    }
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let life = 0; life < lifetime; life += 1) {
      steps += 1;
      const nodeX = posX | 0;
      const nodeY = posY | 0;
      const index = nodeY * size + nodeX;
      const cellX = posX - nodeX;
      const cellY = posY - nodeY;

      // Height and gradient via bilinear interpolation of the 4 corners.
      const hNW = map[index];
      const hNE = map[index + 1];
      const hSW = map[index + size];
      const hSE = map[index + size + 1];
      const gradX = (hNE - hNW) * (1 - cellY) + (hSE - hSW) * cellY;
      const gradY = (hSW - hNW) * (1 - cellX) + (hSE - hNE) * cellX;
      const height = hNW * (1 - cellX) * (1 - cellY) + hNE * cellX * (1 - cellY) + hSW * (1 - cellX) * cellY + hSE * cellX * cellY;

      dirX = dirX * inertia - gradX * (1 - inertia);
      dirY = dirY * inertia - gradY * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-9) break;
      dirX /= len;
      dirY /= len;
      posX += dirX;
      posY += dirY;

      if (posX < radius + 1 || posX >= size - radius - 2 || posY < radius + 1 || posY >= size - radius - 2) break;

      const nx = posX | 0;
      const ny = posY | 0;
      const ni = ny * size + nx;
      const ncx = posX - nx;
      const ncy = posY - ny;
      const newHeight =
        map[ni] * (1 - ncx) * (1 - ncy) +
        map[ni + 1] * ncx * (1 - ncy) +
        map[ni + size] * (1 - ncx) * ncy +
        map[ni + size + 1] * ncx * ncy;
      const deltaHeight = newHeight - height;

      // Stop droplets that reach the sea; deposit what they carry.
      const reachedSea = newHeight < 0;
      const capacity = Math.max(-deltaHeight * speed * water * capacityFactor, minCapacity);

      if (sediment > capacity || deltaHeight > 0 || reachedSea) {
        const amount = deltaHeight > 0 ? Math.min(deltaHeight, sediment) : (sediment - capacity) * depositSpeed;
        const deposit = reachedSea ? sediment * 0.5 : amount;
        sediment -= deposit;
        map[index] += deposit * (1 - cellX) * (1 - cellY);
        map[index + 1] += deposit * cellX * (1 - cellY);
        map[index + size] += deposit * (1 - cellX) * cellY;
        map[index + size + 1] += deposit * cellX * cellY;
        if (reachedSea) break;
      } else {
        const hard = hardness ? hardness[index] : 1;
        const amount = Math.min((capacity - sediment) * erodeSpeed * hard, -deltaHeight);
        const offsets = brush.offsets;
        const weights = brush.weights;
        for (let b = 0; b < offsets.length; b += 1) {
          const target = index + offsets[b];
          const removed = amount * weights[b];
          map[target] -= removed;
          sediment += removed;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + deltaHeight * gravity));
      water *= 1 - evaporate;
    }
  }

  for (let i = 0; i < heights.length; i += 1) heights[i] = map[i] * scale;
  options.onProgress?.(1);
  return steps;
}
