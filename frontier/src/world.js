// World generation: heightfield, splat masks, roads, river and landmark layout.
import * as THREE from 'three';
import { Simplex2, smoothstep, lerp, clamp, mulberry32 } from './noise.js';

export const WORLD_SIZE = 4096;          // metres, square, centred on origin
export const HALF = WORLD_SIZE / 2;
export const RES = 1536;                 // heightmap samples per side
export const CELL = WORLD_SIZE / (RES - 1);
export const WATER_LEVEL = 0;

// --- Landmarks -------------------------------------------------------------
export const TOWN = { x: 0, z: 0, w: 300, d: 170, name: 'Copper Hollow' };
export const RANCH = { x: -150, z: 150 };
export const CHURCH = { x: 165, z: -60 };
export const CAMP = { x: 720, z: -420, name: 'Cutter Gang Hideout' };
export const LAKE = { x: -950, z: 760, r: 260 };
export const SWAMP = { x: 1250, z: 1050 };

// River: polyline from the northern mountains down through the Heartlands to the swamp.
export const RIVER = [
  [-700, -2000], [-620, -1500], [-520, -1150], [-420, -820], [-380, -560],
  [-430, -330], [-380, -120], [-260, 60], [-250, 300], [-150, 520], [40, 640],
  [320, 700], [560, 820], [760, 980], [980, 1120], [1250, 1150], [1600, 1300], [2100, 1500],
];
// Roads (centre lines).
export const ROADS = [
  // main east-west trail through town
  [[-2000, -80], [-1500, -40], [-1000, 60], [-600, 20], [-300, 0], [-160, 0], [160, 0], [420, -40], [700, -160], [1100, -200], [1500, -120], [2000, -60]],
  // north to the mountains
  [[60, 0], [80, -200], [40, -480], [120, -800], [60, -1150], [180, -1500]],
  // south to the ranch and swamp country
  [[-60, 0], [-80, 120], [-110, 260], [-40, 480], [120, 600], [300, 720], [560, 900], [900, 1060], [1200, 1100]],
  // spur to the lake
  [[-300, 0], [-480, 220], [-700, 480], [-860, 600]],
  // spur to the outlaw camp
  [[700, -160], [690, -300], [720, -400]],
];

