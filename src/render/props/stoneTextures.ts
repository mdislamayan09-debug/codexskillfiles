import * as THREE from 'three';
import { createRng } from '../../core/rng';
import { addPatch, replaceOnce } from '../materials/MaterialPatches';

// Dressed stone for the island's ruins, generated once at boot: ashlar
// courses with mortar joints, bevelled and chipped edges, grime settling on
// the lower lip of each block and patches of lichen. The texture is applied
// in world space (triplanar), so any block, arch or column gets stone at the
// right scale without UVs, and it never stretches along a long lintel.

export interface StoneTextures {
  masonry: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
}

/** Tileable value noise with a period of `period` cells. */
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

function canvasTexture(size: number, data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean): THREE.CanvasTexture {
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
}

function normalsFrom(size: number, height: Float32Array, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = (-dx / len) * 127.5 + 127.5;
      out[i + 1] = (dy / len) * 127.5 + 127.5;
      out[i + 2] = (1 / len) * 127.5 + 127.5;
      out[i + 3] = 255;
    }
  }
  return out;
}

interface Block {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  tone: number;
  hue: number;
  bulge: number;
}

/** Ashlar courses of dressed blocks; tiles in both directions. */
function masonry(size: number, seed: number): StoneTextures['masonry'] {
  const rng = createRng(seed);
  const n1 = tileNoise(rng, size / 4);
  const n2 = tileNoise(rng, size / 16);
  const n3 = tileNoise(rng, size / 64);
  // Courses: heights that sum to the texture.
  const courseCount = 5;
  const raw = Array.from({ length: courseCount }, () => 0.8 + rng() * 0.45);
  const total = raw.reduce((a, b) => a + b, 0);
  const blocks: Block[][] = [];
  const rows: [number, number][] = [];
  let y = 0;
  for (let c = 0; c < courseCount; c += 1) {
    const h = (raw[c] / total) * size;
    rows.push([y, y + h]);
    // Blocks along the course, wrapping at the edge.
    const widths: number[] = [];
    let w = 0;
    while (w < size) {
      const bw = h * (1.1 + rng() * 1.3);
      widths.push(bw);
      w += bw;
    }
    const scale = size / w;
    const offset = rng() * size;
    let x = offset;
    const row: Block[] = [];
    for (const bw of widths) {
      const width = bw * scale;
      row.push({ x0: x, x1: x + width, y0: y, y1: y + h, tone: 0.84 + rng() * 0.26, hue: (rng() - 0.5) * 0.08, bulge: rng() });
      x += width;
    }
    blocks.push(row);
    y += h;
  }
  const albedo = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const mortar = 3.2;
  const bevel = 7;
  for (let py = 0; py < size; py += 1) {
    let c = 0;
    while (c < courseCount - 1 && py >= rows[c][1]) c += 1;
    const row = blocks[c];
    for (let px = 0; px < size; px += 1) {
      // The block under this texel (blocks may wrap past the right edge).
      let b = row[0];
      for (const blk of row) {
        const u = ((px - blk.x0) % size + size) % size;
        if (u < blk.x1 - blk.x0) {
          b = blk;
          break;
        }
      }
      const u = (((px - b.x0) % size) + size) % size;
      const width = b.x1 - b.x0;
      const v = py - b.y0;
      const hgt = b.y1 - b.y0;
      // Distance inside the block from its nearest edge (rounded corners).
      const ex = Math.min(u, width - u);
      const ey = Math.min(v, hgt - v);
      const r = 5;
      const qx = Math.max(0, r - ex);
      const qy = Math.max(0, r - ey);
      const inside = Math.min(ex, ey) >= r ? Math.min(ex, ey) : r - Math.hypot(qx, qy);
      // Chipped arrises: the edge wanders with noise.
      const chip = (n1(px * 0.5, py * 0.5) - 0.5) * 5 + (n2(px * 0.25, py * 0.25) - 0.5) * 3;
      const d = inside - mortar + chip * 0.6;
      const fine = n1(px, py) * 0.5 + n1(px * 0.5 + 17, py * 0.5 + 31) * 0.5;
      const mottle = n2(px * 0.25, py * 0.25);
      const broad = n3(px / 16, py / 16);
      const i = (py * size + px) * 4;
      if (d <= 0) {
        // Mortar: recessed, pale and gritty.
        height[py * size + px] = 0.05 + fine * 0.05;
        const m = 0.6 + fine * 0.12 + broad * 0.06;
        albedo[i] = 170 * m + 20;
        albedo[i + 1] = 162 * m + 18;
        albedo[i + 2] = 146 * m + 15;
      } else {
        const edge = Math.min(1, d / bevel);
        const face = edge * edge * (3 - 2 * edge);
        // A dressed face with a gentle bulge and tooled grain.
        const cx = u / width - 0.5;
        const cy = v / hgt - 0.5;
        const bulge = (1 - (cx * cx + cy * cy) * 1.6) * 0.08 * b.bulge;
        height[py * size + px] = 0.3 + face * 0.55 + bulge + (fine - 0.5) * 0.12 + (mottle - 0.5) * 0.08;
        // Colour: per-block tone, mottling, grime on the lower lip, pale wear on the arrises.
        let tone = b.tone * (0.86 + mottle * 0.22 + (fine - 0.5) * 0.1);
        const grime = Math.max(0, 1 - (hgt - v) / (hgt * 0.35)) * 0.16;
        tone *= 1 - grime;
        tone += (1 - face) * 0.08;
        const lichen = Math.max(0, (broad - 0.62) * 3.2) * Math.max(0, mottle - 0.35);
        const rr = 180 * tone * (1 + b.hue);
        const gg = 172 * tone;
        const bb = 156 * tone * (1 - b.hue);
        albedo[i] = rr * (1 - lichen) + 128 * lichen;
        albedo[i + 1] = gg * (1 - lichen) + 138 * lichen;
        albedo[i + 2] = bb * (1 - lichen) + 96 * lichen;
      }
      albedo[i + 3] = 255;
    }
  }
  return { map: canvasTexture(size, albedo, true), normalMap: canvasTexture(size, normalsFrom(size, height, 4.5), false) };
}

