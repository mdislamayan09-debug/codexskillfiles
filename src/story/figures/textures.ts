import * as THREE from 'three';
import { createRng, type Rng } from '../../core/rng';
import type { Person } from '../StoryData';
import { EYE_R, faceMasks, headBase, headTexelDirection, hairRegion } from './head';

// Everything a survivor wears on their surface, baked on a canvas once at
// boot: skin painted on the face's own anatomy (lips, brows, the blush of
// nose and cheeks, stubble, lines of age), irises, woven cloth, leather and
// hair. Each albedo comes with a normal map built from a height field.

/** Tileable value noise with a period of `period` cells. */
function tileNoise(rng: Rng, period: number): (x: number, y: number) => number {
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

function texture(width: number, height: number, data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(data, width, height), 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function normals(width: number, height: number, h: Float32Array, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const at = (x: number, y: number) => h[((y + height) % height) * width + ((x + width) % width)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      out[i] = (-dx / l) * 127.5 + 127.5;
      out[i + 1] = (dy / l) * 127.5 + 127.5;
      out[i + 2] = (1 / l) * 127.5 + 127.5;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** sRGB 0..255 channels of a hex colour. */
function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export interface Pair {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

/**
 * The head's skin (1024 × 512, the head sphere's own mapping). Painted from
 * the same anatomy the head is sculpted with.
 */
export function bakeSkin(p: Person, skin: number): Pair {
  const W = 1024;
  const H = 512;
  const rng = createRng(p.seed * 31 + 7);
  const fine = tileNoise(rng, 256);
  const mid = tileNoise(rng, 64);
  const broad = tileNoise(rng, 16);
  const albedo = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const [sr, sg, sb] = rgb(skin);
  const dark = sr + sg + sb < 330;
  const d = new THREE.Vector3();
  const b = new THREE.Vector3();
  const [hr, hg, hb] = rgb(p.hair.color);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const u = (x + 0.5) / W;
      const v = 1 - (y + 0.5) / H;
      headTexelDirection(u, v, d);
      headBase(d.x, d.y, d.z, p.face, b);
      const front = Math.min(1, Math.max(0, (d.z - 0.1) / 0.35));
      const m = front > 0 ? faceMasks(b.x, b.y, p) : null;
      // Skin: mottled a little, warmer where blood is near the surface.
      const f = fine(x * 0.5, y * 0.5);
      const mm = mid(x / 8, y / 8);
      const bb = broad(x / 32, y / 32);
      let r = sr * (0.95 + 0.08 * mm + 0.04 * (f - 0.5));
      let gg = sg * (0.95 + 0.07 * mm + 0.04 * (f - 0.5));
      let bl = sb * (0.95 + 0.06 * mm + 0.04 * (f - 0.5));
      let hgt = 0.5 + (f - 0.5) * 0.25 + (fine(x * 1.7 + 11, y * 1.7) - 0.5) * 0.18;
      if (m) {
        const k = front;
        // Blush on cheeks and nose; redness with weather.
        const blush = m.blush * (0.08 + 0.14 * p.weather) * k;
        // Deep skin warms rather than reddens: scale, don't subtract, so the
        // cheeks never go muddy.
        if (dark) {
          r *= 1 + blush * 0.22;
          gg *= 1 + blush * 0.04;
        } else {
          r += blush * 34;
          gg -= blush * 14;
          bl -= blush * 10;
        }
        // Lips: deeper and redder, a darker line where they meet.
        const lips = m.lips * k * 0.8;
        r = r * (1 - lips) + lips * (dark ? sr * 0.8 : sr * 0.9);
        gg = gg * (1 - lips) + lips * (dark ? sg * 0.7 : sg * 0.72);
        bl = bl * (1 - lips) + lips * (dark ? sb * 0.74 : sb * 0.76);
        const line = m.lipLine * k;
        r *= 1 - line * 0.45;
        gg *= 1 - line * 0.5;
        bl *= 1 - line * 0.5;
        // Nostrils, and a soft shade round the eyes.
        const nose = m.nostril * k;
        r *= 1 - nose * 0.7;
        gg *= 1 - nose * 0.72;
        bl *= 1 - nose * 0.72;
        const lid = m.lid * k * (dark ? 0.06 : 0.12);
        r *= 1 - lid * 0.5;
        gg *= 1 - lid * 0.9;
        bl *= 1 - lid * 0.6;
        // Lines of age: folds by the mouth, crow's feet.
        const age = Math.max(0, (p.age - 25) / 40);
        const fold = (m.fold * 0.12 + m.crow * 0.1 * (0.5 + 0.5 * Math.sin(b.y * 2400 + b.x * 900))) * age * k;
        r *= 1 - fold;
        gg *= 1 - fold;
        bl *= 1 - fold;
        hgt -= (m.fold * 0.35 + m.crow * 0.25 * Math.max(0, Math.sin(b.y * 2400 + b.x * 900))) * age * k;
        hgt -= m.lipLine * 0.4 * k;
        // Freckles and sun spots with weather.
        const speck = Math.max(0, fine(x * 2.3 + 5, y * 2.3 + 9) - 0.78) * 4 * p.weather * (0.3 + m.blush);
        r *= 1 - speck * 0.18;
        gg *= 1 - speck * 0.24;
        bl *= 1 - speck * 0.28;
        // Eyebrows: fine hairs slanting out from the nose.
        const browHair = m.brow * k * (0.55 + 0.45 * Math.max(0, Math.sin((b.x * 2.2 + b.y) * 2600 + f * 4)));
        const grey = p.hair.grey;
        const brr = hr * (1 - grey) + 150 * grey;
        const brg = hg * (1 - grey) + 146 * grey;
        const brb = hb * (1 - grey) + 140 * grey;
        const bw = Math.min(1, browHair * 1.25);
        r = r * (1 - bw) + brr * bw;
        gg = gg * (1 - bw) + brg * bw;
        bl = bl * (1 - bw) + brb * bw;
        hgt += browHair * 0.25;
        // Stubble or the shadow of a beard.
        if (p.beard > 0 || p.sex === 'm') {
          const s = m.beard * k * (p.sex === 'm' ? 0.35 + 0.65 * p.beard : 0) * Math.max(0, fine(x * 3.1, y * 3.1) - 0.35) * 1.5;
          r = r * (1 - s * 0.55) + hr * s * 0.55;
          gg = gg * (1 - s * 0.55) + hg * s * 0.55;
          bl = bl * (1 - s * 0.55) + hb * s * 0.55;
        }
        // Pores on the nose and cheeks.
        hgt -= Math.max(0, 0.72 - fine(x * 3.7 + 3, y * 3.7 + 1)) * 0.07 * (0.6 + 0.4 * m.blush);
      }
      // Where hair grows, the scalp shows darker under it.
      const scalp = hairRegion(d.x, d.y, d.z, p.hair.style);
      if (scalp > 0 && p.hair.style !== 'balding') {
        const s = scalp * 0.6;
        r = r * (1 - s) + hr * s;
        gg = gg * (1 - s) + hg * s;
        bl = bl * (1 - s) + hb * s;
      }
      void bb;
      const i = (y * W + x) * 4;
      albedo[i] = r;
      albedo[i + 1] = gg;
      albedo[i + 2] = bl;
      albedo[i + 3] = 255;
      height[y * W + x] = hgt;
    }
  }
  return { map: texture(W, H, albedo, true, false), normalMap: texture(W, H, normals(W, H, height, 1.6), false, false) };
}

/** An eye: iris round the pole of the ball, pupil, the dark limbal ring and wet sclera. */
export function bakeIris(color: number, seed: number): THREE.CanvasTexture {
  const S = 256;
  const rng = createRng(seed * 13 + 5);
  const fine = tileNoise(rng, 64);
  const data = new Uint8ClampedArray(S * S * 4);
  const [ir, ig, ib] = rgb(color);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const u = (x + 0.5) / S;
      const v = 1 - (y + 0.5) / S;
      // SphereGeometry v: 1 at the (forward) pole. Arc distance from it, in metres.
      const s = (1 - v) * Math.PI * EYE_R;
      const ang = u * Math.PI * 2;
      let r: number;
      let g: number;
      let b: number;
      if (s < 0.0021) {
        r = g = b = 6;
      } else if (s < 0.0059) {
        // Radial fibres, a paler ring round the pupil, darker at the rim.
        const t = (s - 0.0021) / 0.0038;
        const fib = 0.75 + 0.35 * fine(ang * 10, t * 6) + 0.15 * Math.sin(ang * 90 + fine(ang * 4, t * 3) * 6);
        const collar = Math.exp(-((t - 0.25) ** 2) / 0.01) * 0.35;
        const rim = Math.pow(t, 3) * 0.6;
        r = ir * (fib + collar) * (1 - rim);
        g = ig * (fib + collar) * (1 - rim);
        b = ib * (fib + collar) * (1 - rim);
      } else if (s < 0.0064) {
        const t = (s - 0.0059) / 0.0005;
        r = 40 + 170 * t;
        g = 36 + 160 * t;
        b = 34 + 150 * t;
      } else {
        // Sclera: not white, a little warm, veins toward the corners.
        const vein = Math.max(0, fine(ang * 20, s * 800) - 0.7) * 2 * Math.min(1, (s - 0.006) / 0.01);
        r = 222 - vein * 10;
        g = 212 - vein * 60;
        b = 202 - vein * 60;
      }
      const i = (y * S + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return texture(S, S, data, true, false);
}

export type Cloth = 'wool' | 'canvas' | 'waxed' | 'linen' | 'serge';

/** Woven cloth (512², tiling every 35 cm on the garments): weave, fibre, wear. */
export function bakeCloth(kind: Cloth, color: number, seed: number): Pair {
  const S = 512;
  const rng = createRng(seed * 17 + kind.length);
  const fine = tileNoise(rng, 128);
  const mid = tileNoise(rng, 32);
  const broad = tileNoise(rng, 8);
  const albedo = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S);
  const [cr, cg, cb] = rgb(color);
  // Threads per tile: a 35 cm tile of wool twill has fine threads.
  const threads = kind === 'canvas' ? 160 : kind === 'waxed' ? 220 : kind === 'linen' ? 140 : 256;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const tx = (x / S) * threads;
      const ty = (y / S) * threads;
      let weave: number;
      if (kind === 'wool' || kind === 'serge') {
        // Twill: diagonal ribs.
        weave = 0.5 + 0.5 * Math.sin((tx + ty) * Math.PI);
      } else {
        // Plain weave: over and under.
        const over = (Math.floor(tx) + Math.floor(ty)) % 2 === 0;
        const along = over ? Math.sin((tx % 1) * Math.PI) : Math.sin((ty % 1) * Math.PI);
        weave = 0.35 + 0.65 * along;
      }
      const f = fine(x, y);
      const mm = mid(x / 4, y / 4);
      const bb = broad(x / 16, y / 16);
      // Fuzz on wool, a sheen and creases on waxed cotton, fading on canvas.
      const fuzz = kind === 'wool' ? (f - 0.5) * 0.25 : (f - 0.5) * 0.12;
      const wear = Math.max(0, bb - 0.62) * (kind === 'canvas' ? 1.2 : kind === 'waxed' ? 0.9 : 0.5);
      const crease = kind === 'waxed' ? Math.max(0, Math.abs(mid(x / 3 + 7, y / 12) - 0.5) < 0.04 ? 0.6 : 0) : 0;
      const tone = 0.88 + 0.12 * weave + fuzz + 0.08 * (mm - 0.5) + wear * 0.35 + crease * 0.2;
      const i = (y * S + x) * 4;
      albedo[i] = Math.min(255, cr * tone + wear * 18);
      albedo[i + 1] = Math.min(255, cg * tone + wear * 16);
      albedo[i + 2] = Math.min(255, cb * tone + wear * 12);
      albedo[i + 3] = 255;
      height[y * S + x] = weave * 0.6 + f * 0.25 - crease * 0.4;
    }
  }
  const strength = kind === 'canvas' ? 2.4 : kind === 'waxed' ? 1.2 : 1.8;
  return { map: texture(S, S, albedo, true), normalMap: texture(S, S, normals(S, S, height, strength), false) };
}

/** Leather (256², tiling every 20 cm): grain, creases and scuffs. */
export function bakeLeather(color: number, seed: number): Pair {
  const S = 256;
  const rng = createRng(seed * 23 + 3);
  const fine = tileNoise(rng, 64);
  const mid = tileNoise(rng, 16);
  const albedo = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S);
  const [cr, cg, cb] = rgb(color);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const f = fine(x, y);
      const f2 = fine(x * 2 + 17, y * 2 + 3);
      const mm = mid(x / 4, y / 4);
      const crease = Math.abs(mid(x / 2 + 5, y / 6) - 0.5) < 0.025 ? 1 : 0;
      const scuff = Math.max(0, mm - 0.68) * 2.5;
      const tone = 0.85 + 0.15 * f + 0.1 * (mm - 0.5) - crease * 0.2 + scuff * 0.4;
      const i = (y * S + x) * 4;
      albedo[i] = Math.min(255, cr * tone + scuff * 20);
      albedo[i + 1] = Math.min(255, cg * tone + scuff * 16);
      albedo[i + 2] = Math.min(255, cb * tone + scuff * 12);
      albedo[i + 3] = 255;
      height[y * S + x] = f2 * 0.5 + f * 0.2 - crease * 0.5;
    }
  }
  return { map: texture(S, S, albedo, true), normalMap: texture(S, S, normals(S, S, height, 1.4), false) };
}

