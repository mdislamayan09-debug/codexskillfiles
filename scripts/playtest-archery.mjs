#!/usr/bin/env node
// Archery, birds and farming, end to end: draw and loose, arrows that stick
// and can be pulled out again, a rook brought down for feathers, an animal
// shot and butchered for its arrows back, and a farm plot planted, watered,
// grown and harvested. Saves screenshots of each along the way.
// Usage: node scripts/playtest-archery.mjs [--quality low] [--url http://127.0.0.1:5188]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/archery');
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  // Network hiccups from the sandbox proxy are not the game's.
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) logs.push(`[console] ${m.text()}`);
});
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
};
const shot = async (name) => {
  await H('hideDebugUi');
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};
const count = (id) => page.evaluate((id) => window.game.inventory.count(id), id);

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 10);
// An open, gentle stretch of the Greensward near the camp.
const spot = await page.evaluate(() => {
  const world = window.game.world;
  let best = null;
  for (let k = 0; k < 40; k += 1) {
    const x = 40 + (k % 8) * 18;
    const z = 520 + Math.floor(k / 8) * 18;
    if (world.waterDepthAt(x, z) > 0) continue;
    const s = world.slopeAt(x, z) + world.slopeAt(x + 25, z) + world.slopeAt(x, z - 25);
    const trees = window.game.vegetation.collidersNear(x, z - 12, 16, []).length;
    const score = s * 4 + trees;
    if (!best || score < best.score) best = { x, z, score };
  }
  return best;
});
await H('teleport', spot.x, spot.z, 0);
await H('give', 'shortbow', 1);
await H('give', 'flint_arrow', 10);
await H('selectItem', 'shortbow');

// 1. Draw and loose at the ground ahead.
const target = await page.evaluate(({ x, z }) => ({ x, y: window.game.world.groundAt(x, z - 18), z: z - 18 }), spot);
await H('aim', target.x, target.y, target.z);
const tap = await H('shootBow', 0.05);
check('a quick tap does not loose', tap.loosed === null && (await count('flint_arrow')) === 10, tap);
const full = await H('shootBow', 1);
check('a full draw looses an arrow', full.loosed && full.loosed.draw > 0.95 && (await count('flint_arrow')) === 9, full);
await H('renderFrames', 45, 1 / 30);
const arrows = await H('arrows');
const stuck = arrows.find((a) => a.state === 'stuck');
// Aimed at the ground at a grazing angle, gravity brings it down a little
// short: it should land ahead along the line of aim, with little drift.
const along = stuck ? spot.z - stuck.z : -1;
const drift = stuck ? Math.abs(stuck.x - target.x) : -1;
check('the arrow flies along the aim and sticks in the ground', Boolean(stuck) && along > 8 && along < 22 && drift < 1, { arrows, along, drift });

// Pull it out again.
await H('teleport', stuck.x + 1.3, stuck.z + 1.3, 0);
await H('aim', stuck.x, stuck.y + 0.12, stuck.z);
await shot('arrow-in-ground');
const pulled = await H('act', 'interact');
check('pulling the arrow out gives it back', (await count('flint_arrow')) === 10 && (await H('arrows')).length === 0, pulled);

// 2. A rook on the ground, shot and picked up.
await H('teleport', spot.x, spot.z, 0);
// Well outside a rook's startle range (14 m walking).
const rx = spot.x + 2;
const rz = spot.z - 26;
await H('spawnBirds', 'rook', rx, rz, 5, false);
await H('renderFrames', 4, 1 / 30);
let birds = await H('birds');
const rook = birds.find((b) => b.state === 'ground');
// Hold over for the drop: a full-draw shortbow arrow leaves at ~47 m/s.
const range = Math.hypot(rook.x - spot.x, rook.z - spot.z);
const drop = 0.5 * 7.2 * (range / 47.2) ** 2;
await H('aim', rook.x, rook.y + 0.1 + drop, rook.z);
await shot('rooks-foraging');
await H('shootBow', 1);
await H('renderFrames', 60, 1 / 30);
birds = await H('birds');
const down = birds.find((b) => b.state === 'dead');
check('an arrow brings down a rook', Boolean(down), birds.slice(0, 6));
check('the rest of the flock takes flight', birds.filter((b) => b.flock !== 0).every((b) => b.state === 'fly'), birds.map((b) => b.state));
await H('renderFrames', 20, 1 / 30);
await shot('flock-flushed');
const feathersBefore = await count('feather');
await H('teleport', down.x + 1.2, down.z + 1.2, 0);
await H('aim', down.x, down.y + 0.05, down.z);
await H('act', 'interact');
check('the rook gives feathers and the arrow back', (await count('feather')) > feathersBefore && (await count('flint_arrow')) === 10, { feathers: await count('feather'), arrows: await count('flint_arrow') });

// 3. Birds on the wing.
await H('spawnBirds', 'gull', spot.x, spot.z - 40, 5, true);
const before = (await H('birds')).filter((b) => b.species === 'gull');
await H('renderFrames', 60, 1 / 30);
const after = (await H('birds')).filter((b) => b.species === 'gull');
const moved = after.length > 0 && after.every((b) => {
  const o = before.find((x) => x.id === b.id);
  return o && Math.hypot(b.x - o.x, b.z - o.z) > 5;
});
const ground = await page.evaluate(({ x, z }) => window.game.world.groundAt(x, z), { x: spot.x, z: spot.z - 40 });
check('gulls wheel overhead', moved && after.every((b) => b.y > ground + 3), after.slice(0, 3));
const g0 = after[0];
await H('aim', g0.x, g0.y, g0.z);
await shot('gulls-overhead');