let shared: StoneTextures | null = null;

/** The shared stone textures (made once, on first use). */
export function getStoneTextures(): StoneTextures {
  shared ??= { masonry: masonry(512, 0x57011e) };
  return shared;
}

const TRI_VERTEX_PARS = /* glsl */ `
varying vec3 vTpPos;
varying vec3 vTpNormal;
`;

const TRI_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec4 tpWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    tpWorld = instanceMatrix * tpWorld;
  #endif
  tpWorld = modelMatrix * tpWorld;
  vTpPos = tpWorld.xyz;
  vTpNormal = normalize(mat3(modelMatrix) * objectNormal);
}
`;

const TRI_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTpMap;
uniform sampler2D uTpNormal;
uniform float uTpScale;
uniform float uTpNormalScale;
varying vec3 vTpPos;
varying vec3 vTpNormal;
`;

const TRI_MAP = /* glsl */ `
#include <map_fragment>
vec3 tpN = normalize(vTpNormal);
vec3 tpB = pow(abs(tpN), vec3(6.0));
tpB /= max(1e-4, tpB.x + tpB.y + tpB.z);
vec2 tpUvX = vTpPos.zy * uTpScale;
vec2 tpUvY = vTpPos.xz * uTpScale + vec2(0.37, 0.61);
vec2 tpUvZ = vTpPos.xy * uTpScale;
vec3 tpAlbedo = texture2D(uTpMap, tpUvX).rgb * tpB.x + texture2D(uTpMap, tpUvY).rgb * tpB.y + texture2D(uTpMap, tpUvZ).rgb * tpB.z;
diffuseColor.rgb *= tpAlbedo * 1.35;
`;

// Whiteout-blended triplanar normals, then back into view space.
const TRI_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 tnX = texture2D(uTpNormal, tpUvX).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D(uTpNormal, tpUvY).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D(uTpNormal, tpUvZ).xyz * 2.0 - 1.0;
  tnX.xy *= uTpNormalScale;
  tnY.xy *= uTpNormalScale;
  tnZ.xy *= uTpNormalScale;
  vec3 nX = vec3(tnX.xy + tpN.zy, abs(tnX.z) * tpN.x);
  vec3 nY = vec3(tnY.xy + tpN.xz, abs(tnY.z) * tpN.y);
  vec3 nZ = vec3(tnZ.xy + tpN.xy, abs(tnZ.z) * tpN.z);
  vec3 tpWorldN = normalize(nX.zyx * tpB.x + nY.xzy * tpB.y + nZ.xyz * tpB.z);
  normal = normalize((viewMatrix * vec4(tpWorldN, 0.0)).xyz);
}
`;

/**
 * Give a material world-space (triplanar) albedo and normal detail from
 * `tex`, tiling every `meters`.
 */
export function applyTriplanar(material: THREE.MeshStandardMaterial, tex: { map: THREE.Texture; normalMap: THREE.Texture }, meters: number, normalScale = 1): void {
  const uniforms = {
    uTpMap: { value: tex.map },
    uTpNormal: { value: tex.normalMap },
    uTpScale: { value: 1 / meters },
    uTpNormalScale: { value: normalScale },
  };
  addPatch(material, {
    key: `triplanar-${meters}-${normalScale}`,
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${TRI_VERTEX_PARS}`, 'tri-vpars');
      shader.vertexShader = replaceOnce(shader.vertexShader, '#include <project_vertex>', TRI_VERTEX, 'tri-vertex');
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <common>', `#include <common>\n${TRI_FRAGMENT_PARS}`, 'tri-fpars');
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <map_fragment>', TRI_MAP, 'tri-map');
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <normal_fragment_maps>', TRI_NORMAL, 'tri-normal');
    },
  });
}
