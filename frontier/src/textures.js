// Procedural canvas textures: foliage cards, bark, planks, shingles, signage.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

// Deciduous leaf cluster card (alpha)
export function leafCardTexture(seed = 1, hue = 85) {
  const [c, g] = canvas(512, 512);
  const r = mulberry32(seed);
  g.clearRect(0, 0, 512, 512);
  // irregular sub-clusters joined by twigs
  // many small sprays with sky between them: a lacy silhouette instead of a solid blob
  const clusters = [];
  const n = 14 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 30 + Math.pow(r(), 0.8) * 190;
    clusters.push([256 + Math.cos(a) * d, 250 + Math.sin(a) * d * 0.85, 22 + r() * 30]);
  }
  g.strokeStyle = 'rgba(58,44,30,1)'; g.lineCap = 'round';
  for (const [x, y] of clusters) {
    g.lineWidth = 3 + r() * 3;
    g.beginPath(); g.moveTo(256 + (r() - 0.5) * 40, 500);
    g.quadraticCurveTo(256 + (x - 256) * 0.3, 380, x, y); g.stroke();
  }
  for (const [cx, cy, cr] of clusters) {
    const count = Math.floor(cr * cr * 0.11);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, rad = Math.pow(r(), 0.55) * cr;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad * 0.85;
      const top = 1 - (y - (cy - cr)) / (2 * cr); // lighter on top (sky lit)
      const l = 14 + top * 20 + (rad / cr) * 8 + r() * 10;
      g.fillStyle = hsl(hue + (r() - 0.5) * 22, 24 + r() * 18, l * 0.85);
      // a pointed leaf with a darker midrib, hanging from the spray at its own angle
      const L = 7 + r() * 6, Wd = 2.6 + r() * 2;
      g.save(); g.translate(x, y); g.rotate(a + (r() - 0.5) * 1.2);
      g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -Wd * 1.6, L, 0); g.quadraticCurveTo(0, Wd * 1.6, -L, 0); g.fill();
      g.strokeStyle = 'rgba(30,26,14,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-L * 0.8, 0); g.lineTo(L * 0.8, 0); g.stroke();
      g.restore();
    }
  }
  return tex(c);
}

// Pine branch card (alpha), drawn as a frond of needles
export function pineCardTexture(seed = 3) {
  const [c, g] = canvas(512, 256);
  const r = mulberry32(seed);
  g.clearRect(0, 0, 512, 256);
  const frond = (x0, y0, len, ang, w) => {
    g.strokeStyle = 'rgba(70,52,34,1)';
    g.lineWidth = w;
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const n = Math.floor(len / 3);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const nl = (1 - t * 0.6) * 26 * (0.7 + r() * 0.5);
      for (const s of [-1, 1]) {
        const na = ang + s * (0.9 + r() * 0.4);
        g.strokeStyle = hsl(96 + r() * 26, 26 + r() * 14, 11 + r() * 14);
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl + 6); g.stroke();
      }
    }
  };
  frond(10, 128, 480, 0, 5);
  for (let i = 0; i < 9; i++) frond(60 + i * 45, 128, 120 - i * 8, (r() > 0.5 ? 1 : -1) * (0.5 + r() * 0.4), 2.5);
  return tex(c);
}

