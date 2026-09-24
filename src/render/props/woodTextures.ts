import * as THREE from 'three';
import { createRng } from '../../core/rng';

// Procedural timber for everything the survivor builds: sawn planks with
// grain, knots, seams and gaps, and overlapping roof shingles. Albedo and a
// normal map derived from the same height field, generated once at boot.

export interface WoodTextures {
  planks: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
  shingles: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
}

function valueNoise(rng: () => number, size: number): (x: number, y: number) => number {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rng();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => grid[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function toTextures(size: number, albedo: Uint8ClampedArray<ArrayBuffer>, height: Float32Array, strength: number): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const make = (data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const normal = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / len * 0.5 + 0.5) * 255;
      normal[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return { map: make(albedo, true), normalMap: make(normal, false) };
}

/** Sawn planks running along V: grain streaks, knots, end seams and gaps. */
function planks(size: number, seed: number): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const rng = createRng(seed);
  const noise = valueNoise(rng, 64);
  const count = 8;
  const pw = size / count;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const planksInfo = Array.from({ length: count }, () => ({
    tone: 0.82 + rng() * 0.3,
    warm: rng() * 0.12,
    seams: [rng() * size, rng() < 0.5 ? rng() * size : -1],
    knot: rng() < 0.6 ? { x: 0.25 + rng() * 0.5, y: rng() * size, r: 4 + rng() * 7 } : null,
    offset: rng() * 100,
  }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const p = Math.floor(x / pw);
      const info = planksInfo[p];
      const u = (x % pw) / pw;
      // Grain: long wavy streaks along the plank.
      let gx = u * 22 + noise(x * 0.03 + info.offset, y * 0.006) * 5 + noise(x * 0.12, y * 0.02 + info.offset) * 1.2;
      let knotDark = 0;
      if (info.knot) {
        const kx = (x - (p + info.knot.x) * pw) / info.knot.r;
        let ky = (y - info.knot.y) / (info.knot.r * 1.6);
        if (ky > size / 2 / (info.knot.r * 1.6)) ky -= size / (info.knot.r * 1.6);
        if (ky < -size / 2 / (info.knot.r * 1.6)) ky += size / (info.knot.r * 1.6);
        const d = Math.hypot(kx, ky);
        // Grain swirls around the knot.
        gx += 3 / (1 + d * d);
        knotDark = Math.max(0, 1 - d) ** 0.6;
      }
      const grain = 0.5 + 0.5 * Math.sin(gx * Math.PI * 2);
      const fine = noise(x * 0.5, y * 0.08 + info.offset);
      let shade = info.tone * (0.78 + 0.16 * grain + 0.1 * fine) * (1 - knotDark * 0.55);
      let h = 0.6 + 0.08 * grain + 0.05 * fine - knotDark * 0.1;
      // Gaps between planks and end seams.
      const edge = Math.min(u, 1 - u) * pw;
      if (edge < 1.6) {
        shade *= 0.35 + 0.3 * (edge / 1.6);
        h = 0.1 + 0.3 * (edge / 1.6);
      } else if (edge < 3) h -= 0.08;
      for (const s of info.seams) {
        if (s < 0) continue;
        const ds = Math.abs(y - s);
        if (ds < 1.2) {
          shade *= 0.45;
          h = 0.2;
        }
      }
      const i = (y * size + x) * 4;
      const weather = noise(x * 0.02, y * 0.02) * 0.14;
      albedo[i] = Math.min(255, 255 * shade * (0.56 + info.warm - weather * 0.3));
      albedo[i + 1] = Math.min(255, 255 * shade * (0.42 + info.warm * 0.5 - weather * 0.2));
      albedo[i + 2] = Math.min(255, 255 * shade * (0.3 - weather * 0.1));
      albedo[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  return toTextures(size, albedo, height, 5);
}

/** Overlapping split-wood shingles in staggered rows. */
function shingles(size: number, seed: number): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const rng = createRng(seed);
  const noise = valueNoise(rng, 64);
  const rows = 8;
  const rh = size / rows;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const rowCuts = Array.from({ length: rows }, (_, r) => {
    const cuts: number[] = [];
    let x = (r % 2) * 20 + rng() * 10;
    while (x < size) {
      cuts.push(x);
      x += 34 + rng() * 30;
    }
    return cuts;
  });
  for (let y = 0; y < size; y += 1) {
    const r = Math.floor(y / rh);
    const v = (y % rh) / rh;
    const cuts = rowCuts[r];
    for (let x = 0; x < size; x += 1) {
      let k = 0;
      while (k + 1 < cuts.length && cuts[k + 1] <= x) k += 1;
      const tone = 0.7 + ((Math.sin(k * 12.9898 + r * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.35;
      const dCut = Math.min(Math.abs(x - cuts[k]), k + 1 < cuts.length ? Math.abs(cuts[k + 1] - x) : 99);
      const grain = 0.5 + 0.5 * Math.sin((x * 0.9 + noise(x * 0.05, y * 0.3) * 6) * 0.9);
      // Each shingle is thicker at its lower (exposed) edge and shadowed by the row above.
      let h = 0.3 + v * 0.6 + grain * 0.04;
      let shade = tone * (0.72 + 0.14 * grain + 0.14 * noise(x * 0.2, y * 0.2)) * (0.55 + 0.45 * Math.min(1, v * 3));
      if (dCut < 1.5) {
        shade *= 0.4;
        h -= 0.2;
      }
      if (v > 0.94) {
        shade *= 0.5;
        h = 0.95;
      }
      const moss = Math.max(0, noise(x * 0.015 + 9, y * 0.015) - 0.62) * 2.2;
      const i = (y * size + x) * 4;
      albedo[i] = Math.min(255, 255 * shade * (0.42 - moss * 0.18));
      albedo[i + 1] = Math.min(255, 255 * shade * (0.34 + moss * 0.1));
      albedo[i + 2] = Math.min(255, 255 * shade * (0.27 - moss * 0.08));
      albedo[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  return toTextures(size, albedo, height, 6);
}

export function createWoodTextures(size = 512): WoodTextures {
  return { planks: planks(size, 0x91a7e), shingles: shingles(size, 0x5a1e) };
}

let shared: WoodTextures | null = null;

/** The shared timber textures (made once, on first use). */
export function getWoodTextures(): WoodTextures {
  shared ??= createWoodTextures(512);
  return shared;
}