// 4. A sprigbuck shot and butchered: the arrow comes back.
await H('teleport', spot.x, spot.z, 0);
const buck = await H('spawnCreature', 'sprigbuck', 0, -12);
await H('aim', buck.x, buck.y + 0.7, buck.z);
let hits = 0;
for (let i = 0; i < 4; i += 1) {
  const c = (await H('creatures')).find((x) => x.id === buck.id);
  if (!c || c.state === 'dead') break;
  await H('aim', c.x, (await page.evaluate(({ x, z }) => window.game.world.groundAt(x, z), c)) + 0.8, c.z);
  await H('shootBow', 1);
  await H('renderFrames', 20, 1 / 30);
  hits += 1;
}
const dead = (await H('creatures')).find((x) => x.id === buck.id);
const inBuck = (await H('arrows')).filter((a) => a.attached).length;
check('arrows bring down a sprigbuck and stay in it', dead && dead.state === 'dead' && inBuck > 0, { dead, inBuck, hits });
if (dead) {
  const arrowsBefore = await count('flint_arrow');
  await H('teleport', dead.x + 1.6, dead.z + 1.6, 0);
  await H('aim', dead.x, (await page.evaluate(({ x, z }) => window.game.world.groundAt(x, z), dead)) + 0.3, dead.z);
  await H('act', 'interact');
  check('butchering returns the arrows', (await count('flint_arrow')) > arrowsBefore, { before: arrowsBefore, after: await count('flint_arrow') });
}

// 5. The bow drawn, for a picture.
await H('teleport', spot.x, spot.z, 0);
await H('aim', spot.x, target.y + 2, spot.z - 30);
await page.evaluate(() => {
  window.game.archery.drawing = true;
  window.game.archery.draw = 1;
});
await H('renderFrames', 3, 1 / 30);
await page.screenshot({ path: `${out}/bow-drawn.png`, timeout: 300_000 });
await page.evaluate(() => window.game.archery.cancel());

// 6. Farming: plant, water, grow, harvest.
await H('give', 'farm_plot', 3);
await H('give', 'seeds', 4);
await H('give', 'berries', 4);
await H('give', 'herbs', 4);
await H('give', 'waterskin', 1);
const plotAt = await page.evaluate(({ x, z }) => ({ x, y: window.game.world.groundAt(x, z - 3.6), z: z - 3.6 }), spot);
const placed = [];
for (let i = 0; i < 3; i += 1) {
  await H('teleport', spot.x + (i - 1) * 3.4, spot.z, 0);
  await H('selectItem', 'farm_plot');
  await H('aim', plotAt.x + (i - 1) * 3.4, plotAt.y, plotAt.z);
  placed.push(await H('act', 'place'));
}
let plots = await H('plots');
check('three farm plots placed', plots.length === 3, placed);
const seedsFor = ['seeds', 'berries', 'herbs'];
for (let i = 0; i < plots.length; i += 1) {
  const p = plots[i];
  await H('teleport', p.x, p.z + 2.6, 0);
  await H('selectItem', seedsFor[i]);
  await H('aim', p.x, p.y + 0.1, p.z);
  await H('act', 'interact');
}
plots = await H('plots');
check('each plot takes its crop', plots.map((p) => p.crop?.id).join(',') === 'flax,lanternberry,yarrow', plots.map((p) => p.crop));
// Water the flax.
const flax = plots[0];
await page.evaluate(() => {
  const i = window.game.inventory.slots.findIndex((s) => s?.id === 'waterskin');
  window.game.inventory.slots[i].durability = 5;
});
await H('teleport', flax.x, flax.z + 2.6, 0);
await H('selectItem', 'waterskin');
await H('aim', flax.x, flax.y + 0.1, flax.z);
await H('act', 'interact');
plots = await H('plots');
check('watering wets the soil', plots[0].crop.water > 0.9, plots[0].crop);
await H('passHours', 14);
plots = await H('plots');
check('watered flax grows faster than dry yarrow', plots[0].crop.growth > plots[2].crop.growth * 2, plots.map((p) => p.crop.growth.toFixed(2)));
await H('teleport', flax.x - 1, flax.z + 4.5, 0);
await H('aim', flax.x + 1.5, flax.y + 0.2, flax.z);
await shot('farm-growing');
// Water the other two as well, then let the days go by (the soil dries
// after a day and a bit, and dry crops grow at a fifth of the pace).
for (const p of plots.slice(1)) {
  await H('teleport', p.x, p.z + 2.6, 0);
  await H('selectItem', 'waterskin');
  await H('aim', p.x, p.y + 0.1, p.z);
  await H('act', 'interact');
}
await H('passHours', 90);
plots = await H('plots');
check('crops ripen with time', plots.every((p) => p.crop.growth >= 1), plots.map((p) => p.crop.growth));
await shot('farm-ripe');
const fiberBefore = await count('fiber');
await H('teleport', flax.x, flax.z + 2.6, 0);
await H('aim', flax.x, flax.y + 0.1, flax.z);
await H('act', 'interact');
plots = await H('plots');
check('harvesting flax clears the plot and gives fibre', plots[0].crop === null && (await count('fiber')) > fiberBefore, { fiber: await count('fiber') });
const berry = plots[1];
const berriesBefore = await count('berries');
await H('teleport', berry.x, berry.z + 2.6, 0);
await H('aim', berry.x, berry.y + 0.1, berry.z);
await H('act', 'interact');
plots = await H('plots');
check('lanternberries fruit again after picking', plots[1].crop && plots[1].crop.growth < 1 && (await count('berries')) > berriesBefore, plots[1].crop);

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