// Bark (tileable), returns { map, normal-ish via bumps baked into colour }
export function barkTexture(seed = 5, base = [70, 58, 46]) {
  const [c, g] = canvas(256, 512);
  const r = mulberry32(seed);
  g.fillStyle = `rgb(${base})`;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 260; i++) {
    const x = r() * 256, w = 2 + r() * 10;
    const l = -30 + r() * 50;
    g.fillStyle = `rgba(${base[0] + l},${base[1] + l},${base[2] + l},0.55)`;
    g.fillRect(x, 0, w, 512);
  }
  for (let i = 0; i < 120; i++) {
    g.fillStyle = 'rgba(20,15,10,0.5)';
    const x = r() * 256, y = r() * 512;
    g.fillRect(x, y, 1 + r() * 2, 20 + r() * 60);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(90,110,60,${0.12 + r() * 0.2})`; // moss
    g.beginPath(); g.ellipse(r() * 256, 380 + r() * 132, 10 + r() * 30, 8 + r() * 20, 0, 0, 7); g.fill();
  }
  return tex(c, { repeat: true });
}

// Conifer bark: irregular vertical plates split by deep furrows (stretched Voronoi), scaly plate tops, lichen.
// Returns { map, normalMap } from one height field so light catches the plate edges.
export function conBarkTextures(seed = 9, base = [92, 70, 56], W = 512, H = 1024) {
  const r = mulberry32(seed);
  // jittered cell sites on a wrapped grid, cells tall and narrow like ponderosa/spruce plates
  const CX = 7, CY = 3, sites = [];
  for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) sites.push([(i + 0.15 + r() * 0.7) / CX, (j + 0.15 + r() * 0.7) / CY, r()]);
  const hgt = new Float32Array(W * H), tone = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let d1 = 9, d2 = 9, id = 0;
    const gi = Math.floor(u * CX), gj = Math.floor(v * CY);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = gi + di, jj = gj + dj, wi = (ii + CX) % CX, wj = (jj + CY) % CY;
      const [sx0, sy0, t] = sites[wj * CX + wi];
      const sx = sx0 + Math.floor(ii / CX), sy = sy0 + Math.floor(jj / CY);   // unwrap across the tile edge
      const dx = u - sx, dy = (v - sy) * 0.32;                              // squash vertically: tall plates
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; id = t; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;                                         // 0 on furrows
    // long vertical fissures wander down the plates as well
    const fis = Math.abs(Math.sin(u * Math.PI * 2 * 11 + Math.sin(v * 9 + id * 6) * 1.6 + id * 4));
    const plate = Math.min(1, edge * 30) * (0.55 + 0.45 * Math.min(1, fis * 3));
    const k = y * W + x;
    // scaly flakes on the plate surface
    const flake = 0.5 + 0.5 * Math.sin(y * 0.9 + Math.sin(x * 0.35 + id * 30) * 2.5) * Math.sin(x * 0.6 + id * 11);
    hgt[k] = plate * plate * (0.8 + 0.2 * flake) + 0.04 * r();
    tone[k] = id;
  }
  const [c, g] = canvas(W, H), img = g.createImageData(W, H), d = img.data;
  for (let k = 0; k < W * H; k++) {
    const h = hgt[k], t = tone[k];
    const lit = 0.32 + 0.85 * h;
    const warm = 0.9 + 0.25 * t;                                  // plates vary from grey-brown to rusty
    let R = base[0] * lit * warm * 1.08, G = base[1] * lit * (0.95 + 0.1 * t), B = base[2] * lit * 0.95;
    if (h < 0.15) { R = 26 + 20 * h; G = 18 + 14 * h; B = 13 + 10 * h; }   // deep furrow shadow
    d[k * 4] = R; d[k * 4 + 1] = G; d[k * 4 + 2] = B; d[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // lichen and moss patches, more toward the bottom (north side is implied by tiling)
  for (let i = 0; i < 70; i++) {
    const y = H * (0.45 + 0.55 * r());
    g.fillStyle = r() < 0.6 ? `rgba(120,132,96,${0.1 + r() * 0.18})` : `rgba(160,168,140,${0.08 + r() * 0.12})`;
    g.beginPath(); g.ellipse(r() * W, y, 6 + r() * 26, 4 + r() * 16, r(), 0, 7); g.fill();
  }
  const [cn, gn] = canvas(W, H), ni = gn.createImageData(W, H), nd = ni.data;
  const Hs = (x, y) => hgt[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (Hs(x + 1, y) - Hs(x - 1, y)) * 3.2, dy = (Hs(x, y + 1) - Hs(x, y - 1)) * 3.2;
    const n = Math.hypot(dx, dy, 1), k = (y * W + x) * 4;
    nd[k] = (-dx / n * 0.5 + 0.5) * 255; nd[k + 1] = (dy / n * 0.5 + 0.5) * 255; nd[k + 2] = (1 / n * 0.5 + 0.5) * 255; nd[k + 3] = 255;
  }
  gn.putImageData(ni, 0, 0);
  return { map: tex(c, { repeat: true }), normalMap: tex(cn, { srgb: false, repeat: true }) };
}

// Weathered clapboard siding: long horizontal boards, soft grain, lap shadows, optional peeling paint.
export function plankTexture(seed = 7, paint = null, vertical = false) {
  const [c, g] = canvas(512, 512);
  const r = mulberry32(seed);
  const boards = 16;
  const bw = 512 / boards;
  for (let b = 0; b < boards; b++) {
    const tone = -10 + r() * 16;
    // weathered grey-brown timber
    const wood = [104 + tone, 92 + tone, 76 + tone * 0.8];
    g.fillStyle = `rgb(${wood})`;
    g.fillRect(0, b * bw, 512, bw);
    // long soft grain: low-contrast sinuous lines spanning the whole board
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '60,48,36' : '150,136,112'},${0.08 + r() * 0.08})`;
      g.lineWidth = 0.6 + r() * 1.0;
      const y = b * bw + 3 + r() * (bw - 6), ph = r() * 6, amp = 0.6 + r() * 1.2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x * 0.011 + ph) * amp);
      g.stroke();
    }
    if (paint) {
      g.fillStyle = `rgba(${paint},0.86)`;
      g.fillRect(0, b * bw + 1, 512, bw - 2);
      // peeling: long thin flakes along the grain
      for (let k = 0; k < 11; k++) {
        g.fillStyle = `rgba(${wood},${0.22 + r() * 0.38})`;
        const x = r() * 512, y = b * bw + 2 + r() * (bw - 4);
        g.beginPath(); g.ellipse(x, y, 6 + r() * 34, 0.8 + r() * 1.8, 0, 0, 7); g.fill();
      }
    }
    // lap shadow under each board + highlight on its lower lip
    const lg = g.createLinearGradient(0, b * bw, 0, b * bw + 7);
    lg.addColorStop(0, 'rgba(12,8,5,0.7)'); lg.addColorStop(1, 'rgba(12,8,5,0)');
    g.fillStyle = lg; g.fillRect(0, b * bw, 512, 7);
    g.fillStyle = 'rgba(255,240,210,0.07)'; g.fillRect(0, b * bw + bw - 2, 512, 2);
  }
  // grime: darker toward the bottom of the tile and a few rain streaks from nail lines
  const wg = g.createLinearGradient(0, 0, 0, 512);
  wg.addColorStop(0, 'rgba(20,14,8,0)'); wg.addColorStop(1, 'rgba(20,14,8,0.16)');
  g.fillStyle = wg; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6; i++) {
    const x = r() * 512;
    const sg = g.createLinearGradient(x, 0, x, 512);
    sg.addColorStop(0, 'rgba(30,22,14,0.10)'); sg.addColorStop(1, 'rgba(30,22,14,0)');
    g.fillStyle = sg; g.fillRect(x, 0, 3 + r() * 4, 512);
  }
  const t = tex(c, { repeat: true });
  if (vertical) { t.rotation = Math.PI / 2; t.center.set(0.5, 0.5); }
  return t;
}

