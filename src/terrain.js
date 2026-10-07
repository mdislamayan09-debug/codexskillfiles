// GPU-displaced, instanced chunk-LOD terrain with a procedural splat shader.
import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FAR_DEPTH, patchMaterial } from './shared.js';
import { WORLD_SIZE, HALF } from './world.js';

const CHUNK = 128;
const N_CHUNKS = WORLD_SIZE / CHUNK;
const LODS = [64, 32, 16, 8, 4];
const LOD_DIST = [240, 640, 1500, 3200, 1e9];

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
#define L_NEEDLE 8.0
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
vec3 gDbg = vec3(0.0);   // debug view: snow, rock, slope
// the trail ploughed by the horse through deep snow (recent path, oldest first), carved into the snow shading
uniform vec2 uTrail[48];
uniform float uTrailN;
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
  // jungle: not a lawn but a shrub and fern blanket, so from any distance it is mottled with the shade between
  // bushes (a few metres) and the lit and shadowed swells of the thickets (tens of metres)
  {
    float sh = mix(0.5, vnoise(xz / 3.2 + 4.0), smoothstep(2.5, 0.8, fp)) * 0.55 + mix(0.5, fbm2(xz / 14.0 + 9.0), smoothstep(10.0, 3.0, fp)) * 0.45;
    vec3 jg = mix(srgb(vec3(26,44,16)), srgb(vec3(56,78,28)), mid) * (0.55 + 0.85 * sh);
    grass = mix(grass, jg, jun);
  }
  grass *= mix(0.82 + 0.3*micro, clamp(lumi(gA.rgb) / 0.11, 0.4, 1.6), 0.8 * D);
  grass = mix(grass, srgb(vec3(150,140,90)), smoothstep(0.78,0.9, vnoise(xz*0.9+11.0))*0.3 * smoothstep(2.5, 0.8, fp) * (1.0 - jun));

  // forest floor: needle and leaf litter, tinted per biome
  vec4 lA = texA(L_LITTER, xz, 1.8, 4.6);
  vec3 lN = texN(L_LITTER, xz, 1.8);
  // the pine woods have their own needle duff
  if (pineK > 0.01) {
    lA = mix(lA, texA(L_NEEDLE, xz, 1.6, 4.1), pineK);
    lN = mix(lN, texN(L_NEEDLE, xz, 1.6), pineK);
  }
  // (the needle scan carries its own colour; pulled toward brown, the duff is a dark layered floor, not beige sand)
  vec3 litTint = mix(vec3(0.95, 0.82, 0.7), vec3(0.86, 0.74, 0.62), pineK);
  litTint = mix(litTint, vec3(1.3, 0.72, 0.34), aut);
  litTint = mix(litTint, vec3(0.5, 0.62, 0.32), jun);
  vec3 forestFloor = mix(mix(srgb(vec3(66,56,38)), srgb(vec3(58,66,34)), patchy) * (0.8 + 0.3*micro), lA.rgb * litTint * 1.15, 0.85 * max(D, 0.45));
  // rainforest floor: ferns, mosses and seedlings over the litter, deep green
  forestFloor = mix(forestFloor, mix(srgb(vec3(34,54,22)), srgb(vec3(52,74,30)), patchy) * (0.75 + 0.4 * lumi(lA.rgb) / 0.12), jun * 0.75);
  // moss and low green growth in damp hollows of the pine floor
  forestFloor = mix(forestFloor, mix(srgb(vec3(58,70,34)), srgb(vec3(74,84,40)), micro) * (0.75 + 0.4 * lumi(lA.rgb) / 0.12), smoothstep(0.6, 0.78, fbm2(xz / 9.0 + 12.0)) * pineK * 0.45);
  // the open pine floor: a dry duff the low sun rakes across, mottled darker where it lies thick and damp
  forestFloor *= 1.0 - 0.28 * pineK * smoothstep(0.35, 0.7, fbm2(xz / 6.0 + 2.2));
  // close to the lens the duff is a litter of fallen twigs and rusty needle clusters lying every way (drawn here, by
  // the thousand, where the modelled twigs and cones could only ever be a sprinkle on a smooth floor)
  if (pineK > 0.01 && fp < 0.09) {
    float nearK = pineK * smoothstep(0.09, 0.03, fp);
    for (int L = 0; L < 3; L++) {
      float cs = L == 0 ? 0.47 : L == 1 ? 0.21 : 0.11;
      vec2 gc = floor(xz / cs + float(L) * 3.7), gf = fract(xz / cs + float(L) * 3.7) - 0.5;
      vec2 hh = hash22(gc + float(L) * 17.3);
      float ang = hh.x * 6.2832;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 q = gf - (hh.yx - 0.5) * 0.3;
      float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x)) + 0.05 * sin(along * 9.0 + hh.y * 6.0);
      float stick = smoothstep(L == 0 ? 0.03 : 0.06, 0.0, abs(across)) * smoothstep(0.4, 0.3, abs(along)) * step(L == 0 ? 0.5 : 0.35, hash12(gc + 5.1));
      vec3 sc2 = L == 0 ? srgb(vec3(126,110,90)) : L == 1 ? srgb(vec3(104,74,46)) : srgb(vec3(60,46,34));
      forestFloor = mix(forestFloor, sc2 * (0.8 + 0.4 * hh.y), stick * nearK * (L == 2 ? 0.55 : 0.8));
    }
  }
  // dirt and roads straight from the scans (slightly graded toward the palette)
  vec3 dirt = mix(srgb(vec3(104,80,56)), dA.rgb * vec3(1.0, 0.95, 0.88), 0.85 * D + 0.15);
  dirt = mix(dirt, dirt * vec3(1.12, 0.9, 0.72), des);
  vec3 roadC = dirt * 1.08;
  // a dry, dusty tread through the pines, brown dirt rather than a pale road
  roadC = mix(roadC, roadC * vec3(0.8, 0.7, 0.58), pineK);   // (dark, damp woodland dirt: a pale tread read as a sand path)
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
    // mid scale (30-60 m): joints and fracture sets that break a face into blocks and slabs, with dark
    // shadowed cracks and paler weathered blocks; this is what makes distant granite read as rock, not rubber
    {
      vec2 fq = vec2(dot(wp.xz, vec2(0.8, 0.6)), wp.y * 1.6);
      float joints = smoothstep(0.08, 0.0, abs(fract(fq.x / 23.0 + 0.9 * fbm2(fq / 60.0)) - 0.5) - 0.42) * smoothstep(0.3, 0.6, fbm2(fq / 80.0 + 2.0))
                   + smoothstep(0.06, 0.0, abs(fract(fq.y / 17.0 + 0.7 * fbm2(fq / 45.0 + 3.0)) - 0.5) - 0.44);
      float blockT = fbm2(floor(fq / vec2(23.0, 17.0)) * 1.7 + 0.5);
      rock *= mix(1.0, (0.82 + 0.38 * blockT) * (1.0 - 0.45 * clamp(joints, 0.0, 1.0)), (1.0 - D) * 0.85 * smoothstep(0.3, 0.55, slope));
      // desert varnish / water streaks down steep faces
      float streak = smoothstep(0.55, 0.85, fbm2(vec2(dot(wp.xz, vec2(0.6, -0.8)) / 9.0, wp.y / 70.0)));
      rock *= 1.0 - 0.14 * streak * smoothstep(0.45, 0.7, slope);
    }
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
  // jungle ridges: dark wet basalt furred with moss and ferns; vegetation clings to all but the sheerest faces,
  // with red volcanic earth where slides have stripped it
  if (jun > 0.01) {
    vec3 basalt = mix(srgb(vec3(46,48,40)), srgb(vec3(64,72,44)), fbm2(xz / 6.0));
    vec3 redEarth = mix(srgb(vec3(120,62,40)), srgb(vec3(150,84,52)), fbm2(xz / 4.0));
    float slide = smoothstep(0.62, 0.78, fbm2(vec2(xz.x + xz.y * 0.3, wp.y * 0.5) / 22.0)) * smoothstep(0.3, 0.5, slope);
    rock = mix(rock, mix(basalt, redEarth, slide), jun);
    rockAmt *= mix(1.0, smoothstep(0.55, 0.75, slope) + slide * 0.8, jun);
  }
  // cold granite reads darker under snow, but keeps its warm grey-brown (a blue-black rock left the storm frame
  // monochrome where the reference sets warm rock against cool snow)
  rock = mix(rock, rock * vec3(0.5, 0.47, 0.46), snowC);   // (near-black wet rock against the snow, as the reference's faces)

  vec3 snow = srgb(vec3(214,220,230));   // snow is bright but not paper: it should hold detail in sun
  vec3 snowT = texA(L_SNOW, xz, 4.0, 9.7).rgb;
  // the scan only close up (tiled out to the distance it repeats visibly); broad wind-polish and powder variation
  snow = mix(snow, snowT * 1.15, 0.2 + 0.4 * D);
  snow *= 0.93 + 0.1 * fbm2(xz / 37.0 + 2.1) + 0.04 * fbm2(xz / 8.0 - 5.5);
  // snow settles on gentle ground; cliffs and steep faces stay bare rock with snow on ledges
  // snow follows the slope: it holds on ledges and benches (where the relief normal flattens) and sheds off
  // steep faces, instead of lying in noise-shaped blotches
  // high faces are wind-plastered: snow clings to steeper ground up there
  float hiSnow = 0.3 * smoothstep(480.0, 760.0, wp.y + 60.0 * (fbm2(xz / 90.0) - 0.5)) * smoothstep(0.5, 0.8, snowC);
  // curvature: wind strips the convex ribs and crests to rock and packs the snow into gullies and couloirs
  float lapS = 0.0;
  {
    float h0 = heightAt(xz);
    float e1 = 14.0, e2 = 40.0;
    float l1 = (heightAt(xz + vec2(e1, 0.0)) + heightAt(xz - vec2(e1, 0.0)) + heightAt(xz + vec2(0.0, e1)) + heightAt(xz - vec2(0.0, e1))) * 0.25 - h0;
    float l2 = (heightAt(xz + vec2(e2, 0.0)) + heightAt(xz - vec2(e2, 0.0)) + heightAt(xz + vec2(0.0, e2)) + heightAt(xz - vec2(0.0, e2))) * 0.25 - h0;
    lapS = l1 * 0.35 + l2 * 0.45;   // metres: negative on ribs and crests, positive in gullies
  }
  // (weighted to the broader scale and broken up hard: the fine scale alone lines every face with parallel
  // couloirs that read as a comb)
  float ribs = smoothstep(0.15, 1.4, -lapS + 1.4 * (fbm2(xz / 22.0) - 0.5) + 0.5 * (vnoise(xz / 7.0) - 0.5)) * smoothstep(0.08, 0.26, slope) * smoothstep(0.4, 0.75, snowC);
  // (a narrow band, broken by noise: a steep face breaks from snow to rock along a crisp, ragged line)
  float snowAmt = smoothstep(0.3, 0.7, snowC + 0.12 * (fbm2(xz / 18.0) - 0.5)) * (1.0 - smoothstep(mix(mix(0.3, 0.23, snowC), 0.32, hiSnow), mix(mix(0.5, 0.34, snowC), 0.5, hiSnow), slope + 0.1 * (fbm2(xz / 9.0) - 0.5) + 0.06 * (vnoise(xz / 2.0) - 0.5)));
  // wind-scoured knolls: frosted rock and dry grass breaking through on exposed slopes
  // (tighter: broad soft scours and outcrops read as camouflage blotches across a whole mountainside)
  float scour = smoothstep(0.65, 0.74, fbm2(xz / 16.0 + 2.7) + slope * 0.6) * smoothstep(0.08, 0.2, slope);
  // granite outcrops breaking through the snow on moderate mountain slopes, in clusters
  float outcrop = smoothstep(0.6, 0.68, fbm2(xz / 38.0 - 5.1) + 0.6 * slope) * smoothstep(0.12, 0.26, slope) * smoothstep(200.0, 320.0, wp.y);
  scour = max(scour, outcrop);
  snowAmt *= 1.0 - 0.3 * scour * smoothstep(0.3, 0.6, snowC);
  snowAmt *= 1.0 - 0.5 * outcrop * smoothstep(0.3, 0.6, snowC);
  snowAmt *= 1.0 - 0.45 * ribs;
  // wind-scoured crests and summit knolls: the wind strips a convex top to rock and frozen turf with snow only in
  // its hollows (a summit under an unbroken white blanket reads as a model, not a mountain)
  float crest = smoothstep(0.7, 2.0, -lapS + 0.9 * (fbm2(xz / 9.0 + 4.4) - 0.5) + 0.3 * (vnoise(xz / 2.6) - 0.5)) * smoothstep(0.4, 0.75, snowC) * smoothstep(525.0, 590.0, wp.y);   // (the high tops only: lower knolls and spurs keep their snow)
  snowAmt *= 1.0 - 0.75 * crest;
  rockAmt = max(rockAmt, crest * 0.8);
  // erosion relief on the mountainsides: ribs and runnels down the fall line every twenty metres or so, snow packed
  // in the runnels and rock along the ribs between them, so a steep face reads as couloirs and rock bands rather
  // than a smooth white heightfield (faded out once a pixel spans the pattern)
  if (snowC > 0.3 && slope > 0.1) {
    vec2 dnh = normalize(n.xz + 1e-4), prh = vec2(-dnh.y, dnh.x);
    vec2 q = vec2(dot(xz, prh) / 17.0, dot(xz, dnh) / 75.0);
    float rA = 1.0 - abs(2.0 * vnoise(q + vec2(0.0, 0.35 * vnoise(q * 2.1 + 7.0))) - 1.0);
    float rB = 1.0 - abs(2.0 * vnoise(q * vec2(2.3, 1.6) + 4.1) - 1.0);
    float eK = smoothstep(0.12, 0.3, slope) * smoothstep(0.3, 0.7, snowC) * smoothstep(14.0, 5.0, fp);
    float ribE = smoothstep(0.58, 0.82, mix(rA, rB, 0.35)) * eK;
    snowAmt *= 1.0 - 0.4 * ribE;
    rockAmt = max(rockAmt, ribE * 0.5);
  }
  // a used track through the snow stays trampled and dirty: a dark line leading to the homestead
  snowAmt *= 1.0 - 0.55 * smoothstep(0.45, 0.85, road) * smoothstep(0.3, 0.7, snowC);
  rockAmt = max(rockAmt, ribs * 0.55);
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
  // (in the pine belt the open ground along a trail is needle duff too, with grass standing on it in tufts: as
  // lawn it lay beside the tread like a green carpet)
  float ff = max(smoothstep(0.25, 0.75, forest), pineK * 0.88);
  c = mix(c, forestFloor, ff); tn = mix(tn, lN, ff);
  // desert flats: sand with scattered dry scrub ground
  float desG = des * (1.0 - 0.35 * smoothstep(0.55, 0.75, patchy));
  c = mix(c, sand, desG); tn = mix(tn, sN, desG); rough = mix(rough, 0.95, desG);
  float dirtAmt = smoothstep(0.55, 0.95, patchy + 0.25*town) * (0.35 + 0.65*town) * (1.0 - jun * 0.7) * (1.0 - des);
  dirtAmt = max(dirtAmt, smoothstep(0.55, 0.9, town) * (0.82 + 0.18 * micro));
  c = mix(c, dirt, dirtAmt); tn = mix(tn, dN, dirtAmt);
  // (through the pines the tread is a narrow hoof-worn line with needle litter drifted over it in patches, not a
  // graded road)
  float rr = smoothstep(0.35, 0.75, road - 0.2 * pineK + (micro-0.5)*0.25);
  c = mix(c, roadC, rr); tn = mix(tn, dN, rr);
  c = mix(c, forestFloor * 0.92, rr * pineK * 0.75 * smoothstep(0.4, 0.62, fbm2(xz / 2.7 + 5.0) + 0.2 * (micro - 0.5)));
  float crown = smoothstep(0.93, 0.995, road) * (1.0 - town) * smoothstep(0.35, 0.6, vnoise(xz * 0.7)) * (1.0 - des);
  c = mix(c, grass * 0.85, crown * 0.75);
  c *= 1.0 - rr*0.12*smoothstep(0.6,1.0,sin(xz.x*1.4+xz.y*0.4)*0.5+0.5);
  // a used trail up close: hoofprints pressed into it, stones bedded in the tread, roots snaking across in the woods
  if (rr > 0.05 && fp < 0.2) {
    float near = rr * smoothstep(0.2, 0.06, fp) * (1.0 - town);
    vec2 hc = floor(xz / 0.55), hf = fract(xz / 0.55) - 0.5 - (hash22(hc) - 0.5) * 0.4;
    float print = step(0.55, hash12(hc + 3.1)) * smoothstep(0.16, 0.08, length(hf * vec2(1.0, 1.3)));
    c *= 1.0 - 0.28 * print * near;
    vec2 sc = floor(xz / 1.3), sf = fract(xz / 1.3) - 0.5 - (hash22(sc + 9.0) - 0.5) * 0.5;
    float stoneR = 0.08 + 0.12 * hash12(sc + 5.5), sd = length(sf * 1.3);
    float stone = step(0.8, hash12(sc + 7.7)) * smoothstep(stoneR, stoneR * 0.6, sd);
    c = mix(c, srgb(vec3(104,100,92)) * (0.8 + 0.4 * hash12(sc)), stone * near);
    tn = mix(tn, normalize(vec3(sf * 2.0, 1.0)), stone * near * 0.8);
    float rootL = smoothstep(0.045, 0.0, abs(fbm2(xz / 2.6 + 17.0) - 0.5)) * smoothstep(0.5, 0.65, fbm2(xz / 9.0 - 3.0));
    c = mix(c, srgb(vec3(70,52,36)), rootL * pineK * near * 0.85);
  }
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
  // two scales of the snow scan, the second turned 37 degrees, blended by noise so the dimples never tile
  vec2 xzr = mat2(0.8, 0.6, -0.6, 0.8) * xz;
  vec3 snN = mix(texN(L_SNOW, xz, 4.0), texN(L_SNOW, xzr, 11.0), smoothstep(0.3, 0.7, fbm2(xz / 17.0 + 4.4)));
  c = mix(c, snow, snowAmt); tn = mix(tn, mix(vec3(0.0, 0.0, 1.0), snN, 0.24), snowAmt);   // (lighter: at 0.42 the scan's dimples tiled across the whole snowfield)
  rough = mix(rough, 0.6, snowAmt);
  if (snowAmt > 0.01) {
    // wind-packed ripples and soft drifts, so open snow reads as a surface rather than a white sheet
    vec2 wdir = vec2(0.93, 0.36);
    float ph = dot(xz, wdir) * 1.7 + fbm2(xz * 0.2) * 7.0;
    float rip = sin(ph) * smoothstep(3.0, 0.6, fp);
    float drift = fbm2(xz / 11.0);
    vec2 dg = wdir * rip * 0.2 * mix(0.3, 1.0, drift) + (vec2(fbm2(xz / 6.0 + 1.3), fbm2(xz / 6.0 - 2.1)) - 0.45) * 0.4
            + (vec2(fbm2(xz / 26.0 + 5.1), fbm2(xz / 26.0 - 3.7)) - 0.45) * 0.55;   // wind drifts and scoops
    tn = normalize(mix(tn, normalize(vec3(-dg, 1.0)), snowAmt));
    c *= mix(1.0, 0.9 + 0.14 * drift, snowAmt);
    // the horse's trail: a churned trough about a metre wide with thrown-up lips and hoof pits, shaded by its walls
    if (uTrailN > 1.5 && fp < 0.5) {
      float dmin = 1e9, sAt = 0.0, acc = 0.0; vec2 toC = vec2(0.0), tAt = vec2(1.0, 0.0);
      for (int i = 0; i < 47; i++) {
        if (float(i) >= uTrailN - 1.0) break;
        vec2 a0 = uTrail[i], b0 = uTrail[i + 1], ab = b0 - a0;
        float L = max(length(ab), 1e-3);
        float t = clamp(dot(xz - a0, ab) / (L * L), 0.0, 1.0);
        vec2 q = a0 + ab * t;
        float dd = length(xz - q);
        if (dd < dmin) { dmin = dd; sAt = acc + t * L; toC = (q - xz) / max(dd, 1e-3); tAt = ab / L; }
        acc += L;
      }
      if (dmin < 1.3) {
        float trough = smoothstep(0.62, 0.12, dmin), lip = smoothstep(1.2, 0.75, dmin) * smoothstep(0.5, 0.75, dmin);
        // hoof pits staggered left and right down the middle
        float stp = floor(sAt / 0.72);
        float lat = dot(-toC * dmin, vec2(-tAt.y, tAt.x));    // signed distance from the centre line
        float pit = smoothstep(0.17, 0.05, length(vec2(fract(sAt / 0.72) - 0.5, (lat - (mod(stp, 2.0) - 0.5) * 0.34) / 0.72) * 0.72)) * trough;
        // the walls lean in toward the centre line, the lips lean out
        float wall = smoothstep(0.7, 0.25, dmin) * smoothstep(0.0, 0.3, dmin);
        vec2 g = -toC * (wall * 1.5 - lip * 0.8);
        tn = normalize(tn + vec3(g, 0.0) * snowAmt);
        c *= mix(1.0, 0.52, trough * snowAmt) * (1.0 - 0.3 * pit * snowAmt);
        c = mix(c, c * vec3(0.8, 0.88, 1.05), (trough * 0.7 + pit * 0.5) * snowAmt);   // compacted, shadowed blue
        c *= 1.0 + 0.16 * lip * snowAmt;
        rough = mix(rough, 0.75, trough * snowAmt);
      }
    }
    // glints: single crystals near the lens turned just right to mirror the sky (they wink as the view moves)
    if (fp < 0.06) {
      vec3 vv = normalize(cameraPosition - wp);
      float glint = step(0.988, hash12(floor(xz * 48.0) + floor(vv.xz * 9.0) * 17.0)) * snowAmt * smoothstep(0.06, 0.015, fp);
      c = mix(c, vec3(1.0), glint * 0.6);
      rough = mix(rough, 0.03, glint);
    }
    // animal tracks: lines of prints wandering across the open snow (deer, a fox, a horse gone before)
    if (fp < 0.25) {
      float tl = fbm2(xz / 34.0 + 9.3);
      float onTrack = smoothstep(0.012, 0.0, abs(tl - 0.5)) + smoothstep(0.01, 0.0, abs(fbm2(xz / 52.0 - 4.1) - 0.47));
      vec2 cellp = floor(xz / 0.75);
      float prt = step(0.45, hash12(cellp)) * smoothstep(0.32, 0.12, length(fract(xz / 0.75) - 0.5));
      float pr = clamp(onTrack, 0.0, 1.0) * prt * snowAmt * smoothstep(0.25, 0.08, fp);
      c *= 1.0 - 0.22 * pr;
      c = mix(c, c * vec3(0.86, 0.92, 1.05), pr);
    }
  }
  // frozen falls: where seep lines cross a cliff band the risers hang with curtains of blue-white ice, stepping
  // down from ledge to ledge (broad curtains a few tens of metres wide at long intervals, not dashes all over a face)
  if (snowC > 0.3 && slope > 0.3) {
    float along = dot(xz, vec2(0.71, 0.71));
    float seep = smoothstep(0.7, 0.76, vnoise(xz / 46.0 + 11.3) * 0.8 + vnoise(xz / 15.0 - 4.7) * 0.2);
    float pillar = 0.55 + 0.45 * smoothstep(0.25, 0.7, vnoise(vec2(along * 0.9, wp.y * 0.03)));
    float icefall = smoothstep(0.3, 0.7, snowC) * smoothstep(0.55, 0.72, slope) * seep * pillar;
    c = mix(c, mix(srgb(vec3(120,156,178)), srgb(vec3(196,216,228)), vnoise(vec2(along * 2.3, wp.y * 0.12))), icefall * 0.8);
    rough = mix(rough, 0.2, icefall);
  }
  // the frozen creek in Frostwater Valley
  float cold = smoothstep(0.5, 0.8, snowC);
  // dark meltwater only in short open leads; most of the channel is iced and drifted over
  // the creek's corridor: willow scrub and gravel bars breaking through the snow along both banks, so from a
  // lookout the river reads as a dark braided band winding down the valley, not a faint line
  // (only where the water can lie: a creek line carried down a cliff face is no creek)
  cold *= 1.0 - smoothstep(0.1, 0.24, slope);
  float corridor = smoothstep(0.12, 0.4, wet) * (1.0 - smoothstep(0.45, 0.6, wet)) * cold;
  float willow = corridor * smoothstep(0.35, 0.65, fbm2(xz / 14.0 + 8.8) + 0.25 * (vnoise(xz / 3.0) - 0.5));
  c = mix(c, mix(srgb(vec3(46,40,36)), srgb(vec3(84,78,72)), vnoise(xz / 2.3)) * (0.8 + 0.3 * micro), willow * 0.75);
  float openW = smoothstep(0.82, 0.97, wet) * cold * smoothstep(0.22, 0.4, fbm2(xz / 60.0 + 3.3));
  float ice = smoothstep(0.4, 0.65, wet) * cold * (1.0 - openW);    // iced-over braids
  c = mix(c, mix(srgb(vec3(74,94,112)), snow, 0.3 * smoothstep(0.55, 0.8, vnoise(xz * 0.35))) * (0.85 + 0.25 * vnoise(xz * 1.3)), ice);   // (dark grey-blue ice: paler, the creek vanished into the snow from the saddle) tn = mix(tn, vec3(0.0, 0.0, 1.0), ice);
  // (river ice is scuffed and snow-dusted, not a mirror: glossy, it threw back the bright horizon and a river
  // seen from a height came out paler than the snow round it)
  rough = mix(rough, 0.55, ice);
  c = mix(c, srgb(vec3(22,30,36)), openW); tn = mix(tn, vec3(0.0, 0.0, 1.0), openW); rough = mix(rough, 0.3, openW);
  gTN = normalize(mix(vec3(0.0, 0.0, 1.0), tn, 0.9 * D));
  gDbg = vec3(snowAmt, rockAmt, slope * 2.0);
  return c;
}
`;

export class Terrain {
  constructor(world, scene, surf = null, quality = 1) {
    this.surf = surf;
    this.lodScale = quality >= 2 ? 2.0 : quality > 1 ? 1.45 : 1;
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
            // (kept moderate: stronger, the gullies line up down every face into a comb of white and grey stripes)
            nW = normalize(nW + vec3(g0 - gx, 0.0, g0 - gz) * steep * 2.0);
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
          vec4 ccl0 = climateAt(vWPos.xz);
          // under snow-country spruce the ground is shade and needles, not open snow: the stands close up sooner
          // the stand's edge is ragged at the scale of single crowns and fairly crisp (a soft gradient from forest to
          // open ground reads as camouflage blotches from a distance)
          float crownN = mix(0.5, vnoise(vWPos.xz / 5.5 + 2.7) * 0.7 + vnoise(vWPos.xz / 17.0) * 0.3, smoothstep(6.0, 2.0, length(fwidth(vWPos.xz))));
          float canopyK = smoothstep(0.42, 0.52, fo + 0.3 * (crownN - 0.5)) * mix(smoothstep(180.0, 420.0, camD) * (0.55 + 0.45 * smoothstep(850.0, 1250.0, camD)),
                                                          smoothstep(30.0, 200.0, camD) * 0.92, max(smoothstep(0.4, 0.8, ccl0.r), smoothstep(0.3, 0.7, ccl0.g)));
          float cfp = length(fwidth(vWPos.xz));
          vec3 canopy = mix(srgb(vec3(34,46,26)), srgb(vec3(52,62,32)), mix(0.47, fbm2(vWPos.xz/18.0), smoothstep(14.0, 5.0, cfp)))
                      * mix(0.95, 0.7 + 0.5*vnoise(vWPos.xz/4.0), smoothstep(5.0, 1.5, cfp));
          canopy = mix(canopy, srgb(vec3(30,40,30)), smoothstep(80.0, 200.0, vWPos.y) * 0.6);
          vec4 ccl = climateAt(vWPos.xz);
          float cn = mix(0.5, fbm2(vWPos.xz / 26.0 + 4.0), smoothstep(14.0, 5.0, cfp));
          canopy = mix(canopy, mix(srgb(vec3(20,40,16)), srgb(vec3(36,60,22)), cn), ccl.g);                       // jungle
          canopy = mix(canopy, mix(srgb(vec3(124,58,22)), srgb(vec3(158,112,32)), cn) * mix(1.0, 0.55, step(0.7, cn)), ccl.b * 0.85); // autumn
          // snow-laden spruce still read as dark masses from afar, flecked with white
          // (from afar the snow caught on every crown and lying between them averages to a cold mid grey)
          // (each crown its own dark cone, lit on the sun's side with snow on that shoulder, shaded snow lying between
          // them: a flat grey tint under sparse billboards read as stains painted on the mountainside. The crowns
          // dissolve into their mean tone once a pixel is wider than a tree.)
          {
            vec2 cg = vWPos.xz / 6.0, ci = floor(cg);
            vec2 cf = fract(cg) - 0.5 - (hash22(ci) - 0.5) * 0.55;
            float sz = 0.5 + 0.5 * hash12(ci + 3.7);
            float crown = smoothstep(0.5 * sz + 0.1, 0.12 * sz, length(cf)) * step(0.1, hash12(ci + 9.1));
            float lit = 0.55 + 0.45 * dot(normalize(cf + 1e-4), normalize(uSunDir.xz + 1e-4));
            float res = smoothstep(4.5, 1.2, cfp);
            vec3 crownC = srgb(vec3(26,36,32)) * (0.6 + 0.8 * lit);
            crownC = mix(crownC, srgb(vec3(170,180,192)), 0.22 * smoothstep(0.1, 0.5, lit));
            // (inside a stand the snow between the crowns lies in their shade: dark, so the stand reads as one mass)
            vec3 gapC = mix(srgb(vec3(128,140,156)), srgb(vec3(58,72,90)), smoothstep(0.5, 0.8, fo));
            vec3 snowForest = mix(mix(srgb(vec3(34,44,46)), gapC, 0.26), mix(gapC, crownC, crown), res);
            canopy = mix(canopy, snowForest, smoothstep(0.4, 0.8, ccl.r));
          }
          // crown mottling: lit crowns and shaded gaps as organic noise (a dome grid lines up into rows at
          // grazing angles), strongest where the canopy is closed and crowns span a few pixels
          if (canopyK > 0.01) {
            float fade = smoothstep(9.0, 2.5, cfp) * smoothstep(0.45, 0.85, canopyK);
            float m = 0.6 * vnoise(vWPos.xz / mix(4.5, 6.5, ccl0.g) + 3.1) + 0.4 * vnoise(vWPos.xz / 2.1 - 7.7);
            // rainforest canopy: deep shaded gaps between big lit crowns
            float lo = mix(0.72, 0.5, ccl0.g), hiK = mix(0.5, 0.8, ccl0.g);
            canopy *= mix(1.0, lo + hiK * smoothstep(0.25, 0.75, m) + 0.1 * (fbm2(vWPos.xz / 23.0) - 0.5), fade);
          }
          // snow-country spruce stand apart with snow lying between them: from afar the slope stays mostly white,
          // flecked dark (a closed dark canopy with white glades read as puddles of snow on black rock)
          canopyK *= 1.0 - 0.12 * smoothstep(0.4, 0.8, ccl0.r);
          diffuseColor.rgb = mix(diffuseColor.rgb, canopy, canopyK);
          tr = mix(tr, 1.0, canopyK);
        }
        gTRough = tr;
        gTNormal = nW;
        #ifdef TERRAIN_DEBUG
        diffuseColor.rgb = gDbg;
        #endif
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
    // Depth pre-pass. The ground's shader is by far the heaviest in the frame and its chunks are drawn in no
    // particular order, so in mountain country every pixel was shaded several times over before the nearest
    // surface won. The ground is first laid into the depth buffer alone (a few lines of vertex shader, no colour);
    // the full shader then runs once per pixel, on the surface that is actually seen. The pre-pass sits a hair
    // further back so the two programs' rounding can never reject the real surface.
    const preMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uChunk: { value: CHUNK } },
      vertexShader: `${GLSL_COMMON}\n${GLSL_FAR_DEPTH}\n${VERT_HEAD}
        void main(){ ${VERT_BODY} gl_Position = projectionMatrix * (modelViewMatrix * vec4(transformed, 1.0)); farDepth(gl_Position); }`,
      fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
      colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 4,
    });
    LODS.forEach((seg, li) => {
      const g = makeLodGeometry(seg, 2 * Math.pow(2, li));
      const pre = new THREE.Mesh(g, preMat);
      pre.frustumCulled = false; pre.renderOrder = -10; pre.castShadow = false; pre.receiveShadow = false;
      scene.add(pre);
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
