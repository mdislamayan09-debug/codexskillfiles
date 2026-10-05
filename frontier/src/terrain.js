// GPU-displaced, instanced chunk-LOD terrain with a procedural splat shader.
import * as THREE from 'three';
import { U, GLSL_COMMON, patchMaterial } from './shared.js';
import { WORLD_SIZE, HALF } from './world.js';

const CHUNK = 128;
const N_CHUNKS = WORLD_SIZE / CHUNK;
const LODS = [64, 32, 16, 8, 4];
const LOD_DIST = [200, 480, 1100, 2400, 1e9];

function makeLodGeometry(seg, skirtDepth) {
  // positions: x,z in [0,1] grid; y = skirt flag
  const verts = [];
  const idx = [];
  const row = seg + 1;
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) verts.push(i / seg, 0, j / seg);
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirts
  const edge = (list) => {
    const base = verts.length / 3;
    for (const [i, j] of list) verts.push(i / seg, skirtDepth, j / seg);
    for (let k = 0; k < list.length - 1; k++) {
      const a0 = list[k][1] * row + list[k][0], a1 = list[k + 1][1] * row + list[k + 1][0];
      const s0 = base + k, s1 = base + k + 1;
      idx.push(a0, a1, s0, a1, s1, s0, a0, s0, a1, a1, s0, s1); // double sided
    }
  };
  const top = [], bot = [], lef = [], rig = [];
  for (let i = 0; i <= seg; i++) { top.push([i, 0]); bot.push([i, seg]); lef.push([0, i]); rig.push([seg, i]); }
  edge(top); edge(bot); edge(lef); edge(rig);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  const maxInst = N_CHUNKS * N_CHUNKS;
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(maxInst * 2), 2);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aChunk', inst);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute vec2 aChunk;
uniform float uChunk;
`;
const VERT_BODY = /* glsl */ `
  vec2 wxz = aChunk + position.xz * uChunk;
  float hgt = heightAt(wxz) - position.y;
  vec3 transformed = vec3(wxz.x, hgt, wxz.y);
`;
const BEGIN_NORMAL = /* glsl */ `
  vec3 objectNormal = normalAt(aChunk + position.xz * uChunk);
