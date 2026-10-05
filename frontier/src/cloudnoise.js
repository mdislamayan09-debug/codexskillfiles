// Tileable 3D cloud noise for the raymarched sky (R: Perlin-Worley shape, G: Worley detail).
// Plain JS with no imports so it can be generated once at load.

function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// value noise on a periodic lattice
function valueNoise(x, y, z, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const m = (v) => ((v % period) + period) % period;
  const c = (dx, dy, dz) => hash3(m(xi + dx), m(yi + dy), m(zi + dz), seed);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy),
    l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy), uz);
}

// inverted Worley (1 at feature points) on a periodic grid of `cells` cells
function worley(x, y, z, cells, seed) {
  const px = x * cells, py = y * cells, pz = z * cells;
  const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
    const fx = cx + hash3(wx, wy, wz, seed) - px;
    const fy = cy + hash3(wx, wy, wz, seed + 1) - py;
    const fz = cz + hash3(wx, wy, wz, seed + 2) - pz;
    const d = fx * fx + fy * fy + fz * fz;
    if (d < best) best = d;
  }
  return 1 - Math.min(Math.sqrt(best), 1);
}

export function makeCloudNoise(N = 64) {
  const M = N * N * N;
  const ch = [new Float32Array(M), new Float32Array(M), new Float32Array(M)];
  let i = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
    const u = x / N, v = y / N, w = z / N;
    // billowy low-frequency value fbm
    let f = 0, a = 0.5, fr = 4;
    for (let o = 0; o < 4; o++) { f += a * valueNoise(u * fr, v * fr, w * fr, fr, 11 + o); a *= 0.5; fr *= 2; }
    f /= 0.9375;
    const wf = worley(u, v, w, 4, 3) * 0.625 + worley(u, v, w, 8, 7) * 0.25 + worley(u, v, w, 16, 9) * 0.125;
    ch[0][i] = f * 0.55 + wf * 0.45; // Perlin-Worley: soft fbm shaped into cauliflower billows
    ch[1][i] = worley(u, v, w, 8, 21) * 0.6 + worley(u, v, w, 16, 23) * 0.3 + worley(u, v, w, 32, 25) * 0.1;
    ch[2][i] = f;
  }
  // stretch each channel to the full 0..1 range (1st..99.5th percentile) so coverage maps predictably
  const out = new Uint8Array(M * 4);
  ch.forEach((c, k) => {
    const sorted = Float32Array.from(c).sort();
    const lo = sorted[Math.floor(M * 0.01)], hi = sorted[Math.floor(M * 0.995)];
    for (let j = 0; j < M; j++) out[j * 4 + k] = Math.round(Math.max(0, Math.min(1, (c[j] - lo) / (hi - lo))) * 255);
  });
  for (let j = 0; j < M; j++) out[j * 4 + 3] = 255;
  return out;
}
