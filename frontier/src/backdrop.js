// Distant country beyond the edge of the map: a square ring of terrain from the world's edge out to ~70 km that
// carries on whatever lies at each edge — the snowy Rockies to the north, mesas and sierras to the south-west,
// forested ridges elsewhere, open sea off the jungle coast — so every vista ends in layered ranges stepping back
// into the haze instead of a hard horizon. The shared atmosphere does the layering; patchMaterial's far-depth
// squeeze keeps it inside the far plane.
import * as THREE from 'three';
import { patchMaterial } from './shared.js';
import { HALF, WATER_LEVEL } from './world.js';

const fract = (x) => x - Math.floor(x);
const hash = (ix, iz) => fract(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
// octaves are rotated against each other so no grid shows in the ridgelines
const ROT = [Math.cos(0.62), Math.sin(0.62)];
function fbm(x, z, o = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < o; i++) { s += a * vnoise(x, z); const nx = (x * ROT[0] - z * ROT[1]) * 2.03 + 1.7, nz = (x * ROT[1] + z * ROT[0]) * 2.03 + 9.2; x = nx; z = nz; a *= 0.5; }
  return s / (1 - Math.pow(0.5, o));
}
// sharp-crested ranges: ridged multifractal, each octave weighted by the one above so peaks get the detail
function ridged(x, z, o = 6) {
  let s = 0, a = 0.5, w = 1, norm = 0;
  for (let i = 0; i < o; i++) {
    let n = 1 - Math.abs(vnoise(x, z) * 2 - 1); n *= n; n *= w; w = Math.min(1, n * 1.8);
    s += a * n; norm += a;
    const nx = (x * ROT[0] - z * ROT[1]) * 2.07 + 3.1, nz = (x * ROT[1] + z * ROT[0]) * 2.07 - 4.7; x = nx; z = nz; a *= 0.5;
  }
  return s / norm;
}

