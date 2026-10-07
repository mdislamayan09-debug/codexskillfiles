// World generation: heightfield, splat and climate masks, roads, rivers and landmark layout.
// The map is 8 km on a side and holds every climate (see WORLD_PLAN.md): snowy peaks and a glacial valley in
// the north, a pine belt on the foothills, the Heartlands in the middle, autumn hills to the west, a desert of
// red mesas to the south-west, the bayou and a jungle coast to the south and east, and the ocean beyond.
import * as THREE from 'three';
import { Simplex2, smoothstep, lerp, clamp, mulberry32 } from './noise.js';

export const WORLD_SIZE = 8192;          // metres, square, centred on origin
export const HALF = WORLD_SIZE / 2;
export let RES = 2560;                   // heightmap samples per side (set per quality before generating)
export let CELL = WORLD_SIZE / (RES - 1);
export const WATER_LEVEL = 0;
export function setWorldResolution(res) { RES = res; CELL = WORLD_SIZE / (res - 1); }

// --- Landmarks -------------------------------------------------------------
export const TOWN = { x: 0, z: 0, w: 300, d: 170, name: 'Copper Hollow' };
export const RANCH = { x: -150, z: 150 };
export const CHURCH = { x: 165, z: -60 };
export const CAMP = { x: 720, z: -420, name: 'Cutter Gang Hideout' };
export const LAKE = { x: -950, z: 760, r: 260 };
export const SWAMP = { x: 1250, z: 1050 };
export const CABIN = { x: -470, z: -2700, name: "Trapper's Cabin" };

// Region centres for the map and region banners.
export const REGIONS = [
  { name: 'Grizzly Peaks', x: -600, z: -3300 },
  { name: 'Big Pines', x: 200, z: -1450 },
  { name: 'Heartlands', x: 0, z: 300 },
  { name: 'Ember Hills', x: -2700, z: -300 },
  { name: 'East Prairie', x: 2800, z: -200 },
  { name: 'Bayou Noir', x: 1500, z: 1350 },
  { name: 'Sundown Mesa', x: -2600, z: 2300 },
  { name: 'Palmetto Coast', x: 900, z: 2800 },
];

// Frostwater Valley: a glacial U-valley in the snowy range, running down to the river gorge.
export const FROST_VALLEY = [[-1500, -3950], [-1280, -3560], [-1040, -3160], [-870, -2800], [-770, -2500], [-720, -2250]]; // (replaced by the real valley floor)
const FROST_FLOOR = [345, 305, 266, 228, 190, 150]; // floor height at each valley point: a gentle glacial grade
// the valley opens out as it descends: a tight glacial trough at the head, a broad forested floor at the mouth.
// Valley distances are divided by this, so every profile below is written for the narrow head.
export const valleyWiden = (t) => 1 + 1.3 * smoothstep(0.1, 0.85, t);

// River: from the gorge below Frostwater Valley through the pines and the Heartlands, the bayou, to the sea.
export const RIVER = [
  [-720, -2200], [-700, -2000], [-620, -1500], [-520, -1150], [-420, -820], [-380, -560],
  [-430, -330], [-380, -120], [-260, 60], [-250, 300], [-150, 520], [40, 640],
  [320, 700], [560, 820], [760, 980], [980, 1120], [1250, 1150], [1600, 1300], [2100, 1500],
  [2500, 1800], [2750, 2200], [2950, 2620], [3350, 2900], [3800, 3220], [4300, 3520],
];
// Roads (centre lines).
export const ROADS = [
  // main east-west trail through town, out to the autumn hills and the prairie
  [[-3400, -420], [-2700, -230], [-2000, -80], [-1500, -40], [-1000, 60], [-600, 20], [-300, 0], [-160, 0], [160, 0], [420, -40], [700, -160], [1100, -200], [1500, -120], [2000, -60], [2700, -130], [3350, -330]],
  // north through the pines and up to the trapper's cabin
  [[60, 0], [80, -200], [40, -480], [120, -800], [60, -1150], [180, -1500], [100, -1850], [-110, -2150], [-320, -2450], [CABIN.x, CABIN.z]],
  // south to the ranch, the bayou and the jungle coast
  [[-60, 0], [-80, 120], [-110, 260], [-40, 480], [120, 600], [300, 720], [560, 900], [900, 1060], [1200, 1100], [1150, 1500], [900, 1950], [650, 2450], [520, 2950], [470, 3330]],
  // spur to the lake, then south-west into the desert
  [[-300, 0], [-480, 220], [-700, 480], [-860, 600], [-1250, 1050], [-1800, 1600], [-2350, 2150], [-2700, 2480]],
  // spur to the outlaw camp
  [[700, -160], [690, -300], [720, -400]],
  // logging trail east through the pines
  [[60, -1150], [330, -1240], [640, -1300], [980, -1420], [1350, -1500]],
];
export const PINE_TRAIL = 5; // index of the logging trail in ROADS
// width multiplier per road: distances are scaled by this before the road mask and clearing, so a value of 2.6
// turns a wagon road into a narrow foot-and-hoof trail
const ROAD_SCALE = [1, 1, 1, 1, 1.15, 1.8];