/** Hair (512², along the head sphere's meridians): strands, greys and coils. */
export function bakeHair(p: Person): Pair {
  const S = 512;
  const rng = createRng(p.seed * 41 + 9);
  const strand = tileNoise(rng, 256);
  const clump = tileNoise(rng, 32);
  const albedo = new Uint8ClampedArray(S * S * 4);
  const height = new Float32Array(S * S);
  const [cr, cg, cb] = rgb(p.hair.color);
  const coils = p.hair.style === 'coils';
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      let h: number;
      if (coils) {
        // Tight coils: a dense field of tiny rings.
        const cx = x / 3.2;
        const cy = y / 3.2;
        const ring = Math.abs(Math.sin(cx * 2.1 + Math.sin(cy * 1.7) * 1.3) * Math.sin(cy * 2.3 + Math.sin(cx * 1.9) * 1.2));
        h = 0.4 + 0.6 * ring * (0.7 + 0.3 * strand(x, y));
      } else {
        // Strands run along v; clumps sway a little.
        const sway = (clump(x / 8, y / 8) - 0.5) * 20;
        h = 0.5 + 0.5 * Math.sin((x + sway) * 1.3 + strand(x * 0.2, y) * 6) * (0.5 + 0.5 * strand(x, y * 0.1));
      }
      const greyHere = strand(x * 0.7 + 31, y * 0.05) > 1 - p.hair.grey * 0.7 ? 0.7 : 0;
      const tone = 0.78 + 0.3 * h;
      const i = (y * S + x) * 4;
      albedo[i] = cr * tone * (1 - greyHere) + (125 * tone + 10) * greyHere;
      albedo[i + 1] = cg * tone * (1 - greyHere) + (121 * tone + 10) * greyHere;
      albedo[i + 2] = cb * tone * (1 - greyHere) + (116 * tone + 10) * greyHere;
      albedo[i + 3] = 255;
      height[y * S + x] = h;
    }
  }
  return { map: texture(S, S, albedo, true), normalMap: texture(S, S, normals(S, S, height, coils ? 3 : 2.2), false) };
}
