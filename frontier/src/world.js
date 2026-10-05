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
export const FROST_VALLEY = [[-1500, -3950], [-1280, -3560], [-1040, -3160], [-870, -2800], [-770, -2500], [-720, -2250]];
const FROST_FLOOR = [560, 470, 380, 300, 220, 150]; // floor height at each valley point

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
    this.valley = smoothPolyline(FROST_VALLEY, 10);
    // floor height along the valley, resampled onto the smoothed polyline by arc length
    const seg = (pts) => { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; };
    this.valleyLen = seg(this.valley);
    this.valleyTotal = this.valleyLen[this.valleyLen.length - 1];
    this.cabinH = null;
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
      h += mt * (Math.pow(ridge, 1.35) * 950 * massif + 150 * massif + 60 * n2.fbm(x / 350, z / 350, 4));
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
      wall += wv * (1 - wv) * 4 * (85 * cb - 32);
      wall += 28 * smoothstep(0.42, 0.58, n2.fbm(x / 85, z / 85 + 3.7, 2)) * smoothstep(0.15, 0.4, wv);
      h = lerp(h, Math.min(h, wall), smoothstep(700, 380, d.vd));
      // the frozen creek and its braided side channels
      h -= 1.2 * smoothstep(5, 2, d.vd);
    }
    // Desert: terraced red mesas over sand flats
    if (R.desert > 0) {
      const m = n2.fbm(x / 1100 + 20, z / 1100 - 4, 4) + 0.035 * n.fbm(x / 90, z / 90, 3);
      const dh = 12 + 8 * n.fbm(x / 600, z / 600, 3) + 75 * smoothstep(0.1, 0.15, m) + 60 * smoothstep(0.31, 0.35, m) + 2.5 * n.fbm(x / 40, z / 40, 3);
      h = lerp(h, dh, R.desert);
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
      const braid = d && d.vd < 60 ? Math.max(smoothstep(5, 2, d.vd), 0.7 * smoothstep(60, 35, d.vd) * smoothstep(0.6, 0.68, n.noise(x / 34, z / 34) * 0.5 + 0.5)) : 0;
      out.wet = Math.max(smoothstep(rw * 1.9, rw * 0.9, rd), sw * 0.8, smoothstep(1.25, 0.95, ld), braid);
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
    const stamp = (pts, maxD, arr, tArr, lens, total, scale = 1) => {
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
            const dd = Math.sqrt(qx * qx + qz * qz) * scale;
            const k = row + i;
            if (dd < arr[k]) { arr[k] = dd; if (tArr) tArr[k] = (lens[s] + t * (lens[s + 1] - lens[s])) / total; }
          }
        }
      }
    };
    stamp(this.river, 700, rd);
    this.roads.forEach((r, ri) => stamp(r, 24, roadD, null, null, null, ROAD_SCALE[ri] || 1));
    stamp(this.valley, 720, vd, vt, this.valleyLen, this.valleyTotal);
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
        const snowAlt = smoothstep(820, 1000, h + 110 * n.noise(x / 500, z / 500));
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
          const wallBand = smoothstep(85, 150, vd) * smoothstep(430, 300, vd);
          f = Math.max(f, snowLat * wallBand * smoothstep(0.3, 0.48, forest.fbm(x / 240 + 2.2, z / 240, 3) * 0.5 + 0.5) * 0.92 * smoothstep(2.5, 6.5, o.roadD));
          f *= 1 - 0.7 * snowLat * smoothstep(110, 50, vd);
        }
        splat[k * 4 + 0] = o.road * 255;
        splat[k * 4 + 1] = o.wet * 255;
        splat[k * 4 + 2] = f * 255;
        splat[k * 4 + 3] = o.town * 255;
        climate[k * 4 + 0] = snow * 255;
        climate[k * 4 + 1] = o.jungle * (1 - o.ocean * 0.5) * 255;
        climate[k * 4 + 2] = o.autumn * (1 - snow) * 255;
        climate[k * 4 + 3] = o.desert * 255;
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
      const dd = Math.hypot(ax + dx * t - CABIN.x, az + dz * t - CABIN.z);
      if (dd < best) { best = dd; bt = (this.valleyLen[s] + t * (this.valleyLen[s + 1] - this.valleyLen[s])) / this.valleyTotal; }
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
            w.postMessage({ seed: this.seed, res: RES, j0: a, j1: b });
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
        let sum = 0;
        for (let dj = -2; dj <= 2; dj++) { const r = k + dj * RES; sum += H[r - 2] + H[r - 1] + H[r] + H[r + 1] + H[r + 2]; }
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