// --- Real ground -------------------------------------------------------------
// The snowy north is a real place: a window of Kawuneeche Valley in Colorado's Rocky Mountain National Park
// (USGS 3DEP elevation via AWS Terrain Tiles), baked by scripts/bake_dem.py into public/terrain at 0.55x
// horizontal and 0.75x vertical scale. Real erosion carves the ridges, cirques, talus fans and the broad glacial
// floor that noise can only imitate. The generated world takes over at the patch edges.
export let REAL = null; // { meta, h: Float32Array }
// further real ground laid over whole regions: [{ meta, h, region: 'desert' | 'jungle' }]
export let PATCHES = [];
export function setRealTerrain(real, patches = null) {
  if (patches) {
    PATCHES = patches;
    // the canyon's creek follows the real valley floor: the lowest ground down each column, smoothed
    for (const p of PATCHES) if (p.region === 'canyon' && !p.creek) {
      const m = p.meta, zs = [];
      for (let i = 0; i < m.w; i++) {
        let best = 1e9, bj = 0;
        for (let j = 0; j < m.h; j++) { const v = p.h[j * m.w + i]; if (v < best) { best = v; bj = j; } }
        zs.push(m.z0 + bj * m.cell);
      }
      const sm = zs.map((_, i) => { let a = 0, n = 0; for (let k = -12; k <= 12; k++) { const q = zs[Math.min(zs.length - 1, Math.max(0, i + k))]; a += q; n++; } return a / n; });
      p.creek = { x0: m.x0, cell: m.cell, z: Float32Array.from(sm) };
    }
  }
  REAL = real;
  if (!real) return;
  const m = real.meta;
  // the valley, its floor, the cabin, the road up to it and the head of the river all follow the real ground
  FROST_VALLEY.length = 0; for (const v of m.valley) FROST_VALLEY.push([v[0], v[1]]);
  FROST_FLOOR.length = 0; for (const v of m.valley) FROST_FLOOR.push(v[2]);
  CABIN.x = m.cabin[0]; CABIN.z = m.cabin[1];
  const vx = (z) => {
    const V = m.valley;
    for (let i = 0; i < V.length - 1; i++) if (z >= V[i][1] && z <= V[i + 1][1]) return lerp(V[i][0], V[i + 1][0], (z - V[i][1]) / (V[i + 1][1] - V[i][1]));
    return z < V[0][1] ? V[0][0] : V[V.length - 1][0];
  };
  RIVER[0] = [vx(-1850), -1850]; RIVER[1] = [vx(-1620), -1620];
  const side = CABIN.x > vx(CABIN.z) ? 1 : -1;
  const road = ROADS[1];
  road.length = 0;
  road.push([60, 0], [80, -200], [40, -480], [120, -800], [60, -1150], [-260, -1420]);
  for (let z = -1680; z > CABIN.z + 90; z -= 230) road.push([vx(z) + side * 75, z]);
  road.push([CABIN.x, CABIN.z]);
}
// Fetch and decode a baked heightmap (RGB PNG: R*256+G in 0.1 m steps).
async function loadPatch(base) {
  const meta = await (await fetch(base + '.json')).json();
  const blob = await (await fetch(base + '.png')).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const h = new Float32Array(meta.w * meta.h);
  for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) * meta.step - meta.offset;
  return { meta, h };
}
// The north (Kawuneeche Valley), the desert (Monument Valley) and the jungle coast (Na Pali, Kauai) are real
// ground; anything that fails to load falls back to generated terrain.
export async function loadRealTerrain() {
  const [north, ...rest] = await Promise.all([
    loadPatch('terrain/kawuneeche').catch((e) => (console.warn('north terrain unavailable', e), null)),
    loadPatch('terrain/desert').then((p) => ({ ...p, region: 'desert' })).catch(() => null),
    loadPatch('terrain/jungle').then((p) => ({ ...p, region: 'jungle' })).catch(() => null),
    loadPatch('terrain/autumn').then((p) => ({ ...p, region: 'autumn' })).catch(() => null),
    loadPatch('terrain/canyon').then((p) => ({ ...p, region: 'canyon' })).catch(() => null),
  ]);
  // the north was baked with 1.7x vertical exaggeration, which sharpened the Never Summer peaks into knife-edged
  // fins; ease the relief above the valley floor back toward the broad, rounded ranges of the references
  if (north) {
    const B = 200, K = 0.8;
    for (let i = 0; i < north.h.length; i++) north.h[i] = B + (north.h[i] - B) * K;
    for (const v of north.meta.valley) v[2] = B + (v[2] - B) * K;
  }
  setRealTerrain(north, rest.filter(Boolean));
  return !!north;
}
// bilinear sample of a patch plus a 0..1 weight that fades out over `fade` metres inside its border
function patchSample(p, x, z, fade = 260) {
  const m = p.meta, fx = (x - m.x0) / m.cell, fz = (z - m.z0) / m.cell;
  if (fx < 0 || fz < 0 || fx > m.w - 1.001 || fz > m.h - 1.001) return null;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, H = p.h, k = j * m.w + i;
  const h = lerp(lerp(H[k], H[k + 1], tx), lerp(H[k + m.w], H[k + m.w + 1], tx), tz);
  const edge = Math.min(fx, fz, m.w - 1 - fx, m.h - 1 - fz) * m.cell;
  return { h, w: smoothstep(0, fade, edge) };
}
// distance (metres, across the valley) to the canyon creek, or a large number away from it
function canyonCreekD(x, z) {
  for (const p of PATCHES) if (p.creek) {
    const c = p.creek, f = (x - c.x0) / c.cell;
    if (f < 0 || f > c.z.length - 1.001) return 1e9;
    const i = Math.floor(f), zc = lerp(c.z[i], c.z[i + 1], f - i);
    // a gentle meander on top of the traced line, so it winds across the flat floor
    return Math.abs(z - zc - 18 * Math.sin(x / 140) - 9 * Math.sin(x / 53 + 1.7));
  }
  return 1e9;
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
    this.valley = smoothPolyline(FROST_VALLEY, REAL ? 4 : 10);
    // floor height along the valley, resampled onto the smoothed polyline by arc length
    const seg = (pts) => { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; };
    this.valleyLen = seg(this.valley);
    this.valleyTotal = this.valleyLen[this.valleyLen.length - 1];
    this.cabinH = null;
  }

  // real ground height (game metres) at a point, or null outside the baked window
  realAt(x, z) {
    const m = REAL.meta, fx = (x - m.x0) / m.cell, fz = (z - m.z0) / m.cell;
    if (fx < 0 || fz < 0 || fx > m.w - 1.001 || fz > m.h - 1.001) return null;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, H = REAL.h, k = j * m.w + i;
    return lerp(lerp(H[k], H[k + 1], tx), lerp(H[k + m.w], H[k + m.w + 1], tx), tz);
  }
  // how much of the real ground shows: all of it in the north, giving way to the generated pine belt to the
  // south and to the boundary ranges at the map edges
  realWeight(x, z) {
    return smoothstep(-1550, -1950, z) * smoothstep(4070, 3720, Math.abs(x));
  }

  // slope (1 - normal.y) of the real ground (the canyon patch where it covers, else the north window)
  realSlope(x, z) {
    for (const p of PATCHES) if (p.region === 'canyon') {
      const c = patchSample(p, x, z, 300);
      if (c && c.w > 0.5) {
        const e = p.meta.cell, a = patchSample(p, x - e, z), b = patchSample(p, x + e, z), cc = patchSample(p, x, z - e), dd = patchSample(p, x, z + e);
        if (a && b && cc && dd) { const gx = (b.h - a.h) / (2 * e), gz = (dd.h - cc.h) / (2 * e); return 1 - 1 / Math.sqrt(gx * gx + gz * gz + 1); }
      }
    }
    const e = REAL.meta.cell;
    const a = this.realAt(x - e, z), b = this.realAt(x + e, z), c = this.realAt(x, z - e), d = this.realAt(x, z + e);
    if (a === null || b === null || c === null || d === null) return 0;
    const gx = (b - a) / (2 * e), gz = (d - c) / (2 * e);
    return 1 - 1 / Math.sqrt(gx * gx + gz * gz + 1);
  }

  riverWidth(x, z) {
    return 16 + 10 * (0.5 + 0.5 * this.n2.noise(x / 400, z / 400)) + smoothstep(600, 1300, z) * 12;
  }
  valleyFloor(t) {
    const f = t * (FROST_FLOOR.length - 1), i = Math.min(FROST_FLOOR.length - 2, Math.floor(f));
    return lerp(FROST_FLOOR[i], FROST_FLOOR[i + 1], f - i);
  }

  // Region weights at a point (noise-warped borders), shared by height, splat and climate.
  regions(x, z, o) {
    const n3 = this.n3;
    // two-scale domain warp so region borders wander like real climate boundaries
    const bx = x + 650 * n3.fbm(x / 2600, z / 2600, 3) + 170 * n3.noise(x / 520 + 3.3, z / 520);
    const bz = z + 650 * n3.fbm(x / 2600 + 7.7, z / 2600 - 2.1, 3) + 170 * n3.noise(x / 520 - 5.1, z / 520 + 1.9);
    o.bx = bx; o.bz = bz;
    o.pine = smoothstep(-650, -1150, bz);
    o.range = smoothstep(-1850, -2550, bz);
    o.autumn = smoothstep(-1350, -1950, bx) * (1 - smoothstep(-1650, -2150, bz)) * (1 - smoothstep(1000, 1450, bz));
    o.desert = smoothstep(-1100, -1750, bx) * smoothstep(1000, 1600, bz);
    o.jungle = smoothstep(1750, 2350, bz) * smoothstep(-1550, -850, bx);
    o.ocean = Math.max(smoothstep(3250, 3700, bz), smoothstep(3300, 3750, bx) * smoothstep(-1000, -400, bz));
    o.prairie = smoothstep(1700, 2300, bx) * (1 - smoothstep(450, 1000, bz)) * (1 - o.pine);
    // the map's outer walls: high ranges on the west, north and north-east edges
    const ex = Math.max(-x / HALF, -z / HALF, (x / HALF) * smoothstep(-500, -1200, z));
    o.edge = smoothstep(0.86, 0.985, ex) * (1 - o.desert) * (1 - o.ocean);
    return o;
  }

  // Raw height function (expensive, used only during generation). `d` holds precomputed distances.
  rawHeight(x, z, out, d) {
    const n = this.n, n2 = this.n2, n3 = this.n3;
    const R = this.regions(x, z, out || {});
    // Rolling heartlands
    let h = 16 + 16 * n.fbm(x / 900, z / 900, 4) + 6 * n.fbm(x / 220 + 3.1, z / 220, 4) + 1.2 * n2.fbm(x / 50, z / 50, 3);
    // Foothills climbing through the pine belt
    const foot = smoothstep(-450, -2450, R.bz);
    h += foot * foot * 300 + R.pine * 75 * (0.5 + 0.5 * n.fbm(x / 520, z / 520, 4));
    // Autumn hills: big rounded swells
    if (R.autumn > 0) h += R.autumn * (30 + 125 * (0.5 + 0.5 * n.fbm(x / 760 + 11, z / 760, 4)));
    // the autumn hills are real ground: Cades Cove and its ridges in the Great Smoky Mountains
    for (const p of PATCHES) if (p.region === 'autumn' && R.autumn > 0) {
      const s = patchSample(p, x, z, 320);
      if (s) h = lerp(h, s.h + 0.8 * n.fbm(x / 9, z / 9, 2), R.autumn * s.w);
    }
    // Prairie buttes
    if (R.prairie > 0) {
      const b = n3.fbm(x / 420 + 5, z / 420, 3) + 0.04 * n.fbm(x / 60, z / 60, 2);
      h += R.prairie * (42 * smoothstep(0.3, 0.36, b) + 8 * n.fbm(x / 300, z / 300, 3));
    }
    // Snowy range and the outer walls (domain-warped ridges on a broad massif)
    const mt = Math.max(R.range, R.edge);
    if (mt > 0) {
      const wx = x + 420 * n2.fbm(x / 1700, z / 1700, 3), wz = z + 420 * n2.fbm(x / 1700 + 5.3, z / 1700, 3);
      const ridge = n.ridged(wx / 1650 + 10, wz / 1650, 6);
      const massif = 0.6 + 0.4 * n.fbm(wx / 3000, wz / 3000, 3);
      // beside the autumn hills the boundary is old, rounded Appalachian-style ridges rather than alpine spires
      const soft = smoothstep(0.1, 0.5, R.autumn) * (R.edge > R.range ? 1 : 0);
      const alp = Math.pow(ridge, 1.35) * 950 * massif + 150 * massif + 60 * n2.fbm(x / 350, z / 350, 4);
      const old = 140 + 260 * Math.pow(n.fbm(wx / 1300 + 3, wz / 1300, 5) * 0.5 + 0.5, 1.6) + 40 * n2.fbm(x / 300, z / 300, 4);
      // beside the desert the boundary is a stepped sandstone escarpment, like the walls around Monument Valley
      const dry = smoothstep(700, 1400, R.bz) * (x < 0 ? 1 : 0) * (R.edge > R.range ? 1 : 0);
      const esc0 = 120 + 220 * smoothstep(-0.1, 0.25, n.fbm(wx / 900 + 7, wz / 900, 4)) + 8 * n2.fbm(x / 60, z / 60, 3);
      const escT = esc0 / 38, escF = Math.floor(escT);
      const esc = (escF + smoothstep(0.7, 0.92, escT - escF)) * 38;
      h += mt * lerp(lerp(alp, old, soft), esc, dry);
    }
    // erosion-like ridges and gullies on high ground
    const hi = smoothstep(110, 420, h);
    if (hi > 0) {
      const g1 = n2.ridged(x / 260 + 3.3, z / 260 - 1.7, 4);
      const g2 = n.ridged(x / 90 - 8.1, z / 90 + 2.2, 3);
      h += hi * (g1 * 75 + g2 * 18 - 42);
    }
    // Frostwater Valley: a broad U-shaped glacial trough cut into the range
    if (d && d.vd < 700) {
      const floor = this.valleyFloor(d.vt) + 5 * n2.fbm(x / 120, z / 120, 3);
      const wv = smoothstep(70, 430, d.vd);
      let wall = floor + 340 * Math.pow(wv, 1.45);
      // buttresses and cliff bands on the walls, strongest mid-slope, so rock breaks through the snow
      const cb = n.ridged(x / 150 + 9.1, z / 150 - 3.3, 3);
      wall += wv * (1 - wv) * 4 * (50 * cb - 19);
      // broad benches (a narrow step contour would leave free-standing fins)
      wall += 22 * smoothstep(0.3, 0.7, n2.fbm(x / 190, z / 190 + 3.7, 2) + 0.5) * smoothstep(0.15, 0.4, wv);
      h = lerp(h, Math.min(h, wall), smoothstep(700, 380, d.vd));
      // the frozen creek and its braided side channels
      h -= 1.2 * smoothstep(5, 2, d.vd);
    }
    // Crags: high range faces break into stepped cliff bands — near-vertical granite risers with
    // ledges between them where snow collects — instead of smooth white slopes
    if (mt > 0.05) {
      // on open high ground above the tree line; in Frostwater Valley on the walls (never the floor)
      const inV = d && d.vd < 700 ? smoothstep(700, 500, d.vd) : 0;
      const gate = lerp(smoothstep(260, 520, h), smoothstep(85, 190, d ? d.vd : 1e9), inV);
      // fades out on the summits, where steps would chip the ridgelines into teeth
      let cw = mt * gate * lerp(1, 0.0, inV) * smoothstep(0.3, 0.55, n3.fbm(x / 700 - 4.2, z / 700 + 8.8, 3) + 0.5) * (1 - smoothstep(780, 940, h));
      if (cw > 0.01) {
        const S = 16 + 14 * (0.5 + 0.5 * n2.fbm(x / 400 + 1.9, z / 400, 2));
        const t = h / S + 0.9 * n.fbm(x / 160 + 6.1, z / 160 - 2.4, 3);
        const f = Math.floor(t), r = t - f;
        // flat ledge for most of the step, then a steep riser
        const rr = smoothstep(0.68, 0.96, r);
        h += cw * (f + rr - t) * S * 0.7;
      }
    }
    // Real ground in the north (see setRealTerrain); a faint fine roughness on top of the 4 m samples
    let realW = 0;
    if (REAL) {
      realW = this.realWeight(x, z);
      if (realW > 0) {
        const r = this.realAt(x, z);
        if (r === null) realW = 0;
        else {
          // (no closing wall at the north edge any more: the backdrop carries the real ground on past the map)
          let rb = r;
          const sl = this.realSlope(x, z);
          // (not on the summits: steps along a skyline read as a sawtooth)
          // only on genuinely steep faces (on forested slopes the steps read as contour lines)
          const cw = smoothstep(0.34, 0.5, sl) * smoothstep(0.35, 0.6, n3.fbm(x / 500 + 2.2, z / 500 - 7.1, 3) + 0.5) * (1 - smoothstep(560, 760, r));
          if (cw > 0.01) {
            const S = 11 + 8 * (0.5 + 0.5 * n2.fbm(x / 300 + 4.4, z / 300, 2));
            const t = r / S + 0.7 * n.fbm(x / 120 - 1.3, z / 120 + 6.6, 3);
            const fl = Math.floor(t), fr = t - fl;
            rb += cw * (fl + smoothstep(0.62, 0.95, fr) - t) * S * 0.55;
          }
          h = lerp(h, rb + 1.4 * n2.fbm(x / 24, z / 24, 3) + 0.5 * n.fbm(x / 7, z / 7, 2), realW);
          // the creek winds down the real valley floor
          // (wide enough to read from the lookouts: an 18 m channel with a braided, iced flood plain beside it)
          if (d && d.vd < 14) h -= 1.5 * smoothstep(10, 3, d.vd) * realW;
        }
      }
    }
    // the snowy north-west is a granite canyon: Yosemite Valley, sheer walls over a flat floor
    let creekD = 1e9, canyonW = 0;
    for (const p of PATCHES) if (p.region === 'canyon') {
      const s = patchSample(p, x, z, 300);
      if (s) {
        canyonW = s.w;
        h = lerp(h, s.h + 1.2 * n2.fbm(x / 20, z / 20, 3) + 0.4 * n.fbm(x / 6, z / 6, 2), s.w);
        // the creek: a shallow channel winding down the floor
        creekD = canyonCreekD(x, z);
        if (creekD < 16) h -= 1.6 * smoothstep(12, 4, creekD) * s.w;   // a channel wide enough to read from the ride
      }
    }
    // Desert: terraced red mesas over sand flats
    if (R.desert > 0) {
      const m = n2.fbm(x / 1100 + 20, z / 1100 - 4, 4) + 0.035 * n.fbm(x / 90, z / 90, 3);
      const dh = 12 + 8 * n.fbm(x / 600, z / 600, 3) + 75 * smoothstep(0.1, 0.15, m) + 60 * smoothstep(0.31, 0.35, m) + 2.5 * n.fbm(x / 40, z / 40, 3);
      h = lerp(h, dh, R.desert);
    }
    for (const p of PATCHES) if (p.region === 'desert' && R.desert > 0) {
      const s = patchSample(p, x, z);
      if (s) h = lerp(h, s.h + 0.8 * n.fbm(x / 9, z / 9, 2), R.desert * s.w);
    }
    // Jungle: steep karst hills
    if (R.jungle > 0) {
      const jh = 22 + 55 * (0.5 + 0.5 * n.fbm(x / 500, z / 500, 4)) + 210 * Math.pow(n3.ridged(x / 640 + 7, z / 640 - 3, 4), 2.2);
      h = lerp(h, jh, R.jungle);
    }
    // Swamp / bayou lowlands
    // bayou: an irregular basin around the lower river
    const sbx = (R.bx - 1500) / 1150, sbz = (R.bz - 1300) / 680;
    const sw = smoothstep(1.15, 0.75, Math.hypot(sbx, sbz)) * (1 - R.edge) * (1 - R.ocean);
    if (sw > 0) {
      const swampH = 0.35 + 1.3 * n2.fbm(x / 90, z / 90, 4) + 0.5 * n.noise(x / 25, z / 25);
      h = lerp(h, swampH, sw);
    }
    // Ocean
    if (R.ocean > 0) h = lerp(h, -16 + 4 * n.fbm(x / 400, z / 400, 3), R.ocean);
    // the jungle coast and its sea are real ground (cliffs, ridges and the shelf below the waves)
    for (const p of PATCHES) if (p.region === 'jungle') {
      const s = patchSample(p, x, z, 380);
      if (s) h = lerp(h, s.h + 0.8 * n.fbm(x / 9, z / 9, 2) * (s.h > 0 ? 1 : 0), Math.max(R.jungle, R.ocean) * s.w);
    }
    // Lake
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r + 0.25 * n2.noise(x / 160, z / 160);
    if (ld < 1.4) h = lerp(h, Math.min(h, -6 + ld * 7), smoothstep(1.35, 0.85, ld));
    // River: broad floodplain in the lowlands, a gorge through the foothills
    const rd = d ? d.rd : 1e9;
    const rw = this.riverWidth(x, z);
    const north = smoothstep(-500, -1300, z);
    if (rd < rw * 16) {
      const plain = rw * (3.5 - 2.3 * north);
      const target = 2.2 + rd * 0.06 + 0.5 * Math.pow(Math.max(0, rd - plain), 1.28);
      h = lerp(h, Math.min(h, target), smoothstep(rw * 16, rw * 10, rd));
      const chan = smoothstep(rw, rw * 0.35, rd);
      h = lerp(h, -2.8, chan);
    }
    // Roads soften fine relief and must stay dry
    const roadD = d ? d.roadD : 1e9;
    // wind drifts on the open snow of the north: low dunes about a metre high, ridged across the wind, with
    // scoops between, so the snowfields have shape under flat storm light instead of lying as a white sheet
    const sk = Math.max(realW, canyonW);
    if (sk > 0.01) {
      const wa = x * 0.93 + z * 0.36, wb = -x * 0.36 + z * 0.93;   // along / across the wind
      // (flat ground only: on the mountainsides the same relief reads from afar as a rumpled sheet)
      const flat = (1 - smoothstep(0.04, 0.13, this.realSlope(x, z))) * smoothstep(6, 26, Math.min(roadD, creekD, d ? d.vd : 1e9));
      if (flat > 0) h += sk * flat * (0.7 * n.fbm(wa / 15, wb / 44, 3) + 0.25 * n2.fbm(x / 8, z / 8, 2));
    }
    // Town plateau
    const tx = Math.abs(x - TOWN.x) / (TOWN.w * 0.5), tz = Math.abs(z - TOWN.z) / (TOWN.d * 0.5);
    const town = smoothstep(1.6, 0.9, Math.max(tx, tz));
    if (town > 0) h = lerp(h, 14.5 + 0.6 * n2.noise(x / 60, z / 60), town);
    // Ranch flat
    const rnd = smoothstep(130, 70, Math.hypot(x - RANCH.x, z - RANCH.z));
    if (rnd > 0) h = lerp(h, 13.6 + 0.3 * n2.noise(x / 40, z / 40), rnd);
    // Church knoll
    const ck = smoothstep(70, 20, Math.hypot(x - CHURCH.x, z - CHURCH.z));
    if (ck > 0) h = lerp(h, 19, ck);
    // Outlaw camp clearing
    const cc = smoothstep(80, 30, Math.hypot(x - CAMP.x, z - CAMP.z));
    if (cc > 0) h = lerp(h, h * 0.4 + 30 * 0.6, cc);
    // Trapper's cabin bench on the valley wall
    const cb = smoothstep(55, 22, Math.hypot(x - CABIN.x, z - CABIN.z));
    if (cb > 0 && this.cabinH !== null) h = lerp(h, this.cabinH, cb);
    if (roadD < 14 && rd > rw * 0.5) h = Math.max(h, 1.2);

    if (out) {
      out.road = smoothstep(3.9, 2.0, roadD + 1.2 * n2.noise(x / 9, z / 9));
      // main channel runs open (wet = 1); the braided side channels are iced over (wet ~0.7)
      // (valley distances are scaled by the widening, so keep the braid band narrow in those units)
      const braid = d && d.vd < 70 ? Math.max(smoothstep(9, 4, d.vd), 0.72 * smoothstep(70, 44, d.vd) * smoothstep(0.58, 0.68, n.noise(x / 34, z / 34) * 0.5 + 0.5)) : 0;
      // canyon creek: an open channel with iced side braids
      const cbraid = creekD < 60 ? Math.max(smoothstep(8, 3.5, creekD), 0.72 * smoothstep(60, 38, creekD) * smoothstep(0.58, 0.68, n.noise(x / 28, z / 28) * 0.5 + 0.5)) : 0;
      out.wet = Math.max(smoothstep(rw * 1.9, rw * 0.9, rd), sw * 0.8, smoothstep(1.25, 0.95, ld), braid, cbraid);
      out.town = Math.max(town, rnd * 0.32, cc, cb * 0.6);
      out.swamp = sw;
      out.roadD = roadD;
    }
    return h;
  }

  // Distance fields for one band of rows: river, roads and the glacial valley (with arc-length parameter).
  distanceBand(j0, j1) {
    const N = (j1 - j0) * RES;
    const rd = new Float32Array(N).fill(1e9), roadD = new Float32Array(N).fill(1e9);
    const vd = new Float32Array(N).fill(1e9), vt = new Float32Array(N);
    const stamp = (pts, maxD, arr, tArr, lens, total, scale = 1, widen = null) => {
      for (let s = 0; s < pts.length - 1; s++) {
        const ax = pts[s][0], az = pts[s][1], bx = pts[s + 1][0], bz = pts[s + 1][1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - maxD + HALF) / CELL));
        const i1 = Math.min(RES - 1, Math.ceil((Math.max(ax, bx) + maxD + HALF) / CELL));
        const jj0 = Math.max(j0, Math.floor((Math.min(az, bz) - maxD + HALF) / CELL));
        const jj1 = Math.min(j1 - 1, Math.ceil((Math.max(az, bz) + maxD + HALF) / CELL));
        for (let j = jj0; j <= jj1; j++) {
          const pz = -HALF + j * CELL, row = (j - j0) * RES;
          for (let i = i0; i <= i1; i++) {
            const px = -HALF + i * CELL;
            const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
            const qx = ax + dx * t - px, qz = az + dz * t - pz;
            const tn = tArr ? (lens[s] + t * (lens[s + 1] - lens[s])) / total : 0;
            const dd = Math.sqrt(qx * qx + qz * qz) * scale / (widen ? widen(tn) : 1);
            const k = row + i;
            if (dd < arr[k]) { arr[k] = dd; if (tArr) tArr[k] = tn; }
          }
        }
      }
    };
    stamp(this.river, 700, rd);
    this.roads.forEach((r, ri) => stamp(r, 24, roadD, null, null, null, ROAD_SCALE[ri] || 1));
    // (the real valley carries its own width, so no widening there)
    stamp(this.valley, REAL ? 720 : 720 * valleyWiden(1), vd, vt, this.valleyLen, this.valleyTotal, 1, REAL ? null : valleyWiden);
    return { rd, roadD, vd, vt };
  }

  // Generate heights, splat and climate for rows [j0, j1). Runs in a worker or on the main thread.
  generateRows(j0, j1) {
    if (this.cabinH === null) this.cabinH = this.cabinHeight();
    const N = (j1 - j0) * RES;
    const heights = new Float32Array(N), splat = new Uint8Array(N * 4), climate = new Uint8Array(N * 4);
    const D = this.distanceBand(j0, j1);
    const o = {}, d = {};
    const forest = this.n3, n = this.n, n2 = this.n2;
    for (let j = j0; j < j1; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < RES; i++) {
        const x = -HALF + i * CELL;
        const k = (j - j0) * RES + i;
        d.rd = D.rd[k]; d.roadD = D.roadD[k]; d.vd = D.vd[k]; d.vt = D.vt[k];
        const h = this.rawHeight(x, z, o, d);
        heights[k] = h;
        // climate: cold north and high peaks carry snow; the other regions come straight from the weights
        const snowLat = smoothstep(-1750, -2350, o.bz + 90 * n2.noise(x / 300, z / 300));
        const snowAlt = smoothstep(820, 1000, h + 110 * n.noise(x / 500, z / 500)) * (1 - o.desert) * (1 - o.jungle) * (1 - (x < 0 ? smoothstep(700, 1400, o.bz) : 0));
        const snow = Math.max(snowLat, snowAlt) * (1 - o.ocean);
        // forest density: patches, a dense pine belt, jungle, autumn woods; none on roads, towns, water, peaks
        let f = smoothstep(0.05, 0.45, forest.fbm(x / 520, z / 520, 4) + 0.7 * o.pine * (1 - 0.55 * snowLat) + 0.45 * o.swamp
          + 0.6 * o.jungle + 0.3 * o.autumn - 0.8 * o.desert - 0.35 * o.prairie);
        f *= 1 - o.town;
        f *= smoothstep(2.5, 6.5, o.roadD); // trees crowd right up to trails
        f *= smoothstep(0.2, 1.4, h);
        f *= smoothstep(1000, 780, h);
        f *= 1 - 0.5 * snowLat * smoothstep(300, 600, h);
        // in the cold north trees gather in groves rather than dotting every slope
        f *= 1 - snowLat * (1 - smoothstep(0.42, 0.62, forest.fbm(x / 260 + 4.4, z / 260 - 1.3, 3) * 0.5 + 0.5));
        // glacial valley: dark conifer forest on the lower walls, an open floor with scattered firs
        if (D.vd[k] < 700) {
          const vd = D.vd[k];
          const edgeN = 45 * n2.fbm(x / 120 + 1.1, z / 120 - 2.2, 2);
          const wallBand = smoothstep(85 + edgeN, 150 + edgeN, vd) * smoothstep(430, 300, vd);
          f = Math.max(f, snowLat * wallBand * smoothstep(0.3, 0.48, forest.fbm(x / 240 + 2.2, z / 240, 3) * 0.5 + 0.5) * 0.92 * smoothstep(2.5, 6.5, o.roadD));
          f *= 1 - 0.95 * snowLat * smoothstep(110, 50, vd);
          // stands of spruce out on the floor, with open snow meadows between them
          f = Math.max(f, snowLat * 0.85 * smoothstep(0.5, 0.62, forest.fbm(x / 170 - 6.6, z / 170 + 2.9, 3) * 0.5 + 0.5) * smoothstep(12, 30, vd) * smoothstep(2.5, 6.5, o.roadD));
        }
        // Real jungle coast: rainforest from the shore to the crests, bare only on the sheerest cliffs and the beaches
        for (const p of PATCHES) if (p.region === 'jungle' && o.jungle > 0.2) {
          const ps = patchSample(p, x, z, 380);
          if (!ps) continue;
          let fj = smoothstep(2.5, 9, h) * smoothstep(2.5, 6.5, o.roadD);
          fj *= 0.85 + 0.15 * smoothstep(0.3, 0.6, forest.fbm(x / 150, z / 150, 3) * 0.5 + 0.5);
          f = lerp(f, fj, ps.w * smoothstep(0.2, 0.6, o.jungle));
        }
        // Real autumn hills: hardwood forest on the ridges and slopes, open hay meadows on the cove floor
        for (const p of PATCHES) if (p.region === 'autumn' && o.autumn > 0.2) {
          const ps = patchSample(p, x, z, 320);
          if (!ps) continue;
          let fa = smoothstep(28, 45, ps.h + 10 * n2.fbm(x / 140, z / 140, 3)) * smoothstep(2.5, 6.5, o.roadD);
          fa = Math.max(fa, 0.75 * smoothstep(0.62, 0.72, forest.fbm(x / 120 - 3.3, z / 120 + 1.1, 3) * 0.5 + 0.5) * smoothstep(2.5, 6.5, o.roadD));  // hedgerow groves
          f = lerp(f, fa, ps.w * smoothstep(0.2, 0.6, o.autumn));
        }
        // Real ground: a subalpine forest as it grows there — continuous spruce-fir on the valley walls below the
        // tree line, thinning into krummholz above it, broken by avalanche chutes, cliffs and wet meadows on the floor
        if (REAL) {
          const rw = this.realWeight(x, z);
          if (rw > 0 && this.realAt(x, z) !== null) {
            const sl = this.realSlope(x, z);
            const vd = D.vd[k];
            let fr = smoothstep(760, 690, h + 70 * n2.fbm(x / 180, z / 180, 3));     // tree line: ragged but sharp
            // and the timber thins as it climbs: massed on the valley floor and lower slopes, open stands higher up
            // (one density over every slope and ridgetop read as pepper)
            fr *= 0.35 + 0.65 * smoothstep(640, 330, h + 50 * n2.fbm(x / 240 + 3.3, z / 240, 3));
            fr *= 1 - smoothstep(0.4, 0.56, sl);                                        // cliffs and steep faces stay bare
            // timber follows the water: thick in the draws and gullies, thin on the spurs and convex shoulders
            {
              const rh = this.realAt(x, z), q = 70;
              const ra = this.realAt(x + q, z), rb = this.realAt(x - q, z), rc = this.realAt(x, z + q), rd2 = this.realAt(x, z - q);
              // (on the flat valley floor there is no drainage to follow: groves of spruce and open snow meadows
              // in about equal measure, as the reference's floor, instead of a near-empty white plain)
              if (rh !== null && ra !== null && rb !== null && rc !== null && rd2 !== null) {
                const dr = 0.05 + 1.25 * smoothstep(-2, 7, (ra + rb + rc + rd2) / 4 - rh);
                const grove = 0.15 + 1.0 * smoothstep(0.47, 0.6, forest.fbm(x / 150 + 2.2, z / 150 - 9.1, 3) * 0.5 + 0.5);
                fr *= lerp(dr, grove, smoothstep(0.2, 0.07, sl));
              }
            }
            // stands and open snowfields in about equal measure, as the references' valley sides are: dark timber
            // in clumps and tongues with wide white glades between, not an even pepper of trees
            fr *= 0.5 + 0.5 * smoothstep(0.44, 0.56, forest.fbm(x / 260 + 8.1, z / 260 - 5.5, 4) * 0.5 + 0.5 + 0.08);   // clearings (the terrain does most of the shaping below)
            fr *= 1 - 0.85 * smoothstep(0.62, 0.7, n.noise(x / 60 + z / 900, z / 380) * 0.5 + 0.5) * smoothstep(0.25, 0.4, sl); // chutes
            let inCanyon = 0;
            for (const p of PATCHES) if (p.region === 'canyon') { const c = patchSample(p, x, z, 300); if (c) inCanyon = c.w; }
            // open meadow along the creek (in the canyon: meadows and stands on the flat floor)
            // (in the canyon: an open snowy floor with a few stands; forest on the talus at the foot of the walls)
            const canyonF = 0.12 + 0.45 * smoothstep(0.55, 0.68, forest.fbm(x / 90 + 5.5, z / 90, 3) * 0.5 + 0.5) + 0.75 * smoothstep(350, 400, h) * (1 - smoothstep(0.45, 0.6, sl));
            fr *= lerp(0.35 + 0.65 * smoothstep(40, 110, vd), Math.min(1, canyonF), inCanyon);
            fr *= smoothstep(2.5, 6.5, o.roadD);
            f = lerp(f, Math.min(1, fr * 1.05), rw);
          }
        }
        splat[k * 4 + 0] = o.road * 255;
        splat[k * 4 + 1] = o.wet * 255;
        splat[k * 4 + 2] = f * 255;
        splat[k * 4 + 3] = o.town * 255;
        climate[k * 4 + 0] = snow * 255;
        climate[k * 4 + 1] = o.jungle * (1 - o.ocean * 0.5) * 255;
        climate[k * 4 + 2] = o.autumn * (1 - snow) * 255;
        // the boundary ranges beside the desert are red rock too
        climate[k * 4 + 3] = Math.max(o.desert, o.edge * smoothstep(700, 1400, o.bz) * (x < 0 ? 1 : 0)) * 255;
      }
    }
    return { j0, j1, heights, splat, climate };
  }

  cabinHeight() {
    const D = { rd: 1e9, roadD: 1e9, vd: 1e9, vt: 0 };
    // distance to the valley for the cabin point
    let best = 1e9, bt = 0;
    for (let s = 0; s < this.valley.length - 1; s++) {
      const [ax, az] = this.valley[s], [bx, bz] = this.valley[s + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = clamp(((CABIN.x - ax) * dx + (CABIN.z - az) * dz) / L2, 0, 1);
      const tn = (this.valleyLen[s] + t * (this.valleyLen[s + 1] - this.valleyLen[s])) / this.valleyTotal;
      const dd = Math.hypot(ax + dx * t - CABIN.x, az + dz * t - CABIN.z) / (REAL ? 1 : valleyWiden(tn));
      if (dd < best) { best = dd; bt = tn; }
    }
    D.vd = best; D.vt = bt;
    this.cabinH = null;
    const h = this.rawHeight(CABIN.x, CABIN.z, null, D);
    return h;
  }

  async generate(onProgress) {
    this.heights = new Float32Array(RES * RES);
    this.splat = new Uint8Array(RES * RES * 4);
    this.climate = new Uint8Array(RES * RES * 4);
    const t0 = performance.now();
    const put = (r) => {
      this.heights.set(r.heights, r.j0 * RES);
      this.splat.set(r.splat, r.j0 * RES * 4);
      this.climate.set(r.climate, r.j0 * RES * 4);
    };
    const BAND = 96;
    const bands = [];
    for (let j = 0; j < RES; j += BAND) bands.push([j, Math.min(RES, j + BAND)]);
    let usedWorkers = false;
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      try {
        const nW = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 8);
        let next = 0, done = 0;
        await new Promise((resolve, reject) => {
          const workers = [];
          const feed = (w) => {
            if (next >= bands.length) { w.terminate(); return; }
            const [a, b] = bands[next++];
            // each worker gets the real heightmap with its first band
            w.postMessage({ seed: this.seed, res: RES, j0: a, j1: b, real: w.gotReal ? null : REAL, patches: w.gotReal ? null : PATCHES });
            w.gotReal = true;
          };
          for (let k = 0; k < nW; k++) {
            const w = new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => {
              put(e.data); done++;
              onProgress && onProgress(done / bands.length);
              if (done === bands.length) { workers.forEach((x) => x.terminate()); resolve(); } else feed(w);
            };
            w.onerror = (e) => { workers.forEach((x) => x.terminate()); reject(e); };
            workers.push(w);
            feed(w);
          }
        });
        usedWorkers = true;
      } catch (e) {
        console.warn('world workers unavailable, generating on the main thread', e);
      }
    }
    if (!usedWorkers) {
      for (let b = 0; b < bands.length; b++) {
        put(this.generateRows(bands[b][0], bands[b][1]));
        onProgress && onProgress((b + 1) / bands.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.cabinH = this.cabinH ?? this.cabinHeight();
    this.smoothMountains();
    this.terraceCliffs();
    this.genMs = performance.now() - t0;
    if (typeof document === 'undefined' && typeof window === 'undefined') return; // node: no GPU textures
    this.heightTex = new THREE.DataTexture(this.heights, RES, RES, THREE.RedFormat, THREE.FloatType);
    this.heightTex.needsUpdate = true;
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    const rgba = (data) => {
      const t = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.needsUpdate = true;
      return t;
    };
    this.splatTex = rgba(this.splat);
    this.climateTex = rgba(this.climate);
  }

  // Soften high-frequency faceting on steep high ground (cheap thermal-erosion stand-in).
  smoothMountains() {
    const H = this.heights, tmp = new Float32Array(H.length);
    for (let pass = 0; pass < 1; pass++) {
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const k = j * RES + i, h = H[k];
        const m = smoothstep(45, 140, h) * 0.75;
        if (m <= 0 || i < 2 || j < 2 || i > RES - 3 || j > RES - 3) { tmp[k] = h; continue; }
        // a light 3x3 pass: removes single-cell spikes but keeps the cliff bands sharp
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) { const r = k + dj * RES; sum += H[r - 1] + H[r] + H[r + 1]; }
        tmp[k] = lerp(h, sum / 9, m * 0.8);
      }
      H.set(tmp);
    }
  }

  // Mountain geology. A heightfield of smoothed elevation data has no cliffs: its steep faces are even ramps that
  // shade as one airbrushed slab. Real faces are cut along their bedding into rock bands standing between ledges,
  // and the ledges hold the snow. Here every steep face in the snow country is re-cut that way: within each stratum
  // the ground lies back as a bench and then stands up as a riser, the strata dipping and wandering along the face.
  // The terrain shader's slope rule then lays snow on the benches and bares the risers by itself.
  terraceCliffs() {
    const H = this.heights, C = this.climate, src = new Float32Array(H);
    const n = this.n, R = 3, inv = 1 / (2 * R * CELL);
    // the strata: beds of uneven thickness (thin shelves, thick cliff-forming bands), each with its own habit: a hard
    // bed stands up sheer above a narrow ledge, a soft one lies back as a ramp of snow
    const rs = mulberry32(this.seed * 7 + 5), beds = [];
    // (mostly thick: thin beds laid hairline snow shelves across a wall, which from a distance read as white
    // squiggles drawn on it; cliff-forming bands tens of metres high stand between broad benches)
    for (let b = -200; b < 1500;) { const t = 16 + 46 * rs() * rs() + (rs() < 0.3 ? 34 : 0), hard = 0.35 + 0.65 * rs(); beds.push([b, t, 0.5 - 0.3 * hard, 0.5 + 0.3 * hard * (0.5 + 0.5 * rs())]); b += t; }
    const cut = (u) => {
      let lo = 0, hi = beds.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beds[m][0] <= u) lo = m; else hi = m - 1; }
      const [b, t, a, c] = beds[lo];
      return b + smoothstep(a, c, (u - b) / t) * t;
    };
    for (let j = R; j < RES - R; j++) {
      const z = j * CELL - HALF;
      if (z > -1500) break;
      for (let i = R; i < RES - R; i++) {
        const k = j * RES + i, snow = C[k * 4] / 255;
        if (snow < 0.35) continue;
        const g = Math.hypot(src[k + R] - src[k - R], src[k + R * RES] - src[k - R * RES]) * inv;   // rise over run
        // (true cliffs only, steeper than about 40 degrees: cut into the ordinary valley sides as well, the benches
        // drew contour lines round every mountain seen from a lookout)
        let amt = smoothstep(0.82, 1.3, g) * smoothstep(0.35, 0.65, snow);
        if (amt <= 0) continue;
        const x = i * CELL - HALF, h = src[k];
        // not every part of a face shows its bedding: gullies and aprons of scree and drift run down between the
        // buttresses
        amt *= 0.3 + 0.7 * smoothstep(-0.35, 0.3, n.noise(x / 150 + 9.1, z / 150 - 4.2) + 0.4 * n.noise(x / 47 - 2.2, z / 47 + 6.6));
        // the bedding dips across the range and wanders, so ledges run on for a way, pinch out and step
        const dip = 0.05 * x + 0.03 * z + 26 * n.noise(x / 360 + 3.3, z / 360 - 1.7) + 6 * n.noise(x / 110 - 6.1, z / 110 + 2.9);
        H[k] = lerp(h, cut(h + dip) - dip, amt);
      }
    }
  }

  // Bilinear height sample — matches the GPU sampler exactly.
  // level a yard into the slope (a homestead set down after load): within r the ground takes the height at the
  // centre, easing back to the natural slope over `fall` metres; the GPU copy is re-uploaded
  stampPad(x, z, r, fall = 14) {
    const h0 = this.heightAt(x, z), R = r + fall;
    const i0 = Math.max(0, Math.floor((x - R + HALF) / CELL)), i1 = Math.min(RES - 1, Math.ceil((x + R + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - R + HALF) / CELL)), j1 = Math.min(RES - 1, Math.ceil((z + R + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * CELL - HALF - x, j * CELL - HALF - z);
      if (d > R) continue;
      const k = j * RES + i;
      this.heights[k] = lerp(this.heights[k], h0, smoothstep(R, r, d));
    }
    this.heightTex.needsUpdate = true;
    // and the yard is open ground: no forest tint left under the cleared trees (it read as a flat grey shelf)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * CELL - HALF - x, j * CELL - HALF - z);
      if (d > R) continue;
      const k = (j * RES + i) * 4 + 2;
      this.splat[k] = Math.round(this.splat[k] * (1 - smoothstep(R, r, d)));
    }
    this.splatTex.needsUpdate = true;
    return h0;
  }

  // Set-building: raise a spur, a rounded crest running out from (ax, az) at height ah and down to a knoll standing
  // at (bx, bz), height bh. Ground is only ever raised. Returns the box of ground that may have changed.
  raiseSpur(ax, az, ah, bx, bz, bh, { side = 0.52, round = 0.0032, top = 30, reach = 230, rough = 1, sag = 8, flat0 = 5 } = {}) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const x0 = Math.min(ax, bx) - reach, x1 = Math.max(ax, bx) + reach, z0 = Math.min(az, bz) - reach, z1 = Math.max(az, bz) + reach;
    const i0 = Math.max(0, Math.floor((x0 + HALF) / CELL)), i1 = Math.min(RES - 1, Math.ceil((x1 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z0 + HALF) / CELL)), j1 = Math.min(RES - 1, Math.ceil((z1 + HALF) / CELL));
    const n = this.n;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * CELL - HALF, z = j * CELL - HALF;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      // the crest sags into a saddle behind the knoll, which stands as its own broad top
      // (the crest runs down to a saddle lying below the knoll's top and climbs the last stretch onto it, so the top
      // stands clear of its own approach when seen from up the crest)
      const crest = lerp(ah, bh - sag, Math.min(1, t / 0.7)) + sag * smoothstep(0.7, 1, t);
      const flat = lerp(flat0, top, smoothstep(0.72, 1, t));
      const target = crest - side * Math.max(0, d - flat) - round * d * d + rough * (3.2 * n.noise(x / 34 + 4.2, z / 34 - 7.7) + 1.3 * n.noise(x / 13 - 1.1, z / 13 + 3.9) + 0.4 * n.noise(x / 5 + 2.3, z / 5 - 6.1));
      const k = j * RES + i;
      if (target > this.heights[k]) {
        const lift = target - this.heights[k];
        this.heights[k] = target;
        this.splat[k * 4] = 0; this.splat[k * 4 + 1] = 0;                       // no road or creek carried up onto it
        this.splat[k * 4 + 2] = Math.round(this.splat[k * 4 + 2] * (1 - smoothstep(0, 5, lift)));   // open snow where the ground is newly made
      }
    }
    this.heightTex.needsUpdate = true; this.splatTex.needsUpdate = true;
    return [x0, z0, x1, z1];
  }

  // Set-building: wind drifts. Open snow within R of a point is heaped into long drifts lying across the wind
  // with scoops between them (real relief the light can rake, where the heightfield was a billiard table).
  sculptDrifts(cx, cz, R, amp = 0.45) {
    const n = this.n2;
    const i0 = Math.max(1, Math.floor((cx - R + HALF) / CELL)), i1 = Math.min(RES - 2, Math.ceil((cx + R + HALF) / CELL));
    const j0 = Math.max(1, Math.floor((cz - R + HALF) / CELL)), j1 = Math.min(RES - 2, Math.ceil((cz + R + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * CELL - HALF, z = j * CELL - HALF, d = Math.hypot(x - cx, z - cz), k = j * RES + i;
      if (d > R || this.climate[k * 4] < 150) continue;
      const g = Math.hypot(this.heights[k + 1] - this.heights[k - 1], this.heights[k + RES] - this.heights[k - RES]) / (2 * CELL);
      const w = smoothstep(R, R * 0.65, d) * (1 - smoothstep(0.12, 0.3, g)) * (1 - smoothstep(60, 120, this.splat[k * 4 + 1]));
      if (w <= 0) continue;
      const u = x * 0.93 + z * 0.36, v = -x * 0.36 + z * 0.93;
      const ridge = 1 - Math.abs(n.noise(u / 13, v / 34));   // sharp-backed drifts
      this.heights[k] += amp * w * (1.5 * (ridge * ridge - 0.45) + 0.6 * n.noise(u / 5 + 3.1, v / 11 - 2.2) + 1.6 * n.noise(u / 47 - 1.3, v / 60 + 4.4));
    }
    this.heightTex.needsUpdate = true;
  }
  // Set-building: a frozen creek along a line of points: the splat's wet channel painted (ice down the middle,
  // willow and gravel along the banks, from the ground shader) and the bed sunk a little into the snow.
  paintCreek(pts, half = 4.5, depth = 0.7) {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, R = half + 5;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / CELL)), i1 = Math.min(RES - 1, Math.ceil((Math.max(ax, bx) + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / CELL)), j1 = Math.min(RES - 1, Math.ceil((Math.max(az, bz) + R + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * CELL - HALF, z = j * CELL - HALF, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) + 1.2 * this.n3.noise(x / 9, z / 9), k = j * RES + i;
        if (d > R) continue;
        const wet = Math.round(235 * smoothstep(R, half * 0.35, d));
        if (wet > this.splat[k * 4 + 1]) { this.splat[k * 4 + 1] = wet; this.splat[k * 4 + 2] = Math.round(this.splat[k * 4 + 2] * (1 - wet / 255)); }
        const bed = (this.creekBed || (this.creekBed = new Map()));
        const cut = depth * smoothstep(half + 3, half * 0.3, d);
        if (cut > (bed.get(k) || 0)) { this.heights[k] -= cut - (bed.get(k) || 0); bed.set(k, cut); }
      }
    }
    this.heightTex.needsUpdate = true; this.splatTex.needsUpdate = true;
  }

  // Set-building: timber. The forest channel of the splat raised to v within r metres of a point (the ground
  // under a planted stand is then shaded as forest floor, not open snow). Call touchSplat() when done.
  paintForest(x, z, r, v = 220) {
    const i0 = Math.max(0, Math.round((x - r + HALF) / CELL)), i1 = Math.min(RES - 1, Math.round((x + r + HALF) / CELL));
    const j0 = Math.max(0, Math.round((z - r + HALF) / CELL)), j1 = Math.min(RES - 1, Math.round((z + r + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = (j * RES + i) * 4 + 2; if (this.splat[k] < v) this.splat[k] = v; }
  }
  touchSplat() { this.splatTex.needsUpdate = true; }
  // Set-building: a used track or a trampled yard (the splat's road channel) along a line of points.
  paintTrack(pts, half = 2.2) {
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, R = half + 3;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / CELL)), i1 = Math.min(RES - 1, Math.ceil((Math.max(ax, bx) + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / CELL)), j1 = Math.min(RES - 1, Math.ceil((Math.max(az, bz) + R + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * CELL - HALF, z = j * CELL - HALF, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) + 1.5 * this.n3.noise(x / 6, z / 6), k = (j * RES + i) * 4;
        const v = Math.round(240 * smoothstep(R, half * 0.5, d));
        if (v > this.splat[k]) this.splat[k] = v;
      }
    }
    this.splatTex.needsUpdate = true;
  }

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
  climateAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, RES - 1);
    const j = clamp(Math.round((z + HALF) / CELL), 0, RES - 1);
    const k = (j * RES + i) * 4, C = this.climate;
    return { snow: C[k] / 255, jungle: C[k + 1] / 255, autumn: C[k + 2] / 255, desert: C[k + 3] / 255 };
  }
  regionAt(x, z) {
    let best = REGIONS[0], bd = 1e18;
    for (const r of REGIONS) { const dd = (r.x - x) ** 2 + (r.z - z) ** 2; if (dd < bd) { bd = dd; best = r; } }
    return best;
  }
  rng(seed) { return mulberry32(this.seed * 31 + seed); }
}
