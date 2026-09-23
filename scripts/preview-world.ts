// Renders a shaded overview of the generated world to artifacts/world-preview/.
// Usage: npx tsx scripts/preview-world.ts [--size 1024]
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { generateWorld, MASK } from '../src/world/gen/generateWorld';
import { BIOME_COUNT, FIELD_RES, HEIGHT_RES, WORLD_HALF } from '../src/world/WorldConfig';
import { LANDMARKS } from '../src/world/WorldLayout';

const sizeArg = process.argv.indexOf('--size');
const SIZE = sizeArg > 0 ? Number(process.argv[sizeArg + 1]) : 1024;

const palette: [number, number, number][] = [
  [118, 150, 72], // Greensward
  [44, 78, 58], // Hollowpine
  [150, 140, 170], // Glasswood
  [128, 132, 110], // Coast
  [70, 60, 56], // Cinderreach
  [205, 212, 222], // Frostveil
  [96, 104, 62], // Drownfen
  [150, 142, 124], // Rim
];

const started = Date.now();
let lastStage = '';
const world = generateWorld((stage, f) => {
  if (stage !== lastStage) {
    lastStage = stage;
    process.stdout.write(`\n${stage} `);
  }
  if (f > 0) process.stdout.write('.');
});
console.log(`\nGenerated in ${Date.now() - started} ms`, world.stats);

const png = new PNG({ width: SIZE, height: SIZE });
const scale = HEIGHT_RES / SIZE;
const light = { x: -0.55, y: 0.62, z: -0.56 };
let minH = Infinity;
let maxH = -Infinity;
for (const h of world.heights) {
  if (h < minH) minH = h;
  if (h > maxH) maxH = h;
}

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    const i = Math.min(HEIGHT_RES - 1, Math.floor(px * scale));
    const j = Math.min(HEIGHT_RES - 1, Math.floor(py * scale));
    const k = j * HEIGHT_RES + i;
    const h = world.heights[k];
    const nx = world.normals[k * 4] / 127.5 - 1;
    const ny = world.normals[k * 4 + 1] / 127.5 - 1;
    const nz = world.normals[k * 4 + 2] / 127.5 - 1;
    const ao = world.normals[k * 4 + 3] / 255;
    const fi = Math.min(FIELD_RES - 1, Math.floor(i / 2));
    const fj = Math.min(FIELD_RES - 1, Math.floor(j / 2));
    const fk = fj * FIELD_RES + fi;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let bi = 0; bi < BIOME_COUNT; bi += 1) {
      const w = world.biome[fk * BIOME_COUNT + bi] / 255;
      r += palette[bi][0] * w;
      g += palette[bi][1] * w;
      b += palette[bi][2] * w;
    }
    const m = world.masks;
    const sand = m[fk * 8 + MASK.sand] / 255;
    const snow = m[fk * 8 + MASK.snow] / 255;
    const path = m[fk * 8 + MASK.path] / 255;
    const wet = m[fk * 8 + MASK.wet] / 255;
    const carve = m[fk * 8 + MASK.carve] / 255;
    const slope = 1 - ny;
    const rock = Math.min(1, Math.max(0, (slope - 0.28) / 0.2));
    r = r * (1 - rock) + 105 * rock;
    g = g * (1 - rock) + 100 * rock;
    b = b * (1 - rock) + 95 * rock;
    r = r * (1 - carve * 0.35) + 90 * carve * 0.35;
    g = g * (1 - carve * 0.35) + 84 * carve * 0.35;
    b = b * (1 - carve * 0.35) + 78 * carve * 0.35;
    r = r * (1 - sand) + 214 * sand;
    g = g * (1 - sand) + 196 * sand;
    b = b * (1 - sand) + 150 * sand;
    r = r * (1 - wet * 0.5) + 60 * wet * 0.5;
    g = g * (1 - wet * 0.5) + 58 * wet * 0.5;
    b = b * (1 - wet * 0.5) + 40 * wet * 0.5;
    r = r * (1 - snow) + 240 * snow;
    g = g * (1 - snow) + 244 * snow;
    b = b * (1 - snow) + 250 * snow;
    r = r * (1 - path) + 150 * path;
    g = g * (1 - path) + 120 * path;
    b = b * (1 - path) + 84 * path;
    const diffuse = Math.max(0, nx * light.x + ny * light.y + nz * light.z);
    const shade = (0.35 + 0.85 * diffuse) * (0.55 + 0.45 * ao);
    r *= shade;
    g *= shade;
    b *= shade;
    const level = world.water[fk];
    if (h < level) {
      const depth = Math.min(1, (level - h) / 12);
      r = r * 0.25 * (1 - depth) + 20 * depth + 30;
      g = g * 0.35 * (1 - depth) + 60 * depth + 50;
      b = b * 0.45 * (1 - depth) + 90 * depth + 70;
    }
    const o = (py * SIZE + px) * 4;
    png.data[o] = Math.min(255, r);
    png.data[o + 1] = Math.min(255, g);
    png.data[o + 2] = Math.min(255, b);
    png.data[o + 3] = 255;
  }
}

// Landmarks and the Veil circle.
const toPx = (w: number) => ((w + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;
for (const lm of LANDMARKS) {
  const cx = Math.round(toPx(lm.x));
  const cy = Math.round(toPx(lm.z));
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      if (dx * dx + dy * dy > 9) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const o = (y * SIZE + x) * 4;
      const edge = dx * dx + dy * dy > 4;
      png.data[o] = edge ? 20 : 95;
      png.data[o + 1] = edge ? 20 : 242;
      png.data[o + 2] = edge ? 20 : 214;
    }
  }
}
for (let a = 0; a < 4000; a += 1) {
  const t = (a / 4000) * Math.PI * 2;
  const x = Math.round(toPx(Math.cos(t) * 980));
  const y = Math.round(toPx(Math.sin(t) * 980));
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
  const o = (y * SIZE + x) * 4;
  png.data[o] = 230;
  png.data[o + 1] = 230;
  png.data[o + 2] = 255;
}

mkdirSync('artifacts/world-preview', { recursive: true });
writeFileSync('artifacts/world-preview/overview.png', PNG.sync.write(png));
console.log(`Heights ${minH.toFixed(1)} .. ${maxH.toFixed(1)} m`);
for (const lake of world.lakes) console.log(`Lake ${lake.id}: level ${lake.level.toFixed(1)}`);
for (const river of world.rivers) {
  const p = river.points;
  console.log(`River ${river.id}: ${river.count} pts, surface ${p[2].toFixed(1)} → ${p[(river.count - 1) * 6 + 2].toFixed(1)}`);
}
for (const lm of world.landmarks) console.log(`  ${lm.id.padEnd(18)} y=${lm.y.toFixed(1)}`);
