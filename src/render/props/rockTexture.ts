import * as THREE from 'three';
import { createRng } from '../../core/rng';

// Natural rock for cave walls: fractured into irregular plates by a
// Voronoi crack network, mottled with mineral staining and faint strata.
// Tileable; generated once and applied in world space (triplanar).

function tileNoise(rng: () => number, period: number): (x: number, y: number) => number {
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rng();
  const at = (i: number, j: number) => grid[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function toTexture(size: number, data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(data, size, size), 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export interface RockTexture {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

function rock(size: number, seed: number): RockTexture {
  const rng = createRng(seed);
  const fine = tileNoise(rng, size / 4);
  const mid = tileNoise(rng, size / 16);
  const broad = tileNoise(rng, size / 64);
  // Voronoi plates: one feature point per cell, wrapping.
  const G = 7;
  const pts = Array.from({ length: G * G }, () => [rng(), rng()]);
  const cellSize = size / G;
  const height = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Warp the lookup so plates have ragged edges.
      const wx = x + (mid(x / 8, y / 8) - 0.5) * 18;
      const wy = y + (mid(x / 8 + 31, y / 8 + 17) - 0.5) * 18;
      const cx = Math.floor(wx / cellSize);
      const cy = Math.floor(wy / cellSize);
      let d1 = 1e9;
      let d2 = 1e9;
      let id = 0;
      for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
          const gx = cx + i;
          const gy = cy + j;
          const k = (((gy % G) + G) % G) * G + (((gx % G) + G) % G);
          const px = (gx + pts[k][0]) * cellSize;
          const py = (gy + pts[k][1]) * cellSize;
          const d = Math.hypot(wx - px, wy - py);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = k;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1;
      const crack = Math.min(1, edge / 5);
      const plate = pts[id][0];
      const f = fine(x, y);
      const m = mid(x / 4, y / 4);
      const b = broad(x / 16, y / 16);
      // Plates are gently domed and tilted; cracks cut deep.
      const h = 0.35 + plate * 0.25 + (m - 0.5) * 0.3 + (f - 0.5) * 0.12 + Math.sin(y * 0.09 + b * 6) * 0.03;
      height[y * size + x] = h * (0.35 + 0.65 * crack * crack);
      const tone = (0.62 + plate * 0.22 + (m - 0.5) * 0.25 + (f - 0.5) * 0.1) * (0.55 + 0.45 * crack);
      const stain = Math.max(0, b - 0.55) * 1.6;
      const i = (y * size + x) * 4;
      albedo[i] = Math.min(255, 150 * tone + 40 * stain);
      albedo[i + 1] = Math.min(255, 144 * tone + 22 * stain);
      albedo[i + 2] = Math.min(255, 136 * tone + 8 * stain);
      albedo[i + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const hh = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (hh(x + 1, y) - hh(x - 1, y)) * 5;
      const dy = (hh(x, y + 1) - hh(x, y - 1)) * 5;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / len) * 127.5 + 127.5;
      normal[i + 1] = (dy / len) * 127.5 + 127.5;
      normal[i + 2] = (1 / len) * 127.5 + 127.5;
      normal[i + 3] = 255;
    }
  }
  return { map: toTexture(size, albedo, true), normalMap: toTexture(size, normal, false) };
}

let shared: RockTexture | null = null;

export function getRockTexture(): RockTexture {
  shared ??= rock(512, 0xc0ffee);
  return shared;
}