export function shingleTexture(seed = 9, base = [92, 78, 64]) {
  const [c, g] = canvas(512, 512);
  const r = mulberry32(seed);
  g.fillStyle = `rgb(${base.map((v) => v * 0.5)})`;
  g.fillRect(0, 0, 512, 512);
  const rows = 16, rh = 512 / rows;
  for (let y = 0; y < rows; y++) {
    let x = (y % 2) * -16;
    while (x < 512) {
      const w = 22 + r() * 22;
      const l = -22 + r() * 30;
      g.fillStyle = `rgb(${base[0] + l},${base[1] + l},${base[2] + l})`;
      g.fillRect(x + 1, y * rh, w - 2, rh + 4);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 1, y * rh + rh, w - 2, 3);
      if (r() < 0.1) { g.fillStyle = 'rgba(80,95,50,0.35)'; g.fillRect(x, y * rh, w, rh); }
      x += w;
    }
  }
  return tex(c, { repeat: true });
}

export function tinTexture(seed = 11) {
  const [c, g] = canvas(512, 512);
  const r = mulberry32(seed);
  const RIDGES = 24, P = 512 / RIDGES;
  // galvanised sheet with corrugation shading
  for (let x = 0; x < 512; x++) {
    const v = 118 + Math.sin((x / 512) * Math.PI * 2 * RIDGES) * 26;
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(x, 0, 1, 512);
  }
  // broad, soft oxidation
  for (let i = 0; i < 36; i++) {
    const x = r() * 512, y = r() * 512, rad = 40 + r() * 110;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${104 + r() * 30},${66 + r() * 16},40,${0.06 + r() * 0.14})`);
    gr.addColorStop(1, 'rgba(104,66,40,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // rust runs: bleed from the fastener rows and follow the valleys down the sheet
  for (const y0 of [26, 282]) for (let k = 0; k < RIDGES; k++) {
    const x = (k + 0.75) * P + (r() - 0.5) * 2;
    g.fillStyle = 'rgba(58,40,28,0.85)';
    g.beginPath(); g.arc(x, y0, 2.4, 0, 7); g.fill();
    if (r() < 0.4) continue;
    const len = 24 + r() * r() * 230, w = 3 + r() * 6;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(${128 + r() * 30},${60 + r() * 22},28,${0.5 + r() * 0.35})`);
    gr.addColorStop(0.35, `rgba(${120 + r() * 24},${58 + r() * 16},28,${0.25 + r() * 0.2})`);
    gr.addColorStop(1, 'rgba(118,60,30,0)');
    g.fillStyle = gr; g.fillRect(x - w / 2, y0, w, len);
  }
  // sheet overlaps
  for (const sx of [0, 171, 342]) { g.fillStyle = 'rgba(40,32,26,0.35)'; g.fillRect(sx, 0, 3, 512); }
  return tex(c, { repeat: true });
}

