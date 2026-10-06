// Photographic CC0 surface library (see public/textures/CREDITS.md).
// Ground surfaces are packed into two texture arrays (albedo, normal) so the terrain shader spends two texture
// units on every biome's ground instead of one per scan.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const NAMES = ['grass', 'dirt', 'rock', 'snow', 'gravel', 'planks', 'riverbed', 'wood', 'stone', 'sand'];
// terrain array layers (order is mirrored by the L_* defines in terrain.js)
export const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'snow', 'riverbed', 'gravel', 'sand', 'litter', 'needles'];
const TS = 512;

// Forest-floor litter: pine needles, cones, broad leaves and twigs over dark soil (neutral colour; the shader
// tints it per biome). Returns albedo and a height map for the normal.
function litterCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = TS;
  const g = c.getContext('2d');
  const r = mulberry32(4242);
  g.fillStyle = '#3a2c20'; g.fillRect(0, 0, TS, TS);
  // soil mottling
  for (let i = 0; i < 260; i++) {
    const x = r() * TS, y = r() * TS, rad = 6 + r() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = 40 + r() * 30;
    gr.addColorStop(0, `rgba(${v + 14},${v},${v - 14},0.5)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const wrap = (fn) => { for (const ox of [-TS, 0, TS]) for (const oy of [-TS, 0, TS]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // broad leaves
  for (let i = 0; i < 520; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28, L = 7 + r() * 9, W = L * (0.35 + r() * 0.2);
    const v = 0.6 + r() * 0.6;
    const col = `rgb(${Math.round(150 * v)},${Math.round(104 * v)},${Math.round(60 * v)})`;
    wrap(() => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(1.5, 1.5, L, W, 0, 0, 7); g.fill();
      g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(40,26,14,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
      g.restore();
    });
  }
  // pine needles
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28, L = 5 + r() * 10, v = 0.55 + r() * 0.6;
    g.strokeStyle = `rgba(${Math.round(160 * v)},${Math.round(100 * v)},${Math.round(52 * v)},0.9)`;
    g.lineWidth = 0.9 + r() * 0.6;
    wrap(() => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); });
  }
  // twigs and cones
  for (let i = 0; i < 46; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28, L = 20 + r() * 60;
    g.strokeStyle = `rgb(${70 + r() * 30},${52 + r() * 20},${36})`; g.lineWidth = 2 + r() * 3;
    wrap(() => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); });
  }
  for (let i = 0; i < 24; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28;
    wrap(() => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(2, 2, 11, 6, 0, 0, 7); g.fill();
      for (let k = 0; k < 7; k++) { g.fillStyle = k % 2 ? '#5a3a22' : '#7a5232'; g.beginPath(); g.ellipse(-8 + k * 2.6, 0, 3, 5.5 - Math.abs(k - 3) * 0.6, 0, 0, 7); g.fill(); }
      g.restore();
    });
  }
  return c;
}

// the pine woods' floor: a dry duff of fallen needles over dusty soil, with cones, twig ends and grit, no broad
// leaves (the broadleaf litter read as rust-brown leaf dots under ponderosa)
function needleCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = TS;
  const g = c.getContext('2d');
  const r = mulberry32(5151);
  g.fillStyle = '#6a5843'; g.fillRect(0, 0, TS, TS);
  const wrap = (fn) => { for (const ox of [-TS, 0, TS]) for (const oy of [-TS, 0, TS]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // soil showing through in patches, and darker damp hollows
  for (let i = 0; i < 220; i++) {
    const x = r() * TS, y = r() * TS, rad = 10 + r() * 40, dark = r() < 0.4;
    wrap(() => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, dark ? 'rgba(52,40,28,0.45)' : 'rgba(150,128,96,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  }
  g.lineCap = 'round';
  // needles in layers: old grey-brown underneath, fresher tan and rust on top
  for (let pass = 0; pass < 3; pass++) {
    // (the tile spans 1.6 m: ponderosa needles 10-20 cm long)
    const n = pass === 0 ? 2200 : pass === 1 ? 1600 : 700;
    for (let i = 0; i < n; i++) {
      const x = r() * TS, y = r() * TS, a = r() * 6.28, L = 26 + r() * 40, v = 0.6 + r() * 0.55;
      const col = pass === 0 ? [118, 100, 80] : pass === 1 ? [150, 120, 82] : [168, 112, 62];
      g.strokeStyle = `rgba(${Math.round(col[0] * v)},${Math.round(col[1] * v)},${Math.round(col[2] * v)},${pass === 0 ? 0.8 : 0.92})`;
      g.lineWidth = 1.3 + r() * 0.9;
      // pine needles fall in pairs and threes, splayed from a sheath
      wrap(() => { for (let k = 0; k < 2 + (r() < 0.4 ? 1 : 0); k++) { const b = a + (k - 1) * 0.12; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); g.stroke(); } });
    }
  }
  // grit and small stones
  for (let i = 0; i < 160; i++) {
    const x = r() * TS, y = r() * TS, rad = 1 + r() * 3, v = 90 + r() * 70;
    wrap(() => { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + 1, y + 1, rad, rad * 0.8, 0, 0, 7); g.fill(); g.fillStyle = `rgb(${v},${v - 6},${v - 14})`; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, 0, 0, 7); g.fill(); });
  }
  // twig ends and bark flakes
  for (let i = 0; i < 40; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28, L = 16 + r() * 50;
    g.strokeStyle = `rgb(${66 + r() * 30},${50 + r() * 20},${36})`; g.lineWidth = 1.6 + r() * 2.4;
    wrap(() => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); });
  }
  for (let i = 0; i < 30; i++) {
    const x = r() * TS, y = r() * TS, a = r() * 6.28, w = 4 + r() * 8;
    wrap(() => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${104 + r() * 30},${70 + r() * 16},${44})`; g.fillRect(-w, -w * 0.4, w * 2, w * 0.8); g.restore(); });
  }
  return c;
}