export class Backdrop {
  constructor(world, scene, quality = 1) {
    const SEG = quality >= 2 ? 2048 : 1024, RINGS = quality >= 2 ? 256 : 128, H0 = HALF - 40, R1 = 70000;
    const nV = SEG * (RINGS + 1);
    const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3);
    const info = new Float32Array(nV * 4);     // per vertex: north, desert, sea, hills weights (for the colour pass)
    const perim = (u) => {
      const t = u * 4, side = Math.floor(t) % 4, f = t - Math.floor(t);
      return side === 0 ? [-1 + 2 * f, -1] : side === 1 ? [1, -1 + 2 * f] : side === 2 ? [1 - 2 * f, 1] : [-1, 1 - 2 * f];
    };
    const SPURS = [[1800, 200, 1], [3200, 300, -1], [5000, 430, 1], [7400, 620, -1], [10500, 900, 1], [15000, 1300, -1]];
    const NOSPURS = typeof location !== 'undefined' && /[?&]nospurs\b/.test(location.search);
    for (let i = 0; i < SEG; i++) {
      const [ux, uz] = perim(i / SEG);
      const ex = ux * (HALF - 6), ez = uz * (HALF - 6);
      const eh = world.heightAt(ex, ez);
      // which country lies at this stretch of the edge
      const north = sstep(-1300, -2300, ez);
      const desert = sstep(-1200, -1800, ex) * sstep(1100, 1700, ez) * (1 - north);
      const sea = sstep(3, -8, eh) * (1 - north) * (1 - desert);
      const autumn = sstep(-1500, -2200, ex) * sstep(-2000, -1600, ez) * sstep(1300, 900, ez);
      const hills = Math.max(0, 1 - north - desert - sea);
      for (let k = 0; k <= RINGS; k++) {
        const s = H0 + (R1 - H0) * Math.pow(k / RINGS, 2.4);   // dense near the map, where the ranges are seen up close
        const x = ux * s, z = uz * s, d = Math.max(0, s - HALF);
        // the snowy north: big ridged ranges, taller the further they stand
        const far = sstep(4000, 40000, d);
        // (the finer ridged layers give the near ranges spurs, gullies and arêtes instead of smooth snow domes;
        // the big massifs stay modest right at the map's edge so no single dome walls off the view up the valley,
        // and step up range behind range into the distance)
        const snowH = 260 + ridged(x / 9000 + 3.3, z / 9000 - 1.2) * 1750 * (0.55 + 0.45 * fbm(x / 26000, z / 26000, 3)) * (0.85 + 0.5 * far) * (0.32 + 0.68 * sstep(1500, 12000, d))
          + ridged(x / 2400, z / 2400 + 7.7, 4) * 460 + ridged(x / 900 - 2.2, z / 900, 3) * 170;
        // forested ridge country, rolling up into a far blue sierra
        const hillH = 110 + fbm(x / 6000 + 5.1, z / 6000, 5) * 520 + ridged(x / 2100, z / 2100, 4) * 150 + ridged(x / 11000, z / 11000, 5) * 900 * far;
        // canyon country: flat-topped mesas and buttes on a desert floor, sierras on the far horizon
        const n = fbm(x / 4300 + 11.3, z / 4300 - 2.1, 5);
        const desertH = 45 + fbm(x / 1500, z / 1500, 3) * 40 + sstep(0.5, 0.525, n) * 230 + sstep(0.62, 0.64, n) * 170
          + ridged(x / 9000 - 4.4, z / 9000, 5) * 650 * far;
        const seaH = WATER_LEVEL - 0.7;
        // north of the map the real valley carries on: a broad snowy floor winding away between the ranges
        // for twenty kilometres, so looking up-valley the eye travels into the haze rather than into a wall
        const dn = Math.max(0, -HALF - z);
        // (bearing north-west: the summit lookout above the homestead looks that way, up the valley to the horizon)
        const vx = -725 - 0.5 * dn + 450 * Math.sin(dn / 6000) * sstep(2000, 8000, dn) - 800 * Math.sin(dn / 15000 + 1.2) * sstep(6000, 14000, dn);
        const vw = 560 + 0.07 * dn;
        const floor = 210 + dn * 0.01 + 30 * fbm(x / 1500, z / 1500, 3);
        // (walls rising within a kilometre or so of the floor: a bowl three kilometres wide lay beyond the map's edge
        // as smooth white dunes, plain to see from a lookout over the valley's mouth)
        const snowV = floor + Math.max(0, snowH - 180) * sstep(vw * 0.5, vw + 1300, Math.abs(x - vx))
          + 70 * (ridged(x / 430 + 1.7, z / 430 - 6.2, 4) - 0.4) * sstep(vw * 0.6, vw + 700, Math.abs(x - vx)) * sstep(9000, 3000, d);
        // (round 103) interlocking spurs: beyond the map the valley's sides send spurs down across its floor from left and
        // right in turn, each further and higher than the last, so the eye going up the valley meets ridgeline behind
        // ridgeline, paler and paler, instead of one open floor running to a pale wedge at the horizon
        let spur = 0;
        if (dn > 0 && !NOSPURS) for (const [d0, A, sg] of SPURS) {
          const w = 0.2 * d0 + 220, g = Math.exp(-(((dn - d0) / w) ** 2));
          if (g < 0.01) continue;
          // (round 104: each runs down from its own wall to die out past the valley's axis, so its crest is a long slant
          // across the view, and its skyline is a few broad summits. Spanning the valley at full height each was a dam
          // with a level top, and with a tooth every four hundred metres the far ones were a saw blade.)
          const q = (x - vx) * sg / vw, lat = Math.pow(Math.min(1, Math.max(0, (q + 0.8) / 2.6)), 0.75);
          spur = Math.max(spur, A * g * lat * (0.78 + 0.44 * ridged(x / 2600 + d0 * 0.0013, z / 2600, 4)));
        }
        const regionH = north * (snowV + spur) + desert * desertH + sea * seaH + hills * hillH;
        // carry the map's own edge heights out, then rise into the region's relief
        // (in the north the ranges' own relief takes over within a kilometre, and crags stand on the ground between:
        // carried out for 2.6 km, the edge's profile lay beyond the map as smooth extruded dunes)
        const t = sstep(0, 2600 - 1600 * north, d);
        const crag = north * 55 * (ridged(x / 310 + 4.1, z / 310 - 2.7, 4) - 0.42) * sstep(0, 260, d) * sstep(8000, 2500, d);
        const h = eh * (1 - t) + regionH * t + crag - (k === 0 ? 6 : 0);
        const v = i * (RINGS + 1) + k;
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        info[v * 4] = north; info[v * 4 + 1] = desert; info[v * 4 + 2] = sea * t; info[v * 4 + 3] = autumn;
      }
    }
    const idx = new Uint32Array(SEG * RINGS * 6);
    let q = 0;
    for (let i = 0; i < SEG; i++) {
      const i1 = (i + 1) % SEG;
      for (let k = 0; k < RINGS; k++) {
        const a = i * (RINGS + 1) + k, b = i1 * (RINGS + 1) + k, c = a + 1, dd = b + 1;
        // winding so the faces point up (rings run outward, the perimeter runs anticlockwise seen from above)
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = dd;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // make sure the faces point up whatever the winding came out as
    const nrm = geo.attributes.normal;
    let up = 0; for (let v = 0; v < nV; v += 97) up += nrm.getY(v);
    if (up < 0) {
      for (let j = 0; j < idx.length; j += 3) { const tmp = idx[j + 1]; idx[j + 1] = idx[j + 2]; idx[j + 2] = tmp; }
      geo.index.needsUpdate = true; geo.computeVertexNormals();
    }
    // colour: snowfields with dark timber and bare rock in the north, red rock and sand in the south-west,
    // dark forest with autumn rust in the ridge country, deep water off the coast
    const SNOW = [0.74, 0.77, 0.82], ROCK = [0.1, 0.098, 0.095], TIMBER = [0.02, 0.03, 0.027], SNOWTIMBER = [0.2, 0.22, 0.23];
    const FOREST = [0.03, 0.045, 0.022], RUST = [0.11, 0.045, 0.014], MEADOW = [0.1, 0.095, 0.045];
    const SAND = [0.4, 0.22, 0.11], REDROCK = [0.26, 0.1, 0.04], SEA = [0.008, 0.032, 0.062];
    const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let v = 0; v < nV; v++) {
      const x = pos[v * 3], h = pos[v * 3 + 1], z = pos[v * 3 + 2], ny = nrm.getY(v);
      const north = info[v * 4], desert = info[v * 4 + 1], sea = info[v * 4 + 2], autumn = info[v * 4 + 3];
      const hills = Math.max(0, 1 - north - desert - sea);
      const m = fbm(x / 1700, z / 1700, 4);
      // north: timber in the valleys and on the lower slopes, snow above, rock on the steep faces
      // (closed timber on the valley floors and lower slopes, thinning to a treeline, as on the map itself)
      const timber = Math.max(sstep(0.42, 0.62, m) * sstep(1050, 700, h + (m - 0.5) * 300), (0.45 + 0.55 * sstep(0.3, 0.5, m)) * sstep(640, 470, h + (m - 0.5) * 160)) * sstep(0.6, 0.8, ny);
      let cN = mix3(SNOW, mix3(TIMBER, SNOWTIMBER, 0.35), timber * 0.85);
      cN = mix3(cN, ROCK, sstep(0.66, 0.5, ny + (m - 0.5) * 0.15) * 0.85);
      // ridge country
      let cH = mix3(FOREST, MEADOW, sstep(0.62, 0.75, m));
      cH = mix3(cH, RUST, autumn * sstep(0.35, 0.6, fbm(x / 900 + 3, z / 900, 3)) * 0.8);
      cH = mix3(cH, mix3(ROCK, SNOW, sstep(1100, 1400, h)), sstep(900, 1300, h));      // the far sierra's tops
      // canyon country
      let cD = mix3(SAND, REDROCK, sstep(0.82, 0.6, ny));
      cD = mix3(cD, mix3(ROCK, SNOW, sstep(800, 1000, h) * 0.6), sstep(450, 700, h));
      for (let c = 0; c < 3; c++) col[v * 3 + c] = north * cN[c] + desert * cD[c] + sea * SEA[c] + hills * cH[c];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    // per-pixel erosion relief: the mesh carries the ranges' form, the shader cuts gullies and ribs into the faces
    // (faded out once a pixel spans them) and bares dark rock on the steep parts of that relief, so a distant face
    // reads as snow couloirs between rock ribs rather than one smooth shaded dome
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.6 }), {
      onShader: (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float dist = length(vWPos - cameraPosition);
          vec2 p = vWPos.xz;
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          vec2 g = vec2(0.0);
          for (int o = 0; o < 3; o++) {
            float sc = o == 0 ? 210.0 : o == 1 ? 70.0 : 26.0;
            float fd = 1.0 - smoothstep(sc * 0.12, sc * 0.4, dist * 0.0012);
            // stretched down the fall line: gullies run downhill, not in blobs
            vec2 dn2 = normalize(wn.xz + 1e-4);
            vec2 q = vec2(dot(p, vec2(dn2.y, -dn2.x)), dot(p, dn2) * 0.35) / sc + float(o) * 7.3;
            float e = 0.3;
            float gx = vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0));
            float gz = vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e));
            vec2 gl = vec2(gx, gz) / (2.0 * e) * fd * (o == 0 ? 1.0 : o == 1 ? 0.75 : 0.5);
            g += vec2(dn2.y, -dn2.x) * gl.x + dn2 * gl.y * 0.35;
          }
          float steep = 1.0 - wn.y;
          // (fading with distance: under haze its shading was all that showed of a far range, and it read as marbling)
          vec3 pn = normalize(wn - vec3(g.x, 0.0, g.y) * (0.55 + 1.6 * steep) * mix(1.0, 0.3, smoothstep(2500.0, 7000.0, dist)));   // (rock ribs on the gentler faces too)
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
          // timber is trees with snow between them: crowns a few pixels across while they can be told apart
          {
            float lum0 = dot(diffuseColor.rgb, vec3(0.333));
            float tim = smoothstep(0.34, 0.1, lum0) * smoothstep(0.02, 0.05, diffuseColor.b) * step(diffuseColor.r, diffuseColor.b * 1.2);
            float sp = smoothstep(0.42, 0.7, vnoise(p / 6.5) * 0.6 + vnoise(p / 19.0 + 3.1) * 0.4) * (1.0 - smoothstep(4000.0, 9000.0, dist));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.55, 0.62), tim * sp * 0.6);
          }
          float snowy = smoothstep(0.3, 0.55, dot(diffuseColor.rgb, vec3(0.333)));
          float rockT = smoothstep(0.8, 0.6, pn.y + 0.14 * (vnoise(p / 41.0) - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.075, 0.08), rockT * snowy * 0.9);
        }`);
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }
}
