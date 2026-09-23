// Seeded 2D simplex noise plus the fractal helpers the world generator uses.
// Based on Stefan Gustavson's public-domain simplex reference, rewritten to be
// allocation-free. Identical results in the worker and on the main thread.

import { createRng } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD_X = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GRAD_Y = new Float32Array([0, 0, 0, 0, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

export class Simplex2 {
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    const rng = createRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) p[i] = i;
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i += 1) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Simplex noise in roughly [-1, 1]. */
  noise(xin: number, yin: number): number {
    const perm = this.perm;
    const permMod12 = this.permMod12;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi = permMod12[ii + perm[jj]];
      t0 *= t0;
      n0 = t0 * t0 * (GRAD_X[gi] * x0 + GRAD_Y[gi] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi = permMod12[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * (GRAD_X[gi] * x1 + GRAD_Y[gi] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi = permMod12[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * (GRAD_X[gi] * x2 + GRAD_Y[gi] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal Brownian motion, normalized to roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += amplitude * this.noise(x * frequency + o * 17.13, y * frequency - o * 9.71);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1]: sharp crests, used for mountain ranges. */
  ridged(x: number, y: number, octaves: number, lacunarity = 2.05, gain = 0.52): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o += 1) {
      let n = 1 - Math.abs(this.noise(x * frequency + o * 31.7, y * frequency + o * 7.3));
      n *= n;
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += n * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Billow noise in [0, 1]: rounded hills. */
  billow(x: number, y: number, octaves: number): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += amplitude * Math.abs(this.noise(x * frequency + o * 5.1, y * frequency + o * 3.3));
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}