function distToPolyline(px, pz, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    // cheap reject
    const minx = Math.min(ax, bx) - 200, maxx = Math.max(ax, bx) + 200;
    const minz = Math.min(az, bz) - 200, maxz = Math.max(az, bz) + 200;
    if (px < minx || px > maxx || pz < minz || pz > maxz) continue;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    const d = qx * qx + qz * qz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Smooth the polylines with Catmull-Rom so rivers and roads meander naturally.
function smoothPolyline(pts, steps = 8) {
  const v = pts.map((p) => new THREE.Vector3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  return curve.getPoints(pts.length * steps).map((p) => [p.x, p.z]);
}

export class World {
  constructor(seed = 1899) {
    this.seed = seed;
    this.n = new Simplex2(seed);
    this.n2 = new Simplex2(seed + 7);
    this.n3 = new Simplex2(seed + 13);
    this.river = smoothPolyline(RIVER, 10);
    this.roads = ROADS.map((r) => smoothPolyline(r, 8));
    this.heights = new Float32Array(RES * RES);
    this.splat = new Uint8Array(RES * RES * 4);
  }

  riverWidth(x, z) {
    return 16 + 10 * (0.5 + 0.5 * this.n2.noise(x / 400, z / 400)) + smoothstep(600, 1300, z) * 12;
  }

  // Raw height function (expensive, used only during generation).
  rawHeight(x, z, out) {
    const n = this.n, n2 = this.n2;
    // Rolling heartlands
    let h = 16 + 16 * n.fbm(x / 900, z / 900, 4) + 6 * n.fbm(x / 220 + 3.1, z / 220, 4) + 1.2 * n2.fbm(x / 50, z / 50, 3);
    // Foothills band
    const north = smoothstep(-500, -1300, z);
    const foot = smoothstep(-250, -800, z);
    h += foot * (40 * (0.5 + 0.5 * n.fbm(x / 400, z / 400, 4)));
    // Snow-capped range to the north (domain-warped ridges on a broad massif)
    const wx = x + 320 * n2.fbm(x / 1500, z / 1500, 3), wz = z + 320 * n2.fbm(x / 1500 + 5.3, z / 1500, 3);
    const ridge = n.ridged(wx / 1300 + 10, wz / 1300, 6);
    const massif = 0.55 + 0.45 * n.fbm(wx / 2600, wz / 2600, 3);
    h += north * (Math.pow(ridge, 1.5) * 430 * massif + 80 * massif + 45 * n2.fbm(x / 300, z / 300, 4));
    // erosion-like ridges and gullies on high, steep ground
    const hi = smoothstep(70, 260, h);
    if (hi > 0) {
      const g1 = n2.ridged(wx / 210 + 3.3, wz / 210 - 1.7, 4);
      const g2 = n.ridged(wx / 75 - 8.1, wz / 75 + 2.2, 3);
      h += hi * (g1 * 46 + g2 * 12 - 26);
    }
    // Enclosing ranges at the west and east edges
    const ex = Math.abs(x) / HALF, ez = Math.abs(z) / HALF;
    const edge = smoothstep(0.78, 0.98, Math.max(ex, z > 0 ? ez : 0));
    h += edge * (Math.pow(ridge, 1.5) * 300 + 90);
    // Swamp / bayou lowlands to the south east
    const sw = smoothstep(500, 900, x) * smoothstep(650, 1000, z) * (1 - edge);
    const swampH = 0.35 + 1.3 * n2.fbm(x / 90, z / 90, 4) + 0.5 * n.noise(x / 25, z / 25);
    h = lerp(h, swampH, sw);
    // Lake
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r + 0.25 * n2.noise(x / 160, z / 160);
    h = lerp(h, Math.min(h, -6 + ld * 7), smoothstep(1.35, 0.85, ld));
    // River valley + channel
    const rd = distToPolyline(x, z, this.river);
    const rw = this.riverWidth(x, z);
    const valley = smoothstep(rw * 7, rw * 1.2, rd);
    h = lerp(h, Math.min(h, 2.2 + rd * 0.06 + 3 * north), valley * (1 - north * 0.6));
    const chan = smoothstep(rw, rw * 0.35, rd);
    h = lerp(h, -2.8 + north * 6, chan);
    // Roads soften fine relief and must stay dry
    let roadD = 1e9;
    for (const r of this.roads) roadD = Math.min(roadD, distToPolyline(x, z, r));
    // Town plateau
    const tx = Math.abs(x - TOWN.x) / (TOWN.w * 0.5), tz = Math.abs(z - TOWN.z) / (TOWN.d * 0.5);
    const town = smoothstep(1.6, 0.9, Math.max(tx, tz));
    const townH = 14.5 + 0.6 * n2.noise(x / 60, z / 60);
    h = lerp(h, townH, town);
    // Ranch flat
    const rnd = smoothstep(130, 70, Math.hypot(x - RANCH.x, z - RANCH.z));
    h = lerp(h, 13.6 + 0.3 * n2.noise(x / 40, z / 40), rnd);
    // Church knoll
    const ck = smoothstep(70, 20, Math.hypot(x - CHURCH.x, z - CHURCH.z));
    h = lerp(h, 19, ck);
    // Outlaw camp clearing
    const cc = smoothstep(80, 30, Math.hypot(x - CAMP.x, z - CAMP.z));
    h = lerp(h, h * 0.4 + 30 * 0.6, cc);
    if (roadD < 14 && chan < 0.5) h = Math.max(h, 1.2);

    if (out) {
      out.road = smoothstep(5.5, 2.8, roadD + 1.5 * n2.noise(x / 9, z / 9));
      out.wet = Math.max(smoothstep(rw * 1.9, rw * 0.9, rd), sw * 0.8, smoothstep(1.25, 0.95, ld));
      out.town = Math.max(town, rnd * 0.8, cc);
      out.north = north;
      out.swamp = sw;
      out.roadD = roadD;
    }
    return h;
  }

  async generate(onProgress) {
    const o = {};
    const rows = RES;
    const forest = this.n3;
    for (let j = 0; j < rows; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < RES; i++) {
        const x = -HALF + i * CELL;
        const h = this.rawHeight(x, z, o);
        const k = j * RES + i;
        this.heights[k] = h;
        // forest density: patches, denser on foothills & swamp, none on roads/town/water
        let f = smoothstep(0.05, 0.45, forest.fbm(x / 520, z / 520, 4) + 0.35 * o.north + 0.45 * o.swamp);
        f *= 1 - o.town;
        f *= smoothstep(4, 14, o.roadD);
        f *= smoothstep(0.2, 1.4, h);
        this.splat[k * 4 + 0] = o.road * 255;
        this.splat[k * 4 + 1] = o.wet * 255;
        this.splat[k * 4 + 2] = f * 255;
        this.splat[k * 4 + 3] = o.town * 255;
      }
      if ((j & 63) === 0) {
        onProgress && onProgress(j / rows);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.smoothMountains();
    this.heightTex = new THREE.DataTexture(this.heights, RES, RES, THREE.RedFormat, THREE.FloatType);
    this.heightTex.needsUpdate = true;
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.splatTex = new THREE.DataTexture(this.splat, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.splatTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.generateMipmaps = true;
    this.splatTex.needsUpdate = true;
  }

  // Soften high-frequency faceting on steep high ground (cheap thermal-erosion stand-in).
  smoothMountains() {
    const H = this.heights, tmp = new Float32Array(H.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const k = j * RES + i, h = H[k];
        const m = smoothstep(45, 140, h);
        if (m <= 0 || i < 2 || j < 2 || i > RES - 3 || j > RES - 3) { tmp[k] = h; continue; }
        let sum = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) sum += H[k + dj * RES + di];
        tmp[k] = lerp(h, sum / 25, m * 0.8);
      }
      H.set(tmp);
    }
  }

  // Bilinear height sample — matches the GPU sampler exactly.
  heightAt(x, z) {
    const fx = clamp((x + HALF) / CELL, 0, RES - 1.001);
    const fz = clamp((z + HALF) / CELL, 0, RES - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * RES + i], b = H[j * RES + i + 1], c = H[(j + 1) * RES + i], d = H[(j + 1) * RES + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = CELL;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  splatAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, RES - 1);
    const j = clamp(Math.round((z + HALF) / CELL), 0, RES - 1);
    const k = (j * RES + i) * 4;
    return { road: this.splat[k] / 255, wet: this.splat[k + 1] / 255, forest: this.splat[k + 2] / 255, town: this.splat[k + 3] / 255 };
  }
  rng(seed) { return mulberry32(this.seed * 31 + seed); }
}