`;

export const TERRAIN_FRAG_HEAD = /* glsl */ `
// ground scans packed as texture arrays (layer order matches TERRAIN_LAYERS in assets.js)
uniform highp sampler2DArray tAlb;
uniform highp sampler2DArray tNrm;
#define L_GRASS 0.0
#define L_DIRT 1.0
#define L_ROCK 2.0
#define L_SNOW 3.0
#define L_BED 4.0
#define L_GRAVEL 5.0
#define L_SAND 6.0
#define L_LITTER 7.0
vec3 srgb(vec3 c){ return pow(c/255.0, vec3(2.2)); }
float lumi(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float gTRough = 0.9;
vec3 gTNormal = vec3(0.0,1.0,0.0);
vec3 gTN = vec3(0.0, 0.0, 1.0);   // blended tangent-space normal from the photo maps
// two scales, blended by noise, so the 512 px scans never show a tiling grid
vec4 texA(float l, vec2 xz, float s1, float s2){
  vec4 a = texture(tAlb, vec3(xz / s1, l));
  vec4 b = texture(tAlb, vec3(xz / s2 + vec2(0.37, 0.71), l));
  return mix(a, b, smoothstep(0.3, 0.7, vnoise(xz / 23.0)) * 0.65);
}
vec3 texN(float l, vec2 xz, float s){ return texture(tNrm, vec3(xz / s, l)).xyz * 2.0 - 1.0; }
// triplanar for cliffs
vec4 triA(float l, vec3 wp, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture(tAlb, vec3(wp.zy / s, l)) * w.x + texture(tAlb, vec3(wp.xz / s, l)) * w.y + texture(tAlb, vec3(wp.xy / s, l)) * w.z;
}
vec3 triN(float l, vec3 wp, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return (texture(tNrm, vec3(wp.zy / s, l)).xyz * w.x + texture(tNrm, vec3(wp.xz / s, l)).xyz * w.y + texture(tNrm, vec3(wp.xy / s, l)).xyz * w.z) * 2.0 - 1.0;
}
vec3 terrainAlbedo(vec3 wp, vec3 n, out float rough){
  vec2 xz = wp.xz;
  vec4 sp = splatAt(xz);
  float road = sp.r, wet = sp.g, forest = sp.b, town = sp.a;
  vec4 cl = climateAt(xz);
  float snowC = cl.r, jun = cl.g, aut = cl.b, des = cl.a;
  float pineK = smoothstep(-700.0, -1300.0, wp.z) * (1.0 - snowC);   // needle litter on the pine belt
  float slope = 1.0 - n.y;
  float macro = fbm2(xz/380.0);
  float mid = fbm2(xz/45.0 + 7.0);
  // metres per pixel: noise finer than the pixel footprint fades to its mean instead of aliasing into speckle
  float fp = length(fwidth(xz));
  float micro = mix(0.5, vnoise(xz*1.7) * 0.5 + vnoise(xz*6.3)*0.5, smoothstep(1.2, 0.3, fp));
  float patchy = mix(0.45, fbm2(xz/11.0 + 3.0), smoothstep(9.0, 3.0, fp));
  float D = smoothstep(420.0, 60.0, length(wp - cameraPosition)); // 1 near, 0 far

  vec4 gA = texA(L_GRASS, xz, 2.6, 6.9);
  vec4 dA = texA(L_DIRT, xz, 2.2, 5.7);
  vec3 gN = texN(L_GRASS, xz, 2.6);
  vec3 dN = texN(L_DIRT, xz, 2.2);

  // grass: an art-directed palette per climate, with luminance detail from the scan
  vec3 lush = mix(srgb(vec3(72,86,44)), srgb(vec3(98,106,52)), mid);
  vec3 dry = mix(srgb(vec3(146,128,72)), srgb(vec3(122,116,64)), mid);
  vec3 grass = mix(lush, dry, smoothstep(0.42, 0.68, macro + 0.15*patchy));
  grass = mix(grass, mix(srgb(vec3(88,96,58)), srgb(vec3(108,102,66)), mid), pineK * 0.6);      // high-country grass
  grass = mix(grass, mix(srgb(vec3(150,114,56)), srgb(vec3(172,126,60)), mid) * (0.9 + 0.2 * patchy), aut); // autumn gold
  grass = mix(grass, mix(srgb(vec3(42,70,25)), srgb(vec3(62,90,32)), mid), jun);                // jungle
  grass *= mix(0.82 + 0.3*micro, clamp(lumi(gA.rgb) / 0.11, 0.4, 1.6), 0.8 * D);
  grass = mix(grass, srgb(vec3(150,140,90)), smoothstep(0.78,0.9, vnoise(xz*0.9+11.0))*0.3 * smoothstep(2.5, 0.8, fp) * (1.0 - jun));

  // forest floor: needle and leaf litter, tinted per biome
  vec4 lA = texA(L_LITTER, xz, 1.8, 4.6);
  vec3 lN = texN(L_LITTER, xz, 1.8);
  vec3 litTint = mix(vec3(0.95, 0.82, 0.7), vec3(0.92, 0.7, 0.5), pineK);
  litTint = mix(litTint, vec3(1.3, 0.72, 0.34), aut);
  litTint = mix(litTint, vec3(0.5, 0.62, 0.32), jun);
  vec3 forestFloor = mix(mix(srgb(vec3(66,56,38)), srgb(vec3(58,66,34)), patchy) * (0.8 + 0.3*micro), lA.rgb * litTint * 1.15, 0.85 * max(D, 0.45));
  // dirt and roads straight from the scans (slightly graded toward the palette)
  vec3 dirt = mix(srgb(vec3(104,80,56)), dA.rgb * vec3(1.0, 0.95, 0.88), 0.85 * D + 0.15);
  dirt = mix(dirt, dirt * vec3(1.12, 0.9, 0.72), des);
  vec3 roadC = dirt * 1.08;
  if (road > 0.05) {
    vec4 gv = texA(L_GRAVEL, xz, 1.8, 4.3);
    roadC = mix(roadC, gv.rgb * vec3(0.95, 0.88, 0.78), 0.35 * D);
  }
  vec3 mud = srgb(vec3(62,52,40)) * (0.85+0.25*micro);
  vec3 mN = vec3(0.0, 0.0, 1.0);
  float shore = smoothstep(2.4, 0.4, wp.y);
  if (max(wet * 0.55, shore) > 0.02 || town > 0.5) {
    // wet mud: the dirt scan darkened and smoothed over by water
    mud = mix(mud, dA.rgb * vec3(0.5, 0.46, 0.4), 0.8 * D);
    mN = dN * vec3(0.4, 0.4, 1.0);
  }
  float rockAmt = smoothstep(0.28, 0.45, slope + (mid-0.5)*0.25);
  rockAmt = max(rockAmt, smoothstep(200.0, 280.0, wp.y + mid*60.0) * smoothstep(0.1, 0.22, slope));
  vec3 rock = mix(srgb(vec3(96,92,86)), srgb(vec3(70,68,66)), fbm2(xz/7.0));
  rock *= 0.8 + 0.4 * smoothstep(0.3, 0.7, fbm2(vec2(xz.x+xz.y, wp.y*3.0)/9.0)); // strata
  rock = mix(rock, srgb(vec3(124,104,84)), smoothstep(0.55,0.75,fbm2(vec2(xz.x/30.0, wp.y/6.0))));
  vec3 rN = vec3(0.0, 0.0, 1.0);
  if (rockAmt > 0.01) {
    vec4 rA = triA(L_ROCK, wp, n, 5.5);
    rock *= mix(0.75 + 0.4*micro, clamp(lumi(rA.rgb) / 0.13, 0.35, 2.2), 0.85 * max(D, 0.35));
    // the same scan at cliff scale so distant faces keep veins and ledges instead of smooth grey
    vec4 rB = triA(L_ROCK, wp, n, 140.0);
    rock *= mix(1.0, clamp(lumi(rB.rgb) / 0.13, 0.45, 1.7), 0.7 * (1.0 - D));
    rN = triN(L_ROCK, wp, n, 5.5);
  } else rock *= 0.75 + 0.4*micro;
  // desert mesas: banded red sandstone
  if (des > 0.01) {
    // strata of irregular thickness that wander along the cliff, streaked by runoff
    float sy = wp.y / 7.5 + 1.1 * fbm2(xz / 70.0) + 0.25 * vnoise(xz / 9.0);
    float band = smoothstep(0.2, 0.8, fract(sy)) * 0.6 + 0.4 * smoothstep(0.35, 0.65, fract(sy * 2.7 + 0.3));
    float streak = smoothstep(0.45, 0.75, vnoise(vec2((xz.x + xz.y) * 0.35, wp.y * 0.015)));
    vec3 red = mix(srgb(vec3(160,88,54)), srgb(vec3(200,138,90)), band) * (0.85 + 0.3 * fbm2(vec2(xz.x + xz.y, wp.y * 4.0) / 11.0)) * (1.0 - 0.28 * streak);
    rock = mix(rock, red * clamp(lumi(rock) / 0.09, 0.5, 1.5), des);
  }
  // cold granite reads darker and bluer under snow, like wet rock in a storm
  rock = mix(rock, rock * vec3(0.62, 0.66, 0.74), snowC);

  vec3 snow = srgb(vec3(232,236,242));
  vec3 snowT = texA(L_SNOW, xz, 4.0, 9.7).rgb;
  snow = mix(snow, snowT * 1.15, 0.6);
  // snow settles on gentle ground; cliffs and steep faces stay bare rock with snow on ledges
  // snow follows the slope: it holds on ledges and benches (where the relief normal flattens) and sheds off
  // steep faces, instead of lying in noise-shaped blotches
  float snowAmt = smoothstep(0.3, 0.7, snowC + 0.12 * (fbm2(xz / 18.0) - 0.5)) * (1.0 - smoothstep(0.36, 0.56, slope + 0.08 * (vnoise(xz / 2.0) - 0.5)));
  // wind-scoured knolls: frosted rock and dry grass breaking through on exposed slopes
  float scour = smoothstep(0.6, 0.72, fbm2(xz / 16.0 + 2.7) + slope * 0.6) * smoothstep(0.08, 0.2, slope);
  snowAmt *= 1.0 - 0.5 * scour * smoothstep(0.3, 0.6, snowC);
  rockAmt = max(rockAmt, scour * smoothstep(0.3, 0.6, snowC) * 0.8);
  // desert sand and coastal beaches
  vec4 sA = texA(L_SAND, xz, 3.0, 8.0);
  vec3 sN = texN(L_SAND, xz, 3.0);
  vec3 sand = mix(srgb(vec3(196,168,124)), sA.rgb * vec3(1.06, 1.0, 0.92), 0.8 * D + 0.2);
  sand = mix(sand, sand * vec3(1.08, 0.88, 0.72), des * 0.6);
  float coastal = max(max(jun, des), max(smoothstep(2900.0, 3400.0, wp.z), smoothstep(3100.0, 3500.0, wp.x)));
  float beach = smoothstep(3.2, 1.4, wp.y) * coastal * (1.0 - smoothstep(0.4, 0.7, wet));

  vec3 c = grass; rough = 0.92;
  vec3 tn = gN;
  float ff = smoothstep(0.25, 0.75, forest);
  c = mix(c, forestFloor, ff); tn = mix(tn, lN, ff);
  // desert flats: sand with scattered dry scrub ground
  float desG = des * (1.0 - 0.35 * smoothstep(0.55, 0.75, patchy));
  c = mix(c, sand, desG); tn = mix(tn, sN, desG); rough = mix(rough, 0.95, desG);
  float dirtAmt = smoothstep(0.55, 0.95, patchy + 0.25*town) * (0.35 + 0.65*town) * (1.0 - jun * 0.7) * (1.0 - des);
  dirtAmt = max(dirtAmt, smoothstep(0.55, 0.9, town) * (0.82 + 0.18 * micro));
  c = mix(c, dirt, dirtAmt); tn = mix(tn, dN, dirtAmt);
  float rr = smoothstep(0.35, 0.75, road + (micro-0.5)*0.25);
  c = mix(c, roadC, rr); tn = mix(tn, dN, rr);
  float crown = smoothstep(0.93, 0.995, road) * (1.0 - town) * smoothstep(0.35, 0.6, vnoise(xz * 0.7)) * (1.0 - des);
  c = mix(c, grass * 0.85, crown * 0.75);
  c *= 1.0 - rr*0.12*smoothstep(0.6,1.0,sin(xz.x*1.4+xz.y*0.4)*0.5+0.5);
  // town street: twin wheel ruts per lane, hoof-churned mud and puddles
  float street = smoothstep(0.5, 0.9, town) * smoothstep(11.0, 8.0, abs(xz.y)) * step(abs(xz.x), 150.0);
  float lanes = 0.0;
  for (int k = 0; k < 4; k++) {
    float zc = (float(k) - 1.5) * 2.6 + (vnoise(vec2(xz.x*0.05, float(k)*7.0)) - 0.5) * 0.8;
    lanes = max(lanes, smoothstep(0.32, 0.08, abs(xz.y - zc)));
  }
  float hoof = smoothstep(0.62, 0.8, vnoise(xz * 3.3)) * 0.5;
  c = mix(c, mix(roadC * 0.62, mud * 1.3, 0.5), street * max(lanes * 0.8, hoof));
  tn = mix(tn, mN, street * lanes * 0.7);
  float puddle = street * smoothstep(0.66, 0.74, fbm2(xz * 0.22 + 4.0));
  c = mix(c, mud * 0.55, puddle);
  tn = mix(tn, vec3(0.0, 0.0, 1.0), puddle);
  rough = mix(rough, 0.08, puddle);
  float sh = max(wet*0.55, shore)*(1.0-rr) * (1.0 - beach) * (1.0 - snowC);
  c = mix(c, mud, sh); tn = mix(tn, mN, sh);
  rough = mix(rough, 0.45, shore * (1.0 - beach));
  // river and lake beds: rounded pebbles under the shallows (not in the bayou)
  float bed = smoothstep(0.3, -0.7, wp.y) * (1.0 - smoothstep(500.0, 900.0, xz.x) * smoothstep(650.0, 1000.0, xz.y)) * (1.0 - coastal);
  if (bed > 0.01) {
    vec4 bA = texA(L_BED, xz, 1.7, 4.4);
    c = mix(c, bA.rgb * vec3(0.72, 0.7, 0.62), bed * 0.9);
    tn = mix(tn, texN(L_BED, xz, 1.7), bed);
    rough = mix(rough, 0.5, bed);
  }
  // beaches and sandy shallows along the coast
  float sandK = max(beach, smoothstep(0.5, -1.0, wp.y) * coastal);
  c = mix(c, sand * mix(1.0, 0.72, smoothstep(0.6, -0.4, wp.y)), sandK); tn = mix(tn, sN, sandK);
  rough = mix(rough, mix(0.9, 0.35, smoothstep(1.0, 0.2, wp.y)), sandK);
  c = mix(c, srgb(vec3(58,66,40)) * (0.8+0.3*micro), smoothstep(60.0, 140.0, wp.y) * (1.0 - rockAmt) * 0.6 * (1.0 - jun) * (1.0 - des) * (1.0 - aut));
  c = mix(c, rock, rockAmt); tn = mix(tn, rN, rockAmt);
  rough = mix(rough, 0.82, rockAmt);
  c = mix(c, snow, snowAmt); tn = mix(tn, mix(vec3(0.0, 0.0, 1.0), texN(L_SNOW, xz, 4.0), 0.5), snowAmt);
  rough = mix(rough, 0.6, snowAmt);
  if (snowAmt > 0.01) {
    // wind-packed ripples and soft drifts, so open snow reads as a surface rather than a white sheet
    vec2 wdir = vec2(0.93, 0.36);
    float ph = dot(xz, wdir) * 1.7 + fbm2(xz * 0.2) * 7.0;
    float rip = sin(ph) * smoothstep(3.0, 0.6, fp);
    float drift = fbm2(xz / 11.0);
    vec2 dg = wdir * rip * 0.2 * mix(0.3, 1.0, drift) + (vec2(fbm2(xz / 6.0 + 1.3), fbm2(xz / 6.0 - 2.1)) - 0.45) * 0.4;
    tn = normalize(mix(tn, normalize(vec3(-dg, 1.0)), snowAmt));
    c *= mix(1.0, 0.9 + 0.14 * drift, snowAmt);
  }
  // frozen falls: blue-white ice streaks hanging down cold cliff faces
  if (snowC > 0.3 && slope > 0.4) {
    float fallN = vnoise(vec2((xz.x + xz.y) * 0.09, wp.y * 0.004)) * 0.7 + vnoise(vec2((xz.x - xz.y) * 0.31, wp.y * 0.02)) * 0.3;
    float icefall = smoothstep(0.3, 0.7, snowC) * smoothstep(0.45, 0.75, slope) * smoothstep(0.6, 0.72, fallN);
    c = mix(c, srgb(vec3(196,214,226)) * (0.8 + 0.3 * vnoise(vec2((xz.x + xz.y) * 1.3, wp.y * 0.3))), icefall * 0.9);
    rough = mix(rough, 0.25, icefall);
  }
  // the frozen creek in Frostwater Valley
  float cold = smoothstep(0.5, 0.8, snowC);
  float openW = smoothstep(0.85, 0.97, wet) * cold;                 // dark meltwater in the main channel
  float ice = smoothstep(0.4, 0.65, wet) * cold * (1.0 - openW);    // iced-over braids
  c = mix(c, mix(snow, srgb(vec3(150,170,182)), 0.55 + 0.25 * vnoise(xz * 0.6)), ice); tn = mix(tn, vec3(0.0, 0.0, 1.0), ice);
  rough = mix(rough, 0.1, ice);
  c = mix(c, srgb(vec3(22,30,36)), openW); tn = mix(tn, vec3(0.0, 0.0, 1.0), openW); rough = mix(rough, 0.04, openW);
  gTN = normalize(mix(vec3(0.0, 0.0, 1.0), tn, 0.9 * D));
  return c;
}
`;

export class Terrain {
  constructor(world, scene, surf = null, quality = 1) {
    this.surf = surf;
    this.lodScale = quality > 1 ? 1.45 : 1;
    this.world = world;
    this.meshes = [];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    patchMaterial(mat, {
      sunShadow: true,
      vertexHead: VERT_HEAD,
      vertexBody: VERT_BODY,
      beginNormal: BEGIN_NORMAL,
      fragHead: TERRAIN_FRAG_HEAD,
      fragColor: /* glsl */ `
        #include <color_fragment>
        vec3 nW = normalAt(vWPos.xz);
        // detail bump
        float e = 0.15;
        vec2 bx = vWPos.xz;
        float b0 = fbm2(bx*1.3), b1 = fbm2((bx+vec2(e,0.0))*1.3), b2 = fbm2((bx+vec2(0.0,e))*1.3);
        float camD = length(vWPos - cameraPosition);
        float bumpS = 0.9 * smoothstep(120.0, 10.0, camD) * 0.4;
        nW = normalize(nW + vec3(b0-b1, 0.0, b0-b2) * bumpS * 1.8);
        // far-field rock relief on steep high ground: gullies, buttresses and strata the
        // 2.7 m heightfield can't carry, so mountains read eroded rather than smooth cones
        {
          float steep = smoothstep(0.12, 0.4, 1.0 - nW.y) * smoothstep(60.0, 160.0, vWPos.y);
          if (steep > 0.0) {
            float E = 3.0;
            vec2 q = vWPos.xz;
            float g0 = fbm2(q / 22.0 + vec2(0.0, vWPos.y / 30.0)) + 0.5 * fbm2(q / 7.0);
            float gx = fbm2((q + vec2(E, 0.0)) / 22.0 + vec2(0.0, vWPos.y / 30.0)) + 0.5 * fbm2((q + vec2(E, 0.0)) / 7.0);
            float gz = fbm2((q + vec2(0.0, E)) / 22.0 + vec2(0.0, vWPos.y / 30.0)) + 0.5 * fbm2((q + vec2(0.0, E)) / 7.0);
            nW = normalize(nW + vec3(g0 - gx, 0.0, g0 - gz) * steep * 3.5);
          }
        }
        float tr;
        diffuseColor.rgb = terrainAlbedo(vWPos, nW, tr);
        {
          vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - nW * nW.x);
          vec3 Bg = cross(Tg, nW);
          nW = normalize(Tg * gTN.x + Bg * gTN.y + nW * gTN.z);
        }
        // distant forests read as a canopy mass (impostors thin out with distance)
        {
          float fo = splatAt(vWPos.xz).b;
          float canopyK = smoothstep(0.3, 0.65, fo) * smoothstep(180.0, 420.0, camD) * (0.55 + 0.45 * smoothstep(850.0, 1250.0, camD));
          float cfp = length(fwidth(vWPos.xz));
          vec3 canopy = mix(srgb(vec3(34,46,26)), srgb(vec3(52,62,32)), mix(0.47, fbm2(vWPos.xz/18.0), smoothstep(14.0, 5.0, cfp)))
                      * mix(0.95, 0.7 + 0.5*vnoise(vWPos.xz/4.0), smoothstep(5.0, 1.5, cfp));
          canopy = mix(canopy, srgb(vec3(30,40,30)), smoothstep(80.0, 200.0, vWPos.y) * 0.6);
          vec4 ccl = climateAt(vWPos.xz);
          float cn = mix(0.5, fbm2(vWPos.xz / 26.0 + 4.0), smoothstep(14.0, 5.0, cfp));
          canopy = mix(canopy, mix(srgb(vec3(26,50,20)), srgb(vec3(40,68,26)), cn), ccl.g);                       // jungle
          canopy = mix(canopy, mix(srgb(vec3(124,58,22)), srgb(vec3(158,112,32)), cn) * mix(1.0, 0.55, step(0.7, cn)), ccl.b * 0.85); // autumn
          canopy = mix(canopy, mix(canopy, srgb(vec3(196,204,212)), 0.5), smoothstep(0.4, 0.8, ccl.r));             // snow-laden firs
          diffuseColor.rgb = mix(diffuseColor.rgb, canopy, canopyK);
          tr = mix(tr, 1.0, canopyK);
        }
        gTRough = tr;
        gTNormal = nW;
      `,
      onShader: (shader) => {
        shader.uniforms.uChunk = { value: CHUNK };
        const S = this.surf || {};
        shader.uniforms.tAlb = { value: S.terrainAlb || null };
        shader.uniforms.tNrm = { value: S.terrainNrm || null };
        this.shaders.push(shader);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gTRough;')
          .replace('#include <normal_fragment_begin>', `
            #include <normal_fragment_begin>
            normal = normalize((viewMatrix * vec4(gTNormal, 0.0)).xyz);
            nonPerturbedNormal = normal;
          `);
      },
    });
    this.shaders = [];
    this.material = mat;
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.uniforms.uChunk = { value: CHUNK };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', VERT_BODY);
    };
    LODS.forEach((seg, li) => {
      const g = makeLodGeometry(seg, 2 * Math.pow(2, li));
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = li <= 1;
      m.customDepthMaterial = depthMat;
      scene.add(m);
      this.meshes.push(m);
    });
    // chunk bounds for culling
    this.bounds = [];
    for (let cz = 0; cz < N_CHUNKS; cz++) for (let cx = 0; cx < N_CHUNKS; cx++) {
      const x0 = -HALF + cx * CHUNK, z0 = -HALF + cz * CHUNK;
      let mn = 1e9, mx = -1e9;
      for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
        const h = world.heightAt(x0 + (i / 8) * CHUNK, z0 + (j / 8) * CHUNK);
        mn = Math.min(mn, h); mx = Math.max(mx, h);
      }
      this.bounds.push(new THREE.Box3(new THREE.Vector3(x0, mn - 12, z0), new THREE.Vector3(x0 + CHUNK, mx + 4, z0 + CHUNK)));
    }
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }

  update(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const counts = LODS.map(() => 0);
    const arrays = this.meshes.map((m) => m.geometry.attributes.aChunk.array);
    const cx = camera.position.x, cz = camera.position.z;
    for (let k = 0; k < this.bounds.length; k++) {
      const b = this.bounds[k];
      if (!this._frustum.intersectsBox(b)) continue;
      const mx = Math.max(b.min.x - cx, 0, cx - b.max.x), mz = Math.max(b.min.z - cz, 0, cz - b.max.z);
      const d = Math.hypot(mx, mz, Math.max(0, camera.position.y - b.max.y) * 0.5);
      let l = 0;
      while (d > LOD_DIST[l] * this.lodScale) l++;
      const a = arrays[l];
      a[counts[l] * 2] = b.min.x; a[counts[l] * 2 + 1] = b.min.z;
      counts[l]++;
    }
    this.meshes.forEach((m, l) => {
      m.geometry.instanceCount = counts[l];
      const at = m.geometry.attributes.aChunk;
      at.clearUpdateRanges();
      at.addUpdateRange(0, counts[l] * 2);
      at.needsUpdate = true;
    });
  }
}
