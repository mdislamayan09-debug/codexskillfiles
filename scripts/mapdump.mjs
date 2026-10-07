// Shaded-relief map of a window of the world, for scouting shot locations.
// usage: node scripts/mapdump.mjs <url> <out.png> x0 z0 x1 z1 [px per side = 1000] [marks json: [[x,z,label],...]]
import { launch } from './launch.mjs';
import fs from 'node:fs';
const [url, out, x0, z0, x1, z1, px = '1000', marks = '[]'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
const data = await page.evaluate(([x0, z0, x1, z1, W, marks]) => {
  const { world } = window.__game.dbg;
  const H = Math.round(W * (z1 - z0) / (x1 - x0));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data, sx = (x1 - x0) / W, sz = (z1 - z0) / H;
  let lo = 1e9, hi = -1e9;
  const hs = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const h = world.heightAt(x0 + i * sx, z0 + j * sz); hs[j * W + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h); }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = hs[j * W + i], hx = hs[j * W + Math.min(W - 1, i + 1)] - hs[j * W + Math.max(0, i - 1)], hz = hs[Math.min(H - 1, j + 1) * W + i] - hs[Math.max(0, j - 1) * W + i];
    const nx = -hx / (2 * sx), nz = -hz / (2 * sz), nl = Math.hypot(nx, 1, nz);
    const lit = Math.max(0, (nx * -0.6 + 0.6 + nz * -0.5) / nl);
    const t = (h - lo) / (hi - lo);
    let r = 60 + 150 * t, gg = 80 + 130 * t, b = 70 + 150 * t;
    const s = world.splatAt(x0 + i * sx, z0 + j * sz);
    if (s.forest > 0.4) { r *= 0.6; gg *= 0.85; b *= 0.6; }
    if (s.wet > 0.4) { r = 40; gg = 110; b = 255; }
    if (s.road > 0.4) { r = 255; gg = 60; b = 40; }
    const sl = 1 - 1 / nl;
    if (sl > 0.45) { r = r * 0.6 + 80; gg *= 0.55; b *= 0.55; }   // cliffs (steeper than ~57 deg) in red-brown
    const k = 0.35 + 0.9 * lit;
    const q = (j * W + i) * 4; d[q] = Math.min(255, r * k); d[q + 1] = Math.min(255, gg * k); d[q + 2] = Math.min(255, b * k); d[q + 3] = 255;
    if (Math.floor(h / 50) !== Math.floor(hs[j * W + Math.max(0, i - 1)] / 50) || Math.floor(h / 50) !== Math.floor(hs[Math.max(0, j - 1) * W + i] / 50)) { d[q] *= 0.6; d[q + 1] *= 0.6; d[q + 2] *= 0.6; }
  }
  g.putImageData(img, 0, 0);
  g.font = '14px sans-serif'; g.fillStyle = '#ff0'; g.strokeStyle = '#000';
  for (let x = Math.ceil(x0 / 500) * 500; x < x1; x += 500) { g.fillText(String(x), (x - x0) / sx + 2, 12); g.fillRect((x - x0) / sx, 0, 1, 8); }
  for (let z = Math.ceil(z0 / 500) * 500; z < z1; z += 500) { g.fillText(String(z), 2, (z - z0) / sz - 2); g.fillRect(0, (z - z0) / sz, 8, 1); }
  for (const [x, z, label] of marks) { g.fillStyle = '#f0f'; g.beginPath(); g.arc((x - x0) / sx, (z - z0) / sz, 5, 0, 7); g.fill(); g.fillText(label || '', (x - x0) / sx + 7, (z - z0) / sz + 4); }
  return { url: c.toDataURL('image/png'), lo, hi };
}, [+x0, +z0, +x1, +z1, +px, JSON.parse(marks)]);
fs.writeFileSync(out, Buffer.from(data.url.split(',')[1], 'base64'));
console.log('height range', Math.round(data.lo), Math.round(data.hi));
await browser.close();