function pixels(img) {
  const c = document.createElement('canvas'); c.width = c.height = TS;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, TS, TS);
  return g.getImageData(0, 0, TS, TS).data;
}
// tangent-space normal from a canvas's luminance (for the procedural litter)
function normalFromHeight(px, strength = 2.2) {
  const out = new Uint8ClampedArray(TS * TS * 4);
  const L = (x, y) => { const k = (((y + TS) % TS) * TS + ((x + TS) % TS)) * 4; return (px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11) / 255; };
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength, dy = (L(x, y + 1) - L(x, y - 1)) * strength;
    const n = Math.hypot(dx, dy, 1);
    const k = (y * TS + x) * 4;
    out[k] = (-dx / n * 0.5 + 0.5) * 255; out[k + 1] = (dy / n * 0.5 + 0.5) * 255; out[k + 2] = (1 / n * 0.5 + 0.5) * 255; out[k + 3] = 255;
  }
  return out;
}

export async function loadSurfaces(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const load = (url, srgb) => new Promise((res) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(16, aniso);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      res(t);
    }, undefined, () => res(null));
  });
  const out = {};
  await Promise.all(NAMES.flatMap((n) => [
    load(`./textures/${n}-albedo.jpg`, true).then((t) => (out[n] = t)),
    load(`./textures/${n}-normal.jpg`, false).then((t) => (out[n + 'N'] = t)),
  ]));
  out.water = await load('./textures/waternormals.jpg', false);
  // fall back to a flat 1×1 texture so shaders still compile if a file is missing
  const flat = (rgb) => { const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.needsUpdate = true; return t; };
  for (const n of NAMES) { out[n] = out[n] || flat([128, 128, 128]); out[n + 'N'] = out[n + 'N'] || flat([128, 128, 255]); }
  out.water = out.water || flat([128, 128, 255]);

  // terrain texture arrays
  const nL = TERRAIN_LAYERS.length;
  const alb = new Uint8Array(TS * TS * 4 * nL), nrm = new Uint8Array(TS * TS * 4 * nL);
  TERRAIN_LAYERS.forEach((name, l) => {
    let a, b;
    if (name === 'litter') { const c = litterCanvas(); a = pixels(c); b = normalFromHeight(a); }
    else if (name === 'needles') { const c = needleCanvas(); a = pixels(c); b = normalFromHeight(a, 1.6); }
    else {
      a = out[name]?.image ? pixels(out[name].image) : new Uint8ClampedArray(TS * TS * 4).fill(128);
      b = out[name + 'N']?.image ? pixels(out[name + 'N'].image) : null;
      if (!b) { b = new Uint8ClampedArray(TS * TS * 4); for (let k = 0; k < b.length; k += 4) { b[k] = 128; b[k + 1] = 128; b[k + 2] = 255; b[k + 3] = 255; } }
    }
    alb.set(a, l * TS * TS * 4); nrm.set(b, l * TS * TS * 4);
  });
  const arr = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, TS, TS, nL);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = Math.min(8, aniso);
    t.needsUpdate = true;
    return t;
  };
  out.terrainAlb = arr(alb, true);
  out.terrainNrm = arr(nrm, false);
  return out;
}