// Hand-painted western sign
export function signTexture(text, { bg = '#2b1d12', fg = '#e8d6a8', w = 1024, h = 192, font = 'Rye', border = true } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const r = mulberry32(text.length * 77);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.04})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 60, 1 + r() * 3);
  }
  if (border) { g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28); }
  g.fillStyle = fg;
  let size = Math.floor(h * 0.55);
  g.font = `${size}px "${font}", Georgia, serif`;
  while (g.measureText(text).width > w * 0.86 && size > 10) { size -= 2; g.font = `${size}px "${font}", Georgia, serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + size * 0.06);
  // wear
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(30,20,12,${r() * 0.5})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 14, 1 + r() * 3);
  }
  return tex(c);
}

// Six-over-six sash window: dark wavy glass, muntins, a curtain, dust in the corners.
const WIN_FRAMES = (g, col) => {
  g.fillStyle = col;
  g.fillRect(0, 0, 128, 9); g.fillRect(0, 247, 128, 9); g.fillRect(0, 0, 9, 256); g.fillRect(119, 0, 9, 256);
  g.fillRect(0, 122, 128, 12); // meeting rail between the sashes
  for (const x of [44, 80]) g.fillRect(x, 0, 4, 256);
  for (const y of [64, 188]) g.fillRect(0, y, 128, 4);
};
export function windowTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#16130f'; g.fillRect(0, 0, 128, 256);
  // old glass: faint uneven tint per pane, darker toward the room
  const r = mulberry32(5);
  for (let i = 0; i < 12; i++) {
    const px = 9 + (i % 3) * 37, py = 9 + Math.floor(i / 3) * 61;
    const gr = g.createLinearGradient(px, py, px + 30, py + 55);
    gr.addColorStop(0, `rgba(${70 + r() * 30},${76 + r() * 30},${74 + r() * 26},0.35)`);
    gr.addColorStop(1, 'rgba(20,22,22,0.1)');
    g.fillStyle = gr; g.fillRect(px, py, 35, 55);
  }
  // curtain behind the lower sash
  g.fillStyle = 'rgba(120,92,66,0.5)'; g.fillRect(9, 134, 26, 113); g.fillRect(96, 134, 23, 113);
  WIN_FRAMES(g, '#4a3a2a');
  // grime in the pane corners
  g.fillStyle = 'rgba(90,80,60,0.18)';
  for (let i = 0; i < 40; i++) g.fillRect(9 + r() * 110, 9 + r() * 238, 2 + r() * 6, 2 + r() * 6);
  return tex(c);
}
// roughness (green channel): glossy glass, matte painted frames
export function windowRoughTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = 'rgb(0,22,0)'; g.fillRect(0, 0, 128, 256);
  WIN_FRAMES(g, 'rgb(0,220,0)');
  return tex(c, { srgb: false });
}

export function grassBladeTexture() {
  const [c, g] = canvas(64, 256);
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, '#2e3a18'); gr.addColorStop(0.6, '#6d7a36'); gr.addColorStop(1, '#b0a560');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  return tex(c);
}

// Painted noise for horse/animal coats
export function coatTexture(kind = 'bay', seed = 1) {
  const [c, g] = canvas(512, 256);
  const r = mulberry32(seed);
  const pal = {
    bay: ['#5a3420', '#4a2a18', '#2b1a10'],
    pinto: ['#3a2418', '#2e1c12', '#1c120c'],
    grey: ['#8e8a84', '#6e6a66', '#4e4a46'],
    black: ['#1e1a18', '#141210', '#0a0908'],
    chestnut: ['#8a4a26', '#723a1c', '#4a2410'],
    deer: ['#8a6a48', '#6e5238', '#4a3624'],
    sheep: ['#d8d0c0', '#c6bca8', '#a89c88'],
    cow: ['#5a3a26', '#3e281a', '#2a1a10'],
  }[kind] || ['#5a3420', '#4a2a18', '#2b1a10'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = pal[1 + (r() < 0.3 ? 1 : 0)] + '30';
    g.fillRect(r() * 512, r() * 256, 1 + r() * 3, 6 + r() * 20);
  }
  if (kind === 'pinto') {
    g.fillStyle = '#ece6dc';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      const x = r() * 512, y = 130 + r() * 110;
      const pts = [];
      for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; const rr = 18 + r() * 38; pts.push([x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr]); }
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k <= pts.length; k++) { const p = pts[k % pts.length], q = pts[(k + 1) % pts.length]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
      g.fill();
    }
  }
  return tex(c);
}

export function noiseTexture(size = 256, seed = 1) {
  const [c, g] = canvas(size, size);
  const d = g.createImageData(size, size);
  const r = mulberry32(seed);
  for (let i = 0; i < size * size; i++) {
    const v = r() * 255;
    d.data[i * 4] = v; d.data[i * 4 + 1] = r() * 255; d.data[i * 4 + 2] = r() * 255; d.data[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}
